const https = require("https");
const crypto = require("crypto");
const { CMD_BASE, ALPHA_ENDPOINT, AUTH, CLI_VERSION } = require("./config");

// ─── HTTP Utility Functions ──────────────────────────────────────────────────

/**
 * Read the full body from an incoming HTTP request.
 */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

/**
 * Send a JSON response. Safe to call even if response is already ended.
 */
function respond(res, status, data) {
  if (res.writableEnded || res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

/**
 * Send an Anthropic-format error response.
 */
function respondError(res, status, type, message) {
  respond(res, status, {
    type: "error",
    error: { type, message },
  });
}

/**
 * Forward a request body to Command Code's /alpha/generate endpoint.
 * Returns the raw Node.js http.IncomingMessage (upstream response).
 * 
 * @param {object} requestBody - The JSON body to send
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the request
 */
function forwardToAlpha(requestBody, signal) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(requestBody);
    const sessionId = crypto.randomUUID();

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH.apiKey}`,
      "x-project-slug": "proxy",
      "x-cli-environment": "production",
      "x-command-code-version": CLI_VERSION,
      "x-session-id": sessionId,
      "x-co-flag": "false",
      "x-taste-learning": "false",
      "Content-Length": Buffer.byteLength(payload),
    };

    const options = {
      hostname: CMD_BASE,
      port: 443,
      path: ALPHA_ENDPOINT,
      method: "POST",
      headers,
      signal,
    };

    const req = https.request(options, (res) => resolve(res));
    req.on("error", (err) => {
      // Don't reject on abort — it's expected when client disconnects
      if (err.name === "AbortError" || signal?.aborted) return;
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Forward with retry — retries once on transient network errors.
 */
async function forwardToAlphaWithRetry(requestBody, signal) {
  const RETRYABLE = ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"];

  try {
    return await forwardToAlpha(requestBody, signal);
  } catch (err) {
    if (RETRYABLE.includes(err.code)) {
      console.log(`  ↻ retrying after ${err.code}...`);
      await new Promise((r) => setTimeout(r, 1000));
      return forwardToAlpha(requestBody, signal);
    }
    throw err;
  }
}

module.exports = { readBody, respond, respondError, forwardToAlpha: forwardToAlphaWithRetry };
