const https = require("https");

// ─── Web Search with Fallback ─────────────────────────────────────────────────
//
// Primary:   DuckDuckGo HTML   — html.duckduckgo.com  (no key, no cost)
// Fallback:  Brave Search HTML — search.brave.com     (no key, no cost)
//
// Both engines are scraped from their HTML endpoints. No API keys or credits
// are required. If the primary engine is blocked or returns 0 results, the
// fallback is tried automatically.

/**
 * Search the web using the best available free engine.
 * Falls back to Brave Search if DuckDuckGo fails or returns nothing.
 *
 * @param {string} query      - The search query.
 * @param {number} maxResults - Max results to return (default: 10).
 * @returns {Promise<Array<{title: string, url: string, snippet: string, source: string}>>}
 */
async function searchWeb(query, maxResults = 10) {
  if (!query || !query.trim()) return [];

  // ── 1. Try DuckDuckGo ─────────────────────────────────────────────────────
  try {
    const html = await httpGet(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );
    const results = parseDuckDuckGoResults(html, maxResults);
    if (results.length > 0) {
      return results.map((r) => ({ ...r, source: "duckduckgo" }));
    }
    console.log("  🔎 DuckDuckGo returned 0 results — trying Brave Search...");
  } catch (err) {
    console.log(`  🔎 DuckDuckGo failed (${err.message}) — trying Brave Search...`);
  }

  // ── 2. Fallback: Brave Search ─────────────────────────────────────────────
  try {
    const html = await httpGet(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
      {
        // Brave requires a more realistic browser UA to avoid being blocked
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      }
    );
    const results = parseBraveResults(html, maxResults);
    if (results.length > 0) {
      return results.map((r) => ({ ...r, source: "brave" }));
    }
    console.log("  🔎 Brave Search returned 0 results.");
  } catch (err) {
    console.log(`  🔎 Brave Search also failed: ${err.message}`);
  }

  return [];
}

/**
 * Format search results as a readable string for the model.
 * Includes the search engine source so the model knows where results came from.
 */
function formatSearchResults(results, query) {
  if (!results || results.length === 0) {
    return `Web search for "${query}" returned no results.`;
  }

  const engine = results[0]?.source || "web";
  const lines = [`Web search results for: "${query}" [via ${engine}]\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── DuckDuckGo Parser ────────────────────────────────────────────────────────

function parseDuckDuckGoResults(html, max) {
  const results = [];

  // DuckDuckGo HTML result structure:
  // <a rel="nofollow" class="result__a" href="...">TITLE</a>
  // <a class="result__snippet" href="...">SNIPPET</a>
  const linkRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < Math.min(links.length, max); i++) {
    const rawUrl = links[i][1];
    const url = decodeDDGUrl(rawUrl);
    const title = stripHtml(links[i][2]);
    const snippet = snippets[i] ? stripHtml(snippets[i][1]) : "";

    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * Decode DuckDuckGo redirect URLs.
 * Format: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
 */
function decodeDDGUrl(raw) {
  if (!raw) return "";

  if (!raw.includes("duckduckgo.com/l/")) {
    return raw.startsWith("//") ? `https:${raw}` : raw;
  }

  const match = raw.match(/uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return raw;
}

// ─── Brave Search Parser ──────────────────────────────────────────────────────

/**
 * Parse Brave Search HTML results.
 *
 * Brave Search HTML structure (as of 2025):
 *   <div class="snippet" data-type="web">
 *     <a class="heading-serpresult" href="URL">TITLE</a>
 *     <p class="snippet-description">...SNIPPET...</p>
 *   </div>
 *
 * Brave occasionally updates its HTML, so we use multiple fallback patterns.
 */
function parseBraveResults(html, max) {
  const results = [];

  // Pattern 1: Standard snippet containers (most common)
  // Brave uses data-pos for result ranking
  const snippetBlockRegex =
    /<div[^>]*class="[^"]*snippet[^"]*"[^>]*data-type="web"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/gi;

  const titleRegex = /<a[^>]*class="[^"]*heading-serpresult[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const descRegex = /<p[^>]*class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/p>/i;

  let blockMatch;
  while ((blockMatch = snippetBlockRegex.exec(html)) !== null && results.length < max) {
    const block = blockMatch[1];
    const titleMatch = block.match(titleRegex);
    const descMatch = block.match(descRegex);

    if (titleMatch) {
      const url = titleMatch[1];
      const title = stripHtml(titleMatch[2]);
      const snippet = descMatch ? stripHtml(descMatch[1]) : "";

      if (url && title && !url.includes("brave.com/search")) {
        results.push({ title, url, snippet });
      }
    }
  }

  // Pattern 2: Fallback — generic anchor + description pairs if pattern 1 fails
  if (results.length === 0) {
    const linkRegex =
      /<a[^>]*\bhref="(https?:\/\/[^"]{10,})"[^>]*class="[^"]*heading[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const links = [...html.matchAll(linkRegex)];

    for (let i = 0; i < Math.min(links.length, max); i++) {
      const url = links[i][1];
      const title = stripHtml(links[i][2]);
      if (url && title && !url.includes("brave.com")) {
        results.push({ title, url, snippet: "" });
      }
    }
  }

  return results;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url, extraHeaders = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : require("http");

    const defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    };

    const req = mod.get(
      url,
      {
        headers: { ...defaultHeaders, ...extraHeaders },
        timeout: 12000,
      },
      (res) => {
        // Follow redirects
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          const nextUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`;
          res.resume();
          return resolve(httpGet(nextUrl, extraHeaders, redirects - 1));
        }

        // Treat non-2xx as an error (e.g. 429 rate limit, 403 blocked)
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Search request timed out"));
    });
  });
}

// ─── HTML utilities ───────────────────────────────────────────────────────────

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { searchWeb, formatSearchResults };
