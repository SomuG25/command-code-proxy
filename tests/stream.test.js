/**
 * tests/stream.test.js
 *
 * Unit tests for stream.js — the Alpha SSE → Anthropic SSE converter.
 * This is the real-time hot path for every streaming response.
 */

const { AlphaToAnthropicStreamConverter } = require("../stream");

// ─── Mock response object ─────────────────────────────────────────────────────

function createMockRes() {
  const events = [];
  return {
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      // Parse each SSE event written to the response
      const lines = chunk.split("\n").filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("event: ") && lines[i + 1]?.startsWith("data: ")) {
          try {
            events.push(JSON.parse(lines[i + 1].slice(6)));
            i++; // skip the data line
          } catch {}
        }
      }
    },
    end() {
      this.writableEnded = true;
    },
    _events: events,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function feedLines(converter, lines) {
  for (const line of lines) {
    converter.processLine(line);
  }
}

// ─── message_start ────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — message_start", () => {
  test("emits message_start on first content event", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("deepseek/deepseek-v4-pro", res);
    feedLines(conv, [JSON.stringify({ type: "text-delta", text: "hi" })]);

    const start = res._events.find((e) => e.type === "message_start");
    expect(start).toBeDefined();
    expect(start.message.model).toBe("deepseek/deepseek-v4-pro");
    expect(start.message.role).toBe("assistant");
  });

  test("does not emit duplicate message_start", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "Hello" }),
      JSON.stringify({ type: "text-delta", text: " world" }),
    ]);

    const starts = res._events.filter((e) => e.type === "message_start");
    expect(starts).toHaveLength(1);
  });
});

// ─── text-delta ───────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — text-delta", () => {
  test("emits content_block_start + content_block_delta for text", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [JSON.stringify({ type: "text-delta", text: "Hello!" })]);

    const blockStart = res._events.find((e) => e.type === "content_block_start");
    expect(blockStart).toBeDefined();
    expect(blockStart.content_block.type).toBe("text");

    const delta = res._events.find((e) => e.type === "content_block_delta");
    expect(delta).toBeDefined();
    expect(delta.delta.type).toBe("text_delta");
    expect(delta.delta.text).toBe("Hello!");
  });

  test("multiple text deltas stay in same block (no extra block_start)", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "Part 1. " }),
      JSON.stringify({ type: "text-delta", text: "Part 2." }),
    ]);

    const blockStarts = res._events.filter((e) => e.type === "content_block_start");
    expect(blockStarts).toHaveLength(1); // Only one text block

    const deltas = res._events.filter((e) => e.type === "content_block_delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0].delta.text).toBe("Part 1. ");
    expect(deltas[1].delta.text).toBe("Part 2.");
  });
});

// ─── reasoning ────────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — reasoning", () => {
  test("emits thinking block for reasoning-start/delta/end", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [
      JSON.stringify({ type: "reasoning-start" }),
      JSON.stringify({ type: "reasoning-delta", text: "Let me think..." }),
      JSON.stringify({ type: "reasoning-end" }),
    ]);

    const thinkingStart = res._events.find(
      (e) => e.type === "content_block_start" && e.content_block?.type === "thinking"
    );
    expect(thinkingStart).toBeDefined();

    const thinkingDelta = res._events.find(
      (e) => e.type === "content_block_delta" && e.delta?.type === "thinking_delta"
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta.delta.thinking).toBe("Let me think...");
  });

  test("closes reasoning block and opens text block after reasoning-end", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [
      JSON.stringify({ type: "reasoning-start" }),
      JSON.stringify({ type: "reasoning-delta", text: "Reasoning..." }),
      JSON.stringify({ type: "reasoning-end" }),
      JSON.stringify({ type: "text-delta", text: "Answer." }),
    ]);

    const blocks = res._events.filter((e) => e.type === "content_block_start");
    expect(blocks).toHaveLength(2); // thinking + text
    expect(blocks[0].content_block.type).toBe("thinking");
    expect(blocks[1].content_block.type).toBe("text");
  });
});

// ─── tool-call ────────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — tool-call", () => {
  test("emits tool_use block with correct fields", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({
        type: "tool-call",
        toolCallId: "tc_abc123",
        toolName: "web_search",
        input: { query: "Node.js tutorials" },
      }),
    ]);

    const toolStart = res._events.find(
      (e) => e.type === "content_block_start" && e.content_block?.type === "tool_use"
    );
    expect(toolStart).toBeDefined();
    expect(toolStart.content_block.id).toBe("tc_abc123");
    expect(toolStart.content_block.name).toBe("web_search");

    const toolDelta = res._events.find(
      (e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta"
    );
    expect(toolDelta).toBeDefined();
    expect(JSON.parse(toolDelta.delta.partial_json)).toEqual({ query: "Node.js tutorials" });
  });

  test("closes open text block before emitting tool_use", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "I will search now." }),
      JSON.stringify({
        type: "tool-call",
        toolCallId: "tc_1",
        toolName: "web_search",
        input: { query: "test" },
      }),
    ]);

    const stops = res._events.filter((e) => e.type === "content_block_stop");
    const starts = res._events.filter((e) => e.type === "content_block_start");

    // text block starts, then stops, then tool block starts, then stops
    expect(starts).toHaveLength(2);
    expect(stops).toHaveLength(2);
    expect(starts[0].content_block.type).toBe("text");
    expect(starts[1].content_block.type).toBe("tool_use");
  });

  test("skips providerExecuted tool calls", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({
        type: "tool-call",
        toolCallId: "tc_server",
        toolName: "server_tool",
        input: {},
        providerExecuted: true,
      }),
    ]);

    const toolStart = res._events.find((e) => e.type === "content_block_start");
    expect(toolStart).toBeUndefined(); // Should be skipped
  });
});

// ─── finish ───────────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — finish", () => {
  test("emits message_delta and message_stop on finish", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "done" }),
      JSON.stringify({
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 100, outputTokens: 50 },
      }),
    ]);

    const delta = res._events.find((e) => e.type === "message_delta");
    expect(delta).toBeDefined();
    expect(delta.delta.stop_reason).toBe("end_turn");
    expect(delta.usage.output_tokens).toBe(50);

    const stop = res._events.find((e) => e.type === "message_stop");
    expect(stop).toBeDefined();
  });

  test("maps tool-calls finishReason to stop_reason: tool_use", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "" }),
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    ]);

    const delta = res._events.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("tool_use");
  });

  test("maps length finishReason to stop_reason: max_tokens", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("gpt-5.4", res);
    feedLines(conv, [
      JSON.stringify({ type: "text-delta", text: "..." }),
      JSON.stringify({ type: "finish", finishReason: "length" }),
    ]);

    const delta = res._events.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("max_tokens");
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — error handling", () => {
  test("emits valid Anthropic response on error event (before start)", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    feedLines(conv, [
      JSON.stringify({ type: "error", error: { message: "Rate limit exceeded" } }),
    ]);

    const start = res._events.find((e) => e.type === "message_start");
    expect(start).toBeDefined();

    const stop = res._events.find((e) => e.type === "message_stop");
    expect(stop).toBeDefined();

    // Error text should appear in a content block
    const textDelta = res._events.find(
      (e) => e.type === "content_block_delta" && e.delta?.text?.includes("Rate limit")
    );
    expect(textDelta).toBeDefined();
  });
});

// ─── flush ────────────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — flush", () => {
  test("flush on empty stream produces a minimal valid Anthropic response", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    conv.flush(); // No events at all

    const start = res._events.find((e) => e.type === "message_start");
    const stop = res._events.find((e) => e.type === "message_stop");
    expect(start).toBeDefined();
    expect(stop).toBeDefined();
  });

  test("flush processes remaining buffer content", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    // Feed partial chunk without newline (simulates incomplete SSE line)
    conv.processChunk(JSON.stringify({ type: "text-delta", text: "buffered" }));
    conv.flush();

    const delta = res._events.find(
      (e) => e.type === "content_block_delta" && e.delta?.text === "buffered"
    );
    expect(delta).toBeDefined();
  });
});

// ─── processChunk ─────────────────────────────────────────────────────────────

describe("AlphaToAnthropicStreamConverter — processChunk", () => {
  test("handles chunks split across newlines correctly", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);

    const event1 = JSON.stringify({ type: "text-delta", text: "Hello" });
    const event2 = JSON.stringify({ type: "text-delta", text: " World" });

    // Split across a chunk boundary
    const combined = event1 + "\n" + event2;
    const half = Math.floor(combined.length / 2);
    conv.processChunk(combined.slice(0, half));
    conv.processChunk(combined.slice(half));
    conv.flush();

    const deltas = res._events.filter((e) => e.type === "content_block_delta");
    const texts = deltas.map((d) => d.delta.text).join("");
    expect(texts).toContain("Hello");
    expect(texts).toContain(" World");
  });

  test("ignores non-JSON lines silently", () => {
    const res = createMockRes();
    const conv = new AlphaToAnthropicStreamConverter("claude-sonnet-4-6", res);
    expect(() => {
      conv.processChunk("not json at all\n");
      conv.processChunk("also not json\n");
      conv.flush();
    }).not.toThrow();
  });
});
