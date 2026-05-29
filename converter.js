const { ANTHROPIC_BUILTIN_TOOLS } = require("./config");

// ─── Convert Anthropic /v1/messages → Command Code /alpha/generate ───────────
//
// Claude Code sends Anthropic API format. Command Code CLI's /alpha/generate
// uses Vercel AI SDK style messages. This module handles the translation.
//
// KEY FORMAT DIFFERENCES:
//
//   Anthropic format (Claude Code sends):
//     messages: [
//       { role: "user", content: "hi" }
//       { role: "assistant", content: [{ type: "text", ... }, { type: "tool_use", ... }] }
//       { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
//     ]
//
//   Vercel AI SDK format (Command Code expects):
//     messages: [
//       { role: "user", content: "hi" }    ← string for simple text
//       { role: "assistant", content: [{ type: "text", ... }, { type: "tool-call", ... }] }
//       { role: "tool", content: [{ type: "tool-result", toolCallId, output }] }
//     ]
//
//   Notice: tool results have role:"tool" (not "user"), types use hyphens (not underscores)
//

// ─── Tool conversion ────────────────────────────────────────────────────────

/**
 * Convert all tools, including Anthropic built-in tools.
 * Built-in tools (web_search, text_editor, etc.) get converted to regular
 * tool format with proper input_schema. Unknown built-in types are skipped.
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return [];

  const result = [];

  for (const t of tools) {
    // Built-in Anthropic tool (has `type` field like "web_search_20250305")
    if (t.type && ANTHROPIC_BUILTIN_TOOLS[t.type]) {
      const schema = ANTHROPIC_BUILTIN_TOOLS[t.type];
      result.push({
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema,
      });
      continue;
    }

    // Unknown built-in type (computer, mcp, etc.) — skip
    if (t.type && !t.input_schema && !t.inputSchema) {
      continue;
    }

    // Regular tool — pass through
    if (t.input_schema || t.inputSchema) {
      result.push({
        name: t.name,
        description: t.description || "",
        input_schema: t.input_schema || t.inputSchema || { type: "object", properties: {} },
      });
    }
  }

  return result;
}

// ─── Message conversion ──────────────────────────────────────────────────────

/**
 * Convert Anthropic messages array to Alpha messages array.
 *
 * The main complexity is handling tool results:
 * - Anthropic: tool_result blocks are inside role:"user" messages
 * - Alpha/Vercel AI SDK: tool-result blocks are in separate role:"tool" messages
 *
 * Also, user messages with just text should use content as a plain string,
 * not an array.
 */
function convertMessages(messages) {
  if (!messages || messages.length === 0) return [];

  const result = [];

  for (const msg of messages) {
    // Convert 'system' role → 'user' (Command Code only accepts user/assistant/tool)
    // Claude Code sometimes injects system messages mid-conversation for context
    const role = msg.role === "system" ? "user" : msg.role;

    // Simple string content — pass through directly
    if (typeof msg.content === "string") {
      result.push({ role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      result.push({ role, content: JSON.stringify(msg.content) });
      continue;
    }

    // Array content — need to split by type
    if (role === "user") {
      convertUserMessage(msg.content, result);
    } else if (role === "assistant") {
      convertAssistantMessage(msg.content, result);
    } else {
      // Other roles — convert blocks
      result.push({
        role,
        content: msg.content.map(convertGenericBlock),
      });
    }
  }

  // ── Heal orphaned tool calls ─────────────────────────────────────────────
  // When a user interrupts mid-tool-call, the assistant message has tool-call
  // blocks but no matching tool-result in the next message. Command Code
  // rejects this. Fix: inject fake empty results for orphaned tool calls.
  return healOrphanedToolCalls(result);
}

/**
 * Scan converted messages and fix:
 * 1. Assistant tool-calls without matching tool-results → inject fake results
 * 2. Stray role:"tool" messages without a preceding assistant tool-call → remove them
 */
function healOrphanedToolCalls(messages) {
  // ── Pass 1: inject fake results for orphaned tool calls ──────────────
  const pass1 = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    pass1.push(msg);

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const toolCallIds = [];
    for (const block of msg.content) {
      if (block.type === "tool-call" && block.toolCallId) {
        toolCallIds.push({ id: block.toolCallId, name: block.toolName });
      }
    }
    if (toolCallIds.length === 0) continue;

    // Check next message for results
    const nextMsg = messages[i + 1];
    const resultIds = new Set();

    if (nextMsg && nextMsg.role === "tool" && Array.isArray(nextMsg.content)) {
      for (const block of nextMsg.content) {
        if (block.type === "tool-result" && block.toolCallId) {
          resultIds.add(block.toolCallId);
        }
      }
    }

    const orphans = toolCallIds.filter((tc) => !resultIds.has(tc.id));

    if (orphans.length > 0) {
      console.log(
        `  ⚕ healed ${orphans.length} orphaned tool call(s): ${orphans.map((o) => o.name).join(", ")}`
      );

      const fakeResults = orphans.map((tc) => ({
        type: "tool-result",
        toolCallId: tc.id,
        toolName: tc.name,
        output: { type: "text", value: "[Interrupted by user]" },
        isError: true,
      }));

      if (nextMsg && nextMsg.role === "tool" && Array.isArray(nextMsg.content)) {
        nextMsg.content.push(...fakeResults);
      } else {
        pass1.push({ role: "tool", content: fakeResults });
      }
    }
  }

  // ── Pass 2: remove stray tool messages and validate order ────────────
  const pass2 = [];

  for (let i = 0; i < pass1.length; i++) {
    const msg = pass1[i];

    if (msg.role === "tool") {
      // A tool message MUST follow an assistant message that has tool-call blocks
      const prev = pass2[pass2.length - 1];
      if (!prev || prev.role !== "assistant" || !Array.isArray(prev.content)) {
        console.log(`  ⚕ removed stray tool message at index ${i}`);
        continue; // skip it
      }
      const hasToolCalls = prev.content.some((b) => b.type === "tool-call");
      if (!hasToolCalls) {
        console.log(`  ⚕ removed tool message without preceding tool-calls at index ${i}`);
        continue; // skip it
      }
    }

    pass2.push(msg);
  }

  return pass2;
}

/**
 * Convert a user message's content blocks.
 * Splits tool_result blocks into separate role:"tool" messages.
 * Regular text stays as role:"user".
 */
function convertUserMessage(contentBlocks, result) {
  const textParts = [];
  const toolResults = [];

  for (const block of contentBlocks) {
    if (block.type === "tool_result") {
      toolResults.push(block);
    } else if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "image") {
      textParts.push(`[Image: ${block.source?.media_type || "image"}]`);
    }
    // Skip unknown block types
  }

  // Emit tool results FIRST (must come right after the assistant's tool calls)
  if (toolResults.length > 0) {
    const toolContent = toolResults.map((tr) => ({
      type: "tool-result",
      toolCallId: tr.tool_use_id,
      toolName: tr.tool_name || "unknown",
      output: formatToolResultOutput(tr.content),
      isError: tr.is_error || false,
    }));

    result.push({ role: "tool", content: toolContent });
  }

  // Then emit any user text
  if (textParts.length > 0) {
    result.push({ role: "user", content: textParts.join("\n") });
  }
}

/**
 * Convert an assistant message's content blocks.
 * Maps tool_use → tool-call, text stays as text, thinking → reasoning.
 */
function convertAssistantMessage(contentBlocks, result) {
  const blocks = [];

  for (const block of contentBlocks) {
    switch (block.type) {
      case "text":
        if (block.text) {
          blocks.push({ type: "text", text: block.text });
        }
        break;

      case "thinking":
        if (block.thinking) {
          blocks.push({ type: "reasoning", text: block.thinking });
        }
        break;

      case "tool_use":
        blocks.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          input: block.input || {},
          args: block.input || {},
        });
        break;

      default:
        // Skip unknown assistant block types
        break;
    }
  }

  if (blocks.length > 0) {
    result.push({ role: "assistant", content: blocks });
  }
}

/**
 * Convert a generic content block (fallback).
 */
function convertGenericBlock(block) {
  if (block.type === "text") return { type: "text", text: block.text };
  return { type: "text", text: JSON.stringify(block) };
}

/**
 * Format tool result content into Alpha's output format.
 */
function formatToolResultOutput(content) {
  if (typeof content === "string") {
    return { type: "text", value: content };
  }
  if (Array.isArray(content)) {
    const text = content
      .map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "image") return "[Image]";
        return JSON.stringify(c);
      })
      .join("\n");
    return { type: "text", value: text };
  }
  return { type: "text", value: JSON.stringify(content || "") };
}

// ─── System prompt ───────────────────────────────────────────────────────────

function extractSystem(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((b) => b.text || "").join("\n");
  return "";
}

// ─── Reasoning effort ────────────────────────────────────────────────────────

function getReasoningEffort(body) {
  if (body.thinking?.budget_tokens) {
    const budget = body.thinking.budget_tokens;
    if (budget > 10000) return "high";
    if (budget > 3000) return "medium";
    return "low";
  }
  return undefined;
}

// ─── Config builder ──────────────────────────────────────────────────────────

function buildConfig() {
  const os = require("os");
  const cwd = process.cwd();

  return {
    workingDir: cwd,
    date: new Date().toISOString(),
    environment: `${os.platform()} ${os.release()} | node ${process.version}`,
    structure: [],
    isGitRepo: false,
    currentBranch: "",
    mainBranch: "",
    gitStatus: "",
    recentCommits: [],
  };
}

// ─── Main conversion ─────────────────────────────────────────────────────────

/**
 * Convert Anthropic /v1/messages body → /alpha/generate body.
 */
function convertAnthropicToAlpha(body) {
  const tools = convertTools(body.tools);
  const messages = convertMessages(body.messages);
  const system = extractSystem(body.system);
  const reasoningEffort = getReasoningEffort(body);

  return {
    config: buildConfig(),
    memory: null,
    taste: null,
    skills: null,
    permissionMode: "auto-accept",
    params: {
      model: body.model || "claude-sonnet-4-6",
      messages,
      tools,
      system,
      max_tokens: body.max_tokens || 64000,
      stream: true,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    },
  };
}

module.exports = {
  convertAnthropicToAlpha,
  convertTools,
  convertMessages,
};
