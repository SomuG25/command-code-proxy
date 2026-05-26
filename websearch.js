const https = require("https");

// ─── DuckDuckGo Web Search ───────────────────────────────────────────────────
// Free, no API key, no rate limits for reasonable usage.

/**
 * Search the web using DuckDuckGo.
 * @param {string} query - The search query.
 * @param {number} [maxResults=5] - Max number of results to return.
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
async function searchWeb(query, maxResults = 10) {
  if (!query || !query.trim()) return [];

  try {
    const html = await httpGet(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );
    return parseDuckDuckGoResults(html, maxResults);
  } catch (err) {
    console.error(`  ⚕ web search failed: ${err.message}`);
    return [];
  }
}

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

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : require("http");

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
          res.resume(); // Drain the response
          return resolve(httpGet(nextUrl, redirects - 1));
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

// ─── HTML parser ─────────────────────────────────────────────────────────────

function parseDuckDuckGoResults(html, max) {
  const results = [];

  // DuckDuckGo HTML search results structure:
  // <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL&...">TITLE</a>
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
 * They look like: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
 */
function decodeDDGUrl(raw) {
  if (!raw) return "";

  // Direct URL (not a DDG redirect)
  if (!raw.includes("duckduckgo.com/l/")) {
    return raw.startsWith("//") ? `https:${raw}` : raw;
  }

  // Extract the uddg parameter
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

module.exports = { searchWeb, formatSearchResults };
