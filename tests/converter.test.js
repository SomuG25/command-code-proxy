/**
 * tests/converter.test.js
 *
 * Unit tests for converter.js — the Anthropic ↔ Alpha format translator.
 * This is the most critical module: bugs here silently corrupt all conversations.
 */

// Mock config.js so tests don't need auth.json
jest.mock("../config", () => ({
  ANTHROPIC_BUILTIN_TOOLS: {
    web_search_20250305: {
      name: "web_search",
      description: "Search the web",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    text_editor_20250429: {
      name: "text_editor",
      description: "View or edit files",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          path: { type: "string" },
        },
        required: ["command", "path"],
      },
    },
  },
}));

const {
  convertAnthropicToAlpha,
  convertTools,
  convertMessages,
} = require("../converter");

// ─── convertTools ─────────────────────────────────────────────────────────────

describe("convertTools", () => {
  test("passes through regular tools unchanged", () => {
    const tools = [
      {
        name: "my_tool",
        description: "does something",
        input_schema: { type: "object", properties: { x: { type: "string" } } },
      },
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my_tool");
    expect(result[0].input_schema).toBeDefined();
  });

  test("converts Anthropic built-in tool (web_search_20250305) to regular tool", () => {
    const tools = [{ type: "web_search_20250305" }];
    const result = convertTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("web_search");
    expect(result[0].input_schema).toBeDefined();
    expect(result[0].input_schema.properties.query).toBeDefined();
  });

  test("converts text_editor built-in tool", () => {
    const tools = [{ type: "text_editor_20250429" }];
    const result = convertTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("text_editor");
  });

  test("skips unknown built-in types (no input_schema)", () => {
    const tools = [{ type: "computer_use_20250101" }];
    const result = convertTools(tools);
    expect(result).toHaveLength(0);
  });

  test("handles empty tools array", () => {
    expect(convertTools([])).toEqual([]);
    expect(convertTools(null)).toEqual([]);
    expect(convertTools(undefined)).toEqual([]);
  });

  test("handles mixed regular and built-in tools", () => {
    const tools = [
      { type: "web_search_20250305" },
      {
        name: "custom_tool",
        description: "custom",
        input_schema: { type: "object", properties: {} },
      },
      { type: "computer_use_20250101" }, // should be skipped
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("web_search");
    expect(result[1].name).toBe("custom_tool");
  });
});

// ─── convertMessages ──────────────────────────────────────────────────────────

describe("convertMessages", () => {
  test("handles simple string content messages", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello");
  });

  test("converts user text blocks to plain string", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "What is Node.js?" }],
      },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("What is Node.js?");
  });

  test("converts assistant text blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Node.js is a runtime." }],
      },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    const block = result[0].content[0];
    expect(block.type).toBe("text");
    expect(block.text).toBe("Node.js is a runtime.");
  });

  test("converts tool_use blocks to tool-call format", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "web_search",
            input: { query: "node js tutorial" },
          },
        ],
      },
      // Provide the matching tool result so healer doesn't inject a fake one
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_123",
            content: [{ type: "text", text: "Results for node js tutorial" }],
          },
        ],
      },
    ];
    const result = convertMessages(messages);

    // assistant message + tool message (split from user tool_result)
    const assistantMsg = result.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const block = assistantMsg.content[0];
    expect(block.type).toBe("tool-call");
    expect(block.toolCallId).toBe("tool_123");
    expect(block.toolName).toBe("web_search");
    expect(block.input).toEqual({ query: "node js tutorial" });
  });

  test("splits tool_result from user message into separate role:tool message", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "web_search",
            input: { query: "node js" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_123",
            content: [{ type: "text", text: "Node.js results here." }],
          },
        ],
      },
    ];
    const result = convertMessages(messages);

    // Should produce: assistant + tool (split from user)
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("tool");
    expect(result[1].content[0].type).toBe("tool-result");
    expect(result[1].content[0].toolCallId).toBe("tool_123");
  });

  test("user message with both text and tool_result splits correctly", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "web_search", input: { query: "q" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "result text" },
          { type: "text", text: "Thanks!" },
        ],
      },
    ];
    const result = convertMessages(messages);

    // tool message first, then user message
    const toolMsg = result.find((m) => m.role === "tool");
    const userMsg = result.find((m) => m.role === "user");
    expect(toolMsg).toBeDefined();
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toBe("Thanks!");
  });

  test("converts thinking blocks to reasoning type", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me reason about this..." },
          { type: "text", text: "The answer is 42." },
        ],
      },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    const blocks = result[0].content;
    const reasoningBlock = blocks.find((b) => b.type === "reasoning");
    expect(reasoningBlock).toBeDefined();
    expect(reasoningBlock.text).toBe("Let me reason about this...");
  });

  test("handles empty messages array", () => {
    expect(convertMessages([])).toEqual([]);
    expect(convertMessages(null)).toEqual([]);
  });

  test("image blocks in user messages become placeholder text", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", source: { media_type: "image/png" } },
          { type: "text", text: "What is in this image?" },
        ],
      },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("[Image: image/png]");
    expect(result[0].content).toContain("What is in this image?");
  });
});

// ─── Orphaned tool call healing ───────────────────────────────────────────────

describe("convertMessages — orphaned tool call healing", () => {
  test("injects fake tool result for orphaned tool call (user interrupted)", () => {
    const messages = [
      { role: "user", content: "Run a search" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "orphan_1", name: "web_search", input: { query: "test" } },
        ],
      },
      // No tool result follows — simulates user pressing Esc
      { role: "user", content: "Actually, never mind." },
    ];

    const result = convertMessages(messages);

    // A tool message with a fake result should be injected
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const fakeResult = toolMsg.content.find((b) => b.toolCallId === "orphan_1");
    expect(fakeResult).toBeDefined();
    expect(fakeResult.isError).toBe(true);
  });

  test("does not inject fake result when tool result is present", () => {
    const messages = [
      { role: "user", content: "Search for something" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "web_search", input: { query: "something" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "Real results" },
        ],
      },
    ];

    const result = convertMessages(messages);
    const toolMessages = result.filter((m) => m.role === "tool");

    // Should have exactly one tool message with the real result (not an injected one)
    expect(toolMessages).toHaveLength(1);
    const fakeResult = toolMessages[0].content.find((b) => b.isError === true);
    expect(fakeResult).toBeUndefined();
  });
});

// ─── convertAnthropicToAlpha ──────────────────────────────────────────────────

describe("convertAnthropicToAlpha", () => {
  test("produces valid Alpha body structure", () => {
    const body = {
      model: "deepseek/deepseek-v4-pro",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      max_tokens: 1000,
      stream: true,
    };

    const result = convertAnthropicToAlpha(body);

    expect(result).toHaveProperty("config");
    expect(result).toHaveProperty("params");
    expect(result.params.model).toBe("deepseek/deepseek-v4-pro");
    expect(result.params.messages).toHaveLength(1);
    expect(result.params.stream).toBe(true);
    expect(result.params.max_tokens).toBe(1000);
  });

  test("extracts system prompt as string", () => {
    const body = {
      model: "claude-sonnet-4-6",
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "hi" }],
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.system).toBe("You are a helpful assistant.");
  });

  test("extracts system prompt from block array", () => {
    const body = {
      model: "claude-sonnet-4-6",
      system: [
        { type: "text", text: "Part 1." },
        { type: "text", text: "Part 2." },
      ],
      messages: [{ role: "user", content: "hi" }],
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.system).toBe("Part 1.\nPart 2.");
  });

  test("maps thinking.budget_tokens > 10000 to reasoning_effort: high", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "think hard" }],
      thinking: { budget_tokens: 15000 },
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.reasoning_effort).toBe("high");
  });

  test("maps thinking.budget_tokens 3000-10000 to reasoning_effort: medium", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "think" }],
      thinking: { budget_tokens: 5000 },
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.reasoning_effort).toBe("medium");
  });

  test("omits reasoning_effort when no thinking budget", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hello" }],
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.reasoning_effort).toBeUndefined();
  });

  test("defaults max_tokens to 64000 when not specified", () => {
    const body = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.params.max_tokens).toBe(64000);
  });

  test("permission mode is auto-accept", () => {
    const body = {
      model: "deepseek/deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
    };
    const result = convertAnthropicToAlpha(body);
    expect(result.permissionMode).toBe("auto-accept");
  });
});
