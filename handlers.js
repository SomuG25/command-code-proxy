const crypto = require("crypto");
const { ALL_MODELS } = require("./config");
const { convertAnthropicToAlpha } = require("./converter");
const { AlphaToAnthropicStreamConverter } = require("./stream");
const { readBody, respond, respondError, forwardToAlpha } = require("./utils");
const { searchWeb, formatSearchResults } = require("./websearch");

// ─── Model name normalization ────────────────────────────────────────────────
// Claude Code sometimes sends versioned model names like "claude-haiku-4-5-20251001"
// or provider-prefixed names like "anthropic:claude-haiku-4-5".
// Command Code expects bare names like "deepseek/deepseek-v4-pro".
//
// IMPORTANT: Command Code does NOT serve Anthropic's own models (claude-*).
// Claude Code uses claude-haiku internally for background tasks (titles, summaries).
// We remap those to a fast, cheap model that actually works.
const FALLBACK_MODEL = "deepseek/deepseek-v4-pro";

function normalizeModel(model) {
  if (!model) return FALLBACK_MODEL;
  // Strip provider prefixes (anthropic:, openai:, google:, etc.)
  model = model.replace(/^[a-zA-Z]+:/, "");
  // Strip date suffixes like -20251001
  model = model.replace(/-\d{8}$/, "");
  // Remap Anthropic models → fallback (Command Code can't serve them)
  if (model.startsWith("claude-")) {
    return FALLBACK_MODEL;
  }
  return model;
}
// ─── Idle Auto-Block ─────────────────────────────────────────────────────────
// Blocks background requests after IDLE_TIMEOUT_MS of no user activity.
// Resumes instantly when user sends a real message.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let lastUserActivity = Date.now();
let idleWarningShown = false;

/**
 * Detect what type of request this is based on patterns.
 */
function classifyRequest(body) {
  const msgCount = (body.messages || []).length;
  const toolCount = (body.tools || []).length;
  const lastMsg = body.messages?.[body.messages.length - 1];
  const lastContent = typeof lastMsg?.content === "string"
    ? lastMsg.content
    : JSON.stringify(lastMsg?.content || "");

  // Title/summary generation — 1 message, 0 tools, short content
  if (msgCount <= 2 && toolCount === 0) {
    return "📝 title/summary";
  }

  // Subagent explore — many tools, duplicate message count pattern
  if (toolCount > 20 && msgCount > 100) {
    return "🔍 subagent/explore";
  }

  // Background compaction
  if (lastContent.includes("compact") || lastContent.includes("summarize this conversation")) {
    return "📦 compaction";
  }

  return "👤 user";
}

// ─── Request Handlers ────────────────────────────────────────────────────────

/**
 * GET /v1/models — Return list of available models.
 */
function handleModels(req, res) {
  respond(res, 200, {
    object: "list",
    data: ALL_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
    })),
  });
}

/**
 * POST /v1/messages — Main endpoint. Receives Anthropic format, converts,
 * forwards to /alpha/generate, and converts the response back.
 */
async function handleMessages(req, res) {
  // Parse body
  const rawBody = await readBody(req);
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return respondError(res, 400, "invalid_request_error", "Invalid JSON body");
  }

  const model = normalizeModel(body.model);
  const isStream = body.stream === true;
  const toolCount = (body.tools || []).length;
  const msgCount = (body.messages || []).length;

  // Normalize model name in body before conversion
  body.model = model;

  // ── Classify and tag the request ──────────────────────────────────────
  const requestType = classifyRequest(body);
  const isBackground = requestType !== "👤 user";

  console.log(`  ├ model=${model} stream=${isStream}`);
  console.log(`  ├ messages=${msgCount} tools=${toolCount} [${requestType}]`);

  // ── Idle auto-block ───────────────────────────────────────────────────
  // If this is a user request, update activity timestamp
  if (!isBackground) {
    lastUserActivity = Date.now();
    idleWarningShown = false;
  }

  const idleMs = Date.now() - lastUserActivity;
  if (isBackground && idleMs > IDLE_TIMEOUT_MS) {
    if (!idleWarningShown) {
      console.log(`  ⛔ IDLE BLOCK: rejecting background requests (idle ${Math.round(idleMs / 1000)}s)`);
      console.log(`  ⛔ Send a message in Claude Code to resume`);
      idleWarningShown = true;
    } else {
      console.log(`  ⛔ blocked [${requestType}]`);
    }
    // Return empty response to stop token drain
    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const msgId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const writeSSE = (evt) => res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      writeSSE({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
      writeSSE({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      writeSSE({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "[idle — proxy paused background requests]" } });
      writeSSE({ type: "content_block_stop", index: 0 });
      writeSSE({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { input_tokens: 0, output_tokens: 0 } });
      writeSSE({ type: "message_stop" });
      return res.end();
    } else {
      return respond(res, 200, { type: "message", role: "assistant", content: [{ type: "text", text: "[idle]" }], model, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } });
    }
  }

  // ── Handle server-side web_search requests ───────────────────────────
  // Claude Code sends these as separate requests with the web_search tool.
  // We execute the search and return results directly — no need to forward.
  const serverSearchResult = await handleServerSideSearch(body, res);
  if (serverSearchResult) return; // Already responded

  // ── Intercept empty web_search results in conversation history ────────
  await enhanceWebSearchResults(body.messages);

  // Set up abort controller to cancel upstream when client disconnects
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    // Convert Anthropic → Alpha format
    const alphaBody = convertAnthropicToAlpha(body);
    const convertedToolCount = alphaBody.params.tools.length;

    if (convertedToolCount !== toolCount) {
      console.log(
        `  ├ tools: ${toolCount} → ${convertedToolCount} (${toolCount - convertedToolCount} skipped, built-in converted)`
      );
    }

    // Debug: log message structure
    const convertedMsgs = alphaBody.params.messages;
    console.log(
      `  ├ converted msgs: ${convertedMsgs.length} [${convertedMsgs.slice(0, 5).map(m => {
        const ct = typeof m.content === "string" ? "str" : `arr(${m.content.length})`;
        return `${m.role}:${ct}`;
      }).join(", ")}${convertedMsgs.length > 5 ? ", ..." : ""}]`
    );

    // Forward to Command Code (with abort signal)
    const upstream = await forwardToAlpha(alphaBody, ac.signal);
    console.log(`  └ upstream status=${upstream.statusCode}`);

    // Handle upstream errors
    if (upstream.statusCode >= 400) {
      return handleUpstreamError(upstream, res);
    }

    // Handle response
    if (isStream) {
      handleStreamResponse(upstream, res, model, ac, body, alphaBody);
    } else {
      handleNonStreamResponse(upstream, res, model);
    }
  } catch (err) {
    // Suppress errors from client disconnect
    if (err.name === "AbortError" || ac.signal.aborted) return;
    console.error(`  ✗ error: ${err.message}`);
    respondError(res, 500, "api_error", err.message);
  }
}

/**
 * Handle upstream error responses.
 */
function handleUpstreamError(upstream, res) {
  const errChunks = [];
  upstream.on("data", (c) => errChunks.push(c));
  upstream.on("end", () => {
    const raw = Buffer.concat(errChunks).toString();
    console.error(`  ✗ upstream error: ${raw.slice(0, 300)}`);
    respondError(res, upstream.statusCode, "api_error", raw.slice(0, 500));
  });
}

/**
 * Handle streaming response — convert Alpha SSE → Anthropic SSE.
 * Detects transient SSE errors (service unavailable, overloaded) and retries
 * automatically when no data has been written to the client yet.
 */
function handleStreamResponse(upstream, res, model, ac, body, alphaBody) {
  const MAX_RETRIES = 25;
  const RETRY_DELAY_MS = 2000;
  const TRANSIENT_PATTERNS = /temporarily unavailable|overloaded|try again|network connection lost|connection reset|socket hang up|ECONNRESET|timeout|rate limit|too many requests|internal server error|bad gateway|service unavailable|gateway timeout/i;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Estimate input tokens from request body so message_start has a real number
  // (Claude Code reads input_tokens from message_start, which we send before knowing actual usage)
  const msgStr = JSON.stringify(body?.messages || []);
  const toolStr = JSON.stringify(body?.tools || []);
  const sysStr = typeof body?.system === "string" ? body.system : JSON.stringify(body?.system || "");
  const estimatedInputTokens = Math.ceil((msgStr.length + toolStr.length + sysStr.length) / 4);

  function attachStream(src, retryCount) {
    const converter = new AlphaToAnthropicStreamConverter(model, res, estimatedInputTokens);
    let retried = false;

    src.on("data", (chunk) => {
      if (retried) return;
      const text = chunk.toString();

      // Check for transient SSE error before the converter has written anything
      if (!converter.started && retryCount < MAX_RETRIES) {
        // Parse each line to look for an error event
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            if (evt.type === "error") {
              const errMsg = typeof evt.error === "string"
                ? evt.error
                : evt.error?.message || JSON.stringify(evt.error);
              if (TRANSIENT_PATTERNS.test(errMsg)) {
                retried = true;
                src.destroy();
                console.log(`  ↻ retrying after transient error... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                setTimeout(async () => {
                  try {
                    const newUpstream = await forwardToAlpha(alphaBody, ac.signal);
                    console.log(`  └ retry upstream status=${newUpstream.statusCode}`);
                    if (newUpstream.statusCode >= 400) {
                      // Can't retry an HTTP-level error, just forward it as text
                      const errChunks = [];
                      newUpstream.on("data", (c) => errChunks.push(c));
                      newUpstream.on("end", () => {
                        const raw = Buffer.concat(errChunks).toString();
                        console.error(`  ✗ retry upstream error: ${raw.slice(0, 300)}`);
                        converter.ensureStarted();
                        converter.openTextBlock();
                        converter.res.write(
                          `event: content_block_delta\ndata: ${JSON.stringify({
                            type: "content_block_delta",
                            index: converter.contentIndex,
                            delta: { type: "text_delta", text: `Error: ${raw.slice(0, 500)}` },
                          })}\n\n`
                        );
                        converter.closeTextBlock();
                        converter.flush();
                        if (!res.writableEnded) res.end();
                      });
                    } else {
                      attachStream(newUpstream, retryCount + 1);
                    }
                  } catch (retryErr) {
                    if (retryErr.name === "AbortError" || ac.signal.aborted) return;
                    console.error(`  ✗ retry failed: ${retryErr.message}`);
                    converter.flush();
                    if (!res.writableEnded) res.end();
                  }
                }, RETRY_DELAY_MS);
                return;
              }
            }
          } catch {
            // Not JSON, ignore
          }
        }
      }

      converter.processChunk(text);
    });

    src.on("end", () => {
      if (retried) return;
      converter.flush();
      if (!res.writableEnded) res.end();
    });

    src.on("error", (err) => {
      if (retried) return;
      // Suppress "aborted" errors from client disconnects
      if (err.message === "aborted" || ac?.signal?.aborted) return;
      console.error(`  ✗ stream error: ${err.message}`);
      converter.flush();
      if (!res.writableEnded) res.end();
    });
  }

  attachStream(upstream, 0);
}

/**
 * Handle non-streaming response — collect all events, build Anthropic response.
 */
function handleNonStreamResponse(upstream, res, model) {
  const allEvents = [];
  let sseBuffer = "";

  upstream.on("data", (chunk) => {
    sseBuffer += chunk.toString();
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        allEvents.push(JSON.parse(trimmed));
      } catch {}
    }
  });

  upstream.on("end", () => {
    // Process remaining buffer
    if (sseBuffer.trim()) {
      try {
        allEvents.push(JSON.parse(sseBuffer.trim()));
      } catch {}
    }

    const anthResp = buildNonStreamingResponse(allEvents, model);
    respond(res, 200, anthResp);
  });
}

/**
 * Build a complete Anthropic /v1/messages response from collected SSE events.
 */
function buildNonStreamingResponse(events, model) {
  const content = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "end_turn";
  let currentText = "";

  for (const event of events) {
    switch (event.type) {
      case "text-delta":
        currentText += event.text;
        break;

      case "tool-call":
        if (currentText) {
          content.push({ type: "text", text: currentText });
          currentText = "";
        }
        content.push({
          type: "tool_use",
          id: event.toolCallId,
          name: event.toolName,
          input: event.input || event.args || {},
        });
        break;

      case "finish": {
        const usage = event.totalUsage || event.usage || {};
        if (Object.keys(usage).length > 0) {
          console.log(`  📊 usage: ${JSON.stringify(usage)}`);
        }
        inputTokens =
          usage.inputTokens || usage.promptTokens || usage.prompt_tokens ||
          usage.input_tokens || 0;
        outputTokens =
          usage.outputTokens || usage.completionTokens || usage.completion_tokens ||
          usage.output_tokens || 0;
        if (event.finishReason === "tool-calls") stopReason = "tool_use";
        else if (event.finishReason === "length") stopReason = "max_tokens";
        break;
      }
    }
  }

  if (currentText) {
    content.push({ type: "text", text: currentText });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/**
 * GET / or /health — Health check.
 */
function handleHealth(req, res) {
  const { AUTH } = require("./config");
  respond(res, 200, {
    status: "ok",
    proxy: "cc-proxy",
    user: AUTH.userName,
    models: ALL_MODELS.length,
    endpoint: "/alpha/generate",
  });
}

// ─── Server-Side Web Search ──────────────────────────────────────────────────

/**
 * Detect and handle server-side web search requests.
 * Claude Code sends these as separate POST /v1/messages with:
 *   - 1 message (the user query)
 *   - 1 tool (web_search_20250305 type)
 * We execute the search and return results in Anthropic's server_tool_use format.
 *
 * Returns true if we handled it, false if this isn't a search request.
 */
async function handleServerSideSearch(body, res) {
  const tools = body.tools || [];

  // Detect: does this request have a web_search built-in tool?
  const wsToolIdx = tools.findIndex(
    (t) => t.type === "web_search_20250305" || (t.name === "web_search" && !t.input_schema)
  );
  if (wsToolIdx === -1) return false;

  // Get the user's query from the last message
  const msgs = body.messages || [];
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg) return false;

  const userQuery =
    typeof lastMsg.content === "string"
      ? lastMsg.content
      : Array.isArray(lastMsg.content)
        ? lastMsg.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(" ")
        : "";

  if (!userQuery) return false;

  // Clean up the query for better DuckDuckGo results
  const cleanedQuery = cleanSearchQuery(userQuery);
  console.log(`  🔍 server-side web search: "${cleanedQuery.slice(0, 80)}"`);

  // Execute real search
  const results = await searchWeb(cleanedQuery);
  console.log(`  🔍 got ${results.length} results`);

  const isStream = body.stream === true;
  const msgId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const toolUseId = `srvtoolu_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  if (isStream) {
    // Return as Anthropic SSE stream
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const write = (event) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

    // message_start
    write({
      type: "message_start",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        content: [],
        model: body.model || "deepseek/deepseek-v4-pro",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    // server_tool_use block (the search call)
    write({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "server_tool_use",
        id: toolUseId,
        name: "web_search",
        input: { query: userQuery },
      },
    });
    write({ type: "content_block_stop", index: 0 });

    // web_search_tool_result block (the results)
    write({
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: toolUseId,
        content: results.map((r) => ({
          type: "web_search_result",
          url: r.url,
          title: r.title,
          encrypted_content: r.snippet,
          page_age: null,
        })),
      },
    });
    write({ type: "content_block_stop", index: 1 });

    // Text block with a summary
    const summaryText = results.length > 0
      ? `I found ${results.length} results. Let me analyze them.\n`
      : "I couldn't find any search results. Let me try a different approach.\n";

    write({
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "" },
    });
    write({
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: summaryText },
    });
    write({ type: "content_block_stop", index: 2 });

    // message_delta + stop
    write({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 50 },
    });
    write({ type: "message_stop" });

    res.end();
  } else {
    // Non-streaming response
    respond(res, 200, {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [
        {
          type: "server_tool_use",
          id: toolUseId,
          name: "web_search",
          input: { query: userQuery },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: toolUseId,
          content: results.map((r) => ({
            type: "web_search_result",
            url: r.url,
            title: r.title,
            encrypted_content: r.snippet,
            page_age: null,
          })),
        },
        {
          type: "text",
          text:
            results.length > 0
              ? `I found ${results.length} results. Let me analyze them.`
              : "I couldn't find any search results.",
        },
      ],
      model: body.model || "deepseek/deepseek-v4-pro",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 50 },
    });
  }

  return true;
}

// ─── Web Search Enhancement ──────────────────────────────────────────────────


/**
 * Scan messages for empty web_search tool_results.
 * When found, execute a real search and replace the content.
 *
 * Flow:
 *   1. Model calls web_search → Claude Code gets tool_use
 *   2. Claude Code tries to execute locally → gets 0 results
 *   3. Claude Code sends tool_result with empty content
 *   4. THIS function detects it, runs DuckDuckGo search, injects real results
 *   5. Model now has actual search data to work with
 */
async function enhanceWebSearchResults(messages) {
  if (!messages || messages.length === 0) return;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Only check user messages with array content (tool_results live here)
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;

      // Find the matching tool_use in the previous assistant message
      const prevMsg = messages[i - 1];
      if (!prevMsg || prevMsg.role !== "assistant" || !Array.isArray(prevMsg.content)) continue;

      const toolUse = prevMsg.content.find(
        (b) => b.type === "tool_use" && b.id === block.tool_use_id && b.name === "web_search"
      );
      if (!toolUse) continue;

      // Check if the result is empty/minimal
      const resultText = extractResultText(block.content);
      if (resultText.length > 100) continue; // Has real results, skip

      // Get the search query and clean it up
      const rawQuery = toolUse.input?.query;
      if (!rawQuery) continue;

      const query = cleanSearchQuery(rawQuery);
      console.log(`  🔍 executing web search: "${query}"`);

      // Execute real search
      const results = await searchWeb(query);

      if (results.length > 0) {
        console.log(`  🔍 got ${results.length} results`);
        // Replace the empty content with real results
        block.content = [{ type: "text", text: formatSearchResults(results, query) }];
        block.is_error = false;
      }
    }
  }
}

/**
 * Extract plain text from a tool_result content field.
 */
function extractResultText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c.type === "text") return c.text || "";
        return JSON.stringify(c);
      })
      .join(" ");
  }
  return JSON.stringify(content);
}

// ─── Search Query Cleanup ────────────────────────────────────────────────────

/**
 * Clean up web search queries for better DuckDuckGo results.
 * The model often sends overly specific or prefixed queries like:
 *   "Perform a web search for the query: gemini live api..."
 *   'gemini live api "inputTranscription" "outputTranscription"'
 * DuckDuckGo chokes on long quoted strings and meta-prefixes.
 */
function cleanSearchQuery(query) {
  if (!query) return "";

  // Remove common meta-prefixes the model adds
  query = query
    .replace(/^Perform a web search for the query:\s*/i, "")
    .replace(/^Search the web for:\s*/i, "")
    .replace(/^Search for:\s*/i, "")
    .replace(/^Web search:\s*/i, "")
    .replace(/^Please search for:\s*/i, "")
    .trim();

  // Remove excessive exact-match quotes that DDG can't handle well
  // e.g., 'gemini "inputTranscription" "outputTranscription" "config"'
  // Count quoted segments — if more than 2, remove all quotes
  const quoteCount = (query.match(/"/g) || []).length;
  if (quoteCount > 4) {
    query = query.replace(/"/g, "");
  }

  // Remove site: operators (DDG handles them differently)
  // Keep the domain as a keyword instead
  query = query.replace(/site:(\S+)/g, "$1");

  // Cap query length — DDG returns bad results for very long queries
  if (query.length > 150) {
    // Try to cut at a word boundary
    query = query.slice(0, 150).replace(/\s+\S*$/, "");
  }

  return query.trim();
}

module.exports = {
  handleModels,
  handleMessages,
  handleHealth,
};
