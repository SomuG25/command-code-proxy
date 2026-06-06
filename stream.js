const crypto = require("crypto");

// ─── Session Token Counter ────────────────────────────────────────────────────
// Tracks cumulative token usage across the entire proxy session.
const sessionStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedTokens: 0,
  totalRequests: 0,
  startTime: Date.now(),
};

function formatTokenCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function getSessionSummary() {
  const elapsed = Math.round((Date.now() - sessionStats.startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const time = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
  return `📈 session: ${formatTokenCount(sessionStats.totalInputTokens)} in (${formatTokenCount(sessionStats.totalCachedTokens)} cached) | ${formatTokenCount(sessionStats.totalOutputTokens)} out | ${sessionStats.totalRequests} reqs | ${time}`;
}

//
// Command Code's /alpha/generate returns SSE events in this format:
//   { type: "text-delta", text: "..." }
//   { type: "reasoning-start" }
//   { type: "reasoning-delta", text: "..." }
//   { type: "reasoning-end" }
//   { type: "tool-call", toolCallId, toolName, input/args }
//   { type: "tool-result", toolCallId, toolName, output }
//   { type: "finish", totalUsage, finishReason, rawFinishReason }
//   { type: "error", error: { message, statusCode } }
//
// Claude Code expects Anthropic SSE events:
//   event: message_start       → { type: "message_start", message: {...} }
//   event: content_block_start → { type: "content_block_start", index, content_block }
//   event: content_block_delta → { type: "content_block_delta", index, delta }
//   event: content_block_stop  → { type: "content_block_stop", index }
//   event: message_delta       → { type: "message_delta", delta: { stop_reason }, usage }
//   event: message_stop        → { type: "message_stop" }
//

class AlphaToAnthropicStreamConverter {
  constructor(model, res, estimatedInputTokens = 0) {
    this.model = model;
    this.res = res;
    this.started = false;
    this.contentIndex = -1;
    this.textBlockOpen = false;
    this.reasoningBlockOpen = false;
    this.estimatedInputTokens = estimatedInputTokens;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.buffer = "";
    this.hasTextContent = false;    // Track if any text was emitted
    this.reasoningText = "";       // Accumulate reasoning for fallback
  }

  /** Write a single Anthropic SSE event to the response. */
  writeEvent(event) {
    if (this.res.writableEnded || this.res.destroyed) return;
    try {
      this.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected — ignore write errors
    }
  }

  /** Ensure message_start has been sent. */
  ensureStarted() {
    if (this.started) return;
    this.started = true;
    this.writeEvent({
      type: "message_start",
      message: {
        id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "message",
        role: "assistant",
        content: [],
        model: this.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.estimatedInputTokens, output_tokens: 0 },
      },
    });
  }

  /** Open a text content block if one isn't already open. */
  openTextBlock() {
    if (this.textBlockOpen) return;
    this.closeReasoningBlock();
    this.ensureStarted();
    this.contentIndex++;
    this.textBlockOpen = true;
    this.writeEvent({
      type: "content_block_start",
      index: this.contentIndex,
      content_block: { type: "text", text: "" },
    });
  }

  /** Close the current text block if one is open. */
  closeTextBlock() {
    if (!this.textBlockOpen) return;
    this.writeEvent({ type: "content_block_stop", index: this.contentIndex });
    this.textBlockOpen = false;
  }

  /** Close reasoning block if open. */
  closeReasoningBlock() {
    if (!this.reasoningBlockOpen) return;
    this.writeEvent({ type: "content_block_stop", index: this.contentIndex });
    this.reasoningBlockOpen = false;
  }

  /** Process a single SSE line from Command Code. */
  processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // Skip non-JSON lines
    }

    switch (event.type) {
      case "text-delta":
        this.handleTextDelta(event);
        break;
      case "reasoning-start":
        this.handleReasoningStart();
        break;
      case "reasoning-delta":
        this.handleReasoningDelta(event);
        break;
      case "reasoning-end":
        this.handleReasoningEnd();
        break;
      case "tool-call":
        this.handleToolCall(event);
        break;
      case "tool-result":
        // Server-side tool results — Claude Code handles tools itself, skip
        break;
      case "finish":
        this.handleFinish(event);
        break;
      case "error":
        this.handleError(event);
        break;
      default:
        // Unknown event type — ignore silently
        break;
    }
  }

  handleTextDelta(event) {
    this.openTextBlock();
    this.hasTextContent = true;
    this.writeEvent({
      type: "content_block_delta",
      index: this.contentIndex,
      delta: { type: "text_delta", text: event.text },
    });
  }

  handleReasoningStart() {
    this.closeTextBlock();
    this.ensureStarted();
    this.contentIndex++;
    this.reasoningBlockOpen = true;
    this.writeEvent({
      type: "content_block_start",
      index: this.contentIndex,
      content_block: { type: "thinking", thinking: "" },
    });
  }

  handleReasoningDelta(event) {
    const text = event.text || "";
    this.reasoningText += text;
    this.writeEvent({
      type: "content_block_delta",
      index: this.contentIndex,
      delta: { type: "thinking_delta", thinking: text },
    });
  }

  handleReasoningEnd() {
    this.closeReasoningBlock();
  }

  handleToolCall(event) {
    // If Command Code already executed this tool server-side, 
    // don't send it as tool_use to Claude Code (it can't provide results for it)
    if (event.providerExecuted) {
      console.log(`  ⊘ skipping server-executed tool: ${event.toolName}`);
      return;
    }

    this.closeTextBlock();
    this.closeReasoningBlock();
    this.ensureStarted();
    this.contentIndex++;

    // Start the tool_use block
    this.writeEvent({
      type: "content_block_start",
      index: this.contentIndex,
      content_block: {
        type: "tool_use",
        id: event.toolCallId,
        name: event.toolName,
        input: {},
      },
    });

    // Send the full input as a single JSON delta
    const inputStr = JSON.stringify(event.input || event.args || {});
    this.writeEvent({
      type: "content_block_delta",
      index: this.contentIndex,
      delta: { type: "input_json_delta", partial_json: inputStr },
    });

    // Close the tool block
    this.writeEvent({ type: "content_block_stop", index: this.contentIndex });
  }

  handleFinish(event) {
    this.closeTextBlock();
    this.closeReasoningBlock();

    // If model only produced reasoning (thinking) with no text output,
    // copy reasoning into a text block. This fixes /compact and other
    // features that expect text content (not just thinking blocks).
    if (!this.hasTextContent && this.reasoningText.length > 0) {
      console.log(`  ℹ no text output, converting ${this.reasoningText.length} chars of reasoning to text`);
      this.openTextBlock();
      this.writeEvent({
        type: "content_block_delta",
        index: this.contentIndex,
        delta: { type: "text_delta", text: this.reasoningText },
      });
      this.closeTextBlock();
    }

    // If nothing was ever sent, send an empty text block
    if (!this.started) {
      this.ensureStarted();
      this.openTextBlock();
      this.closeTextBlock();
    }

    // Extract usage — Command Code may use different field names
    const usage = event.totalUsage || event.usage || {};
    if (Object.keys(usage).length > 0) {
      console.log(`  📊 usage: ${JSON.stringify(usage)}`);
    }
    this.inputTokens =
      usage.inputTokens || usage.promptTokens || usage.prompt_tokens ||
      usage.input_tokens || 0;
    this.outputTokens =
      usage.outputTokens || usage.completionTokens || usage.completion_tokens ||
      usage.output_tokens || 0;
    const cachedTokens =
      usage.cachedInputTokens || usage.inputTokenDetails?.cacheReadTokens || 0;

    // Accumulate session stats
    sessionStats.totalInputTokens += this.inputTokens;
    sessionStats.totalOutputTokens += this.outputTokens;
    sessionStats.totalCachedTokens += cachedTokens;
    sessionStats.totalRequests++;
    console.log(`  ${getSessionSummary()}`);

    // Map finish reason
    let stopReason = "end_turn";
    if (
      event.finishReason === "tool-calls" ||
      event.rawFinishReason === "tool_calls"
    ) {
      stopReason = "tool_use";
    } else if (event.finishReason === "length") {
      stopReason = "max_tokens";
    }

    this.writeEvent({
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens },
    });
    this.writeEvent({ type: "message_stop" });
  }

  handleError(event) {
    let errMsg = "Unknown upstream error";
    if (typeof event.error === "string") {
      errMsg = event.error;
    } else if (event.error?.message) {
      errMsg = event.error.message;
    } else if (typeof event.error === "object") {
      errMsg = JSON.stringify(event.error);
    }
    console.error(`  ✗ SSE error: ${errMsg}`);

    // If we haven't started, send a complete error response
    if (!this.started) {
      this.ensureStarted();
      this.openTextBlock();
      this.writeEvent({
        type: "content_block_delta",
        index: this.contentIndex,
        delta: { type: "text_delta", text: `Error: ${errMsg}` },
      });
      this.closeTextBlock();
    }

    this.writeEvent({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    this.writeEvent({ type: "message_stop" });
  }

  /** Feed a raw data chunk from the upstream response. */
  processChunk(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      this.processLine(line);
    }
  }

  /** Flush remaining buffer and ensure a complete response. */
  flush() {
    // Process any remaining data
    if (this.buffer.trim()) {
      this.processLine(this.buffer);
      this.buffer = "";
    }

    // If stream never started, send a minimal valid Anthropic response
    if (!this.started) {
      this.ensureStarted();
      this.openTextBlock();
      this.closeTextBlock();
      this.writeEvent({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      });
      this.writeEvent({ type: "message_stop" });
    }
  }
}

module.exports = { AlphaToAnthropicStreamConverter, sessionStats, getSessionSummary };
