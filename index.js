const http = require("http");
const { PORT, AUTH, CLI_VERSION, ALL_MODELS } = require("./config");
const { handleModels, handleMessages, handleHealth } = require("./handlers");
const { respondError } = require("./utils");
const { getSearchEngineStatus } = require("./websearch");

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
  const timestamp = new Date().toLocaleTimeString();

  console.log(`[${timestamp}] → ${req.method} ${pathname}`);

  try {
    // Route requests
    if (pathname === "/v1/models" && req.method === "GET") {
      return handleModels(req, res);
    }

    if (pathname === "/v1/messages" && req.method === "POST") {
      return handleMessages(req, res);
    }

    // Token counting — return a rough estimate
    if (pathname === "/v1/messages/count_tokens" && req.method === "POST") {
      const { readBody, respond } = require("./utils");
      const raw = await readBody(req);
      try {
        const body = JSON.parse(raw);
        const msgStr = JSON.stringify(body.messages || []);
        // Rough estimate: ~4 chars per token
        const tokens = Math.ceil(msgStr.length / 4);
        return respond(res, 200, { input_tokens: tokens });
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
    console.error(`  ✗ unhandled error: ${err.message}`);
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
  console.log(`  Search: ${getSearchEngineStatus()}`);
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
  console.log('Usage: claude --model "deepseek/deepseek-v4-pro"');
  console.log("");
  console.log("Waiting for requests...\n");
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

let keepAliveTimer = null;

process.on("SIGINT", () => {
  console.log("\n🛑 Proxy shutting down...");
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  server.close(() => process.exit(0));
});

// ─── Network Keep-Alive ──────────────────────────────────────────────────────
// Prevents WiFi power saving and hotspot timeouts from killing the connection.
// Runs a lightweight DNS resolve + HTTPS HEAD every 30 seconds to keep:
//   - DNS cache warm (prevents ENOTFOUND after laptop sleep)
//   - WiFi adapter active (prevents power saving disconnect)
//   - Hotspot connection alive (prevents phone from dropping idle devices)

const dns = require("dns");
const https = require("https");
const { CMD_BASE } = require("./config");

const KEEPALIVE_INTERVAL = 30_000; // 30 seconds

function keepAlivePing() {
  // Step 1: DNS resolve (warms the DNS cache)
  dns.resolve4(CMD_BASE, (dnsErr, addresses) => {
    if (dnsErr) {
      console.log(`  💤 keep-alive: DNS failed (${dnsErr.code || dnsErr.message}) — network may be asleep`);
      return;
    }

    // Step 2: HTTPS HEAD (keeps TCP + WiFi alive)
    const req = https.request(
      {
        hostname: CMD_BASE,
        port: 443,
        path: "/",
        method: "HEAD",
        timeout: 5000,
      },
      (res) => {
        res.resume(); // drain response
      }
    );

    req.on("error", () => {
      // Silently ignore — the DNS resolve already did the job
    });

    req.on("timeout", () => {
      req.destroy();
    });

    req.end();
  });
}

// Start keep-alive after server boots
server.on("listening", () => {
  keepAliveTimer = setInterval(keepAlivePing, KEEPALIVE_INTERVAL);
  // Run first ping immediately
  keepAlivePing();
  console.log(`  🏓 Keep-alive ping: every ${KEEPALIVE_INTERVAL / 1000}s → ${CMD_BASE}`);
  console.log("");
});
