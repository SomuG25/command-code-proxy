const https = require("https");
const http = require("http");

// ─── Search Engine Configuration ─────────────────────────────────────────────
// Set SEARXNG_URL env var to use SearXNG as primary search engine.
// Falls back to DuckDuckGo if SearXNG is not configured or fails.

const SEARXNG_URL = process.env.SEARXNG_URL || "";

/**
 * Search the web — tries SearXNG first, falls back to DuckDuckGo.
 * @param {string} query - The search query.
 * @param {number} [maxResults=10] - Max number of results to return.
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
async function searchWeb(query, maxResults = 10) {
  if (!query || !query.trim()) return [];

  // Try SearXNG first if configured
  if (SEARXNG_URL) {
    try {
      const results = await searchSearXNG(query, maxResults);
      if (results.length > 0) {
        console.log(`  🔍 [searxng] got ${results.length} results`);
        return results;
      }
      // SearXNG returned 0 results — fall through to DDG
      console.log(`  🔍 [searxng] 0 results, falling back to DuckDuckGo`);
    } catch (err) {
      console.log(`  🔍 [searxng] failed: ${err.message}, falling back to DuckDuckGo`);
    }
  }

  // Fallback: DuckDuckGo
  try {
    const results = await searchDuckDuckGo(query, maxResults);
    console.log(`  🔍 [ddg] got ${results.length} results`);
    return results;
  } catch (err) {
    console.error(`  ⚕ [ddg] search failed: ${err.message}`);
    return [];
  }
}

// ─── SearXNG Search ──────────────────────────────────────────────────────────

/**
 * Search using a SearXNG instance (JSON API).
 * Requires SEARXNG_URL env var and JSON format enabled in settings.yml.
 */
async function searchSearXNG(query, maxResults = 10) {
  const baseUrl = SEARXNG_URL.replace(/\/+$/, "");
  const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;

  const data = await httpGetJson(searchUrl);

  if (!data || !Array.isArray(data.results)) {
    return [];
  }

  return data.results.slice(0, maxResults).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || "",
  })).filter((r) => r.url && r.title);
}

// ─── DuckDuckGo Search ───────────────────────────────────────────────────────

/**
 * Search using DuckDuckGo HTML scraping (no API key needed).
 */
async function searchDuckDuckGo(query, maxResults = 10) {
  const html = await httpGetText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  );
  return parseDuckDuckGoResults(html, maxResults);
}

// ─── Format helper ───────────────────────────────────────────────────────────

/**
 * Format search results as a readable string for the model.
 */
function formatSearchResults(results, query) {
  if (!results || results.length === 0) {
    return `Web search for "${query}" returned no results.`;
  }

  const lines = [`Web search results for: "${query}"\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Return the search engine status string for the startup banner.
 */
function getSearchEngineStatus() {
  if (SEARXNG_URL) {
    return `SearXNG (${SEARXNG_URL}) + DuckDuckGo fallback`;
  }
  return "DuckDuckGo (set SEARXNG_URL for better results)";
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * GET a URL and return parsed JSON.
 */
function httpGetJson(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;

    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": "command-code-proxy/1.0",
          Accept: "application/json",
        },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          const nextUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`;
          res.resume();
          return resolve(httpGetJson(nextUrl, redirects - 1));
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("Invalid JSON response from SearXNG"));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("SearXNG request timed out"));
    });
  });
}

/**
 * GET a URL and return raw text (for DuckDuckGo HTML).
 */
function httpGetText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;

    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          const nextUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`;
          res.resume();
          return resolve(httpGetText(nextUrl, redirects - 1));
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

// ─── DuckDuckGo HTML parser ──────────────────────────────────────────────────

function parseDuckDuckGoResults(html, max) {
  const results = [];

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

module.exports = { searchWeb, formatSearchResults, getSearchEngineStatus };
