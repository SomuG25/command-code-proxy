const http = require("http");
const { PORT, AUTH, CLI_VERSION, ALL_MODELS } = require("./config");
const { handleModels, handleMessages, handleHealth } = require("./handlers");
const { respondError } = require("./utils");
const log = require("./logger");
const { countMessageTokens } = require("./tokenizer");

// ─── Main Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  log.request(req.method, pathname);

  try {
    // Route requests
    if (pathname === "/v1/models" && req.method === "GET") {
      return handleModels(req, res);
    }

    if (pathname === "/v1/messages" && req.method === "POST") {
      return handleMessages(req, res);
    }

    // Token counting — accurate BPE-calibrated estimation
    if (pathname === "/v1/messages/count_tokens" && req.method === "POST") {
      const { readBody, respond } = require("./utils");
      const raw = await readBody(req);
      try {
        const body = JSON.parse(raw);
        const result = countMessageTokens(body);
        log.debug("token count:", result.input_tokens);
        return respond(res, 200, result);
      } catch {
        return respond(res, 200, { input_tokens: 0 });
      }
    }

    if ((pathname === "/health" || pathname === "/") && req.method === "GET") {
      return handleHealth(req, res);
    }

    // HEAD requests (health checks from Claude Code)
    if (req.method === "HEAD") {
      res.writeHead(200);
      return res.end();
    }

    // 404
    respondError(res, 404, "not_found", `Unknown endpoint: ${pathname}`);
  } catch (err) {
    log.error("Unhandled server error:", err.message);
    respondError(res, 500, "api_error", err.message);
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  ⚡ CC-Proxy v3 on http://localhost:${PORT}               ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  Claude Code ──→ Proxy ──→ /alpha/generate             ║");
  console.log("║  Uses CLI endpoint (works on FREE Go plan!)            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  User: ${AUTH.userName}`);
  console.log(`  CLI Version: ${CLI_VERSION}`);
  console.log(`  Log Level: ${log.level}`);
  console.log("");
  console.log("Available models:");
  console.log("─────────────────────────────────────────────────────────");

  const groups = {};
  for (const m of ALL_MODELS) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }

  for (const [provider, models] of Object.entries(groups)) {
    console.log(`  ${provider.toUpperCase()}`);
    for (const m of models) {
      console.log(`    • ${m.id.padEnd(38)} ${m.name}`);
    }
  }

  console.log("");
  console.log("─────────────────────────────────────────────────────────");
  console.log('Usage: claude --model "deepseek" "your prompt"');
  console.log("       claude --model "+ '"' +"gemini" + '"' + " \"your prompt\"");
  console.log("");
  console.log("Waiting for requests...\n");
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

process.on("SIGINT", () => {
  log.warn("Proxy shutting down (SIGINT)...");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  log.warn("Proxy shutting down (SIGTERM)...");
  server.close(() => process.exit(0));
});
