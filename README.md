<div align="center">

# Command Code Proxy

### Use 25+ AI models in Claude Code — for free.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/SomuG25/command-code-proxy/pulls)
[![GitHub stars](https://img.shields.io/github/stars/SomuG25/command-code-proxy?style=social)](https://github.com/SomuG25/command-code-proxy)

A lightweight proxy that sits between **Claude Code** and **Command Code's API**, letting you use GPT-5, Gemini, DeepSeek, Qwen, and 20+ other models — all from Claude Code's interface. Zero cost.

[Getting Started](#-getting-started) •
[Models](#-available-models) •
[Web Search](#-web-search) •
[Configuration](#%EF%B8%8F-configuration) •
[Deploy](#%EF%B8%8F-deploy-to-cloud) •
[Troubleshooting](#-troubleshooting)

</div>

---

## How It Works

```
┌─────────────┐                        ┌─────────────┐                       ┌──────────────┐
│             │   Anthropic Messages    │             │    /alpha/generate     │              │
│ Claude Code │ ─────────────────────→  │    Proxy    │  ──────────────────→   │ Command Code │
│   (CLI)     │ ←─────────────────────  │   :4141     │  ←──────────────────   │     API      │
│             │   SSE stream response   │             │    SSE stream          │              │
└─────────────┘                        └──────┬──────┘                       └──────────────┘
                                              │
                                     ┌────────┴────────┐
                                     │    SearXNG /    │
                                     │   DuckDuckGo    │
                                     │  (web search)   │
                                     └─────────────────┘
```

The proxy translates between Anthropic's API format and Command Code's Alpha format in real-time. Claude Code thinks it's talking to Anthropic's servers, but it's actually using any model you choose.

---

## ✨ Features

| Feature | Description |
|:---|:---|
| **🆓 Free** | Uses Command Code's free "Go" plan. No API keys to buy. |
| **🤖 25+ Models** | GPT-5, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, and more |
| **🔍 SearXNG Search** | Aggregates 70+ search engines (Google, Bing, DDG) with DuckDuckGo fallback |
| **⚡ Streaming** | Real-time SSE streaming for fast responses |
| **🛠️ Full Tool Support** | File editing, code execution, web fetch — everything works |
| **🔄 Auto-Retry** | Retries on transient errors: "service unavailable", ECONNRESET, timeouts |
| **🧹 Self-Healing** | Fixes orphaned tool calls from interrupted sessions automatically |
| **🔀 Model Remapping** | Auto-remaps `claude-*` models → DeepSeek v4 Pro |
| **🔒 Secure** | Auth credentials stay local — never hardcoded or transmitted |

---

## 🚀 Getting Started

### Prerequisites

- **[Node.js](https://nodejs.org/)** v18+
- **[Command Code CLI](https://commandcode.ai)** — free account

### Step 1 — Install Command Code & Login

```bash
npm install -g command-code
npx command-code
```

This creates `~/.commandcode/auth.json` with your credentials. The proxy reads this file automatically.

### Step 2 — Clone & Start

```bash
git clone https://github.com/SomuG25/command-code-proxy.git
cd command-code-proxy
node index.js
```

You'll see:

```
╔══════════════════════════════════════════════════════════╗
║  ⚡ CC-Proxy v3 on http://localhost:4141               ║
╠══════════════════════════════════════════════════════════╣
║  Claude Code ──→ Proxy ──→ /alpha/generate             ║
║  Uses CLI endpoint (works on FREE Go plan!)            ║
╚══════════════════════════════════════════════════════════╝

  User: yourname
  CLI Version: 0.27.0
  Search: DuckDuckGo (set SEARXNG_URL for better results)
```

### Step 3 — Point Claude Code to the Proxy

```bash
claude config set --global apiBaseUrl http://localhost:4141
claude config set --global apiKey "sk-proxy"
```

### Step 4 — Use It

```bash
claude --model "deepseek/deepseek-v4-pro"
```

That's it. All Claude Code tools (file editing, search, code execution) work normally.

---

## 🤖 Available Models

<table>
<tr><th>Provider</th><th>Models</th></tr>
<tr>
  <td><strong>OpenAI</strong></td>
  <td><code>gpt-5.5</code> · <code>gpt-5.4</code> · <code>gpt-5.3-codex</code> · <code>gpt-5.4-mini</code></td>
</tr>
<tr>
  <td><strong>Google</strong></td>
  <td><code>google/gemini-3.5-flash</code> · <code>google/gemini-3.1-flash-lite</code></td>
</tr>
<tr>
  <td><strong>DeepSeek</strong></td>
  <td><code>deepseek/deepseek-v4-pro</code> · <code>deepseek/deepseek-v4-flash</code></td>
</tr>
<tr>
  <td><strong>Qwen</strong></td>
  <td><code>qwen-3.7-max</code> · <code>qwen-3.6-max-preview</code> · <code>qwen-3.6-plus</code></td>
</tr>
<tr>
  <td><strong>Moonshot</strong></td>
  <td><code>moonshotai/kimi-k2.6</code> · <code>moonshotai/kimi-k2.5</code></td>
</tr>
<tr>
  <td><strong>Others</strong></td>
  <td><code>glm-5.1</code> · <code>glm-5</code> · <code>minimax-m2.7</code> · <code>minimax-m2.5</code> · <code>step-3.5-flash</code></td>
</tr>
</table>

> **Note:** Claude Code sometimes sends `claude-*` model names internally (for titles, summaries). The proxy auto-remaps these to `deepseek/deepseek-v4-pro` since Command Code can't serve Anthropic models.

> **Note:** Model availability depends on your Command Code plan. The free "Go" plan supports most models. If you get a 403 error, try a different model.

---

## 🔍 Web Search

The proxy includes a **built-in web search engine** that intercepts search requests from Claude Code and returns real results.

### Default: DuckDuckGo (no setup needed)

Works out of the box — no API keys, no configuration.

### Upgrade: SearXNG (recommended)

For **much better results**, connect a [SearXNG](https://github.com/searxng/searxng) instance. SearXNG aggregates **70+ search engines** (Google, Bing, DuckDuckGo, etc.) and returns clean JSON.

**Option A — Docker (one command):**

> ⚠️ **Important:** You MUST mount the `searxng-settings.yml` file. Without it, SearXNG returns HTML instead of JSON and the proxy will fall back to DuckDuckGo.

```bash
# Windows (PowerShell) — run from the proxy directory:
docker run -d -p 8080:8080 -v "${PWD}/searxng-settings.yml:/etc/searxng/settings.yml" --name searxng searxng/searxng

# Linux/Mac:
docker run -d -p 8080:8080 -v ./searxng-settings.yml:/etc/searxng/settings.yml --name searxng searxng/searxng
```

Then start the proxy with SearXNG:

```bash
# Windows (PowerShell):
$env:SEARXNG_URL="http://localhost:8080"; node index.js

# Linux/Mac:
SEARXNG_URL=http://localhost:8080 node index.js
```

**Option B — Docker Compose (proxy + SearXNG together):**

```bash
docker-compose up -d
```

This starts both SearXNG and the proxy, pre-configured to work together.

**Option C — Remote instance (Railway, VPS):**

Deploy SearXNG on Railway or any VPS, then point the proxy at it:

```bash
# PowerShell:
$env:SEARXNG_URL="https://search.yourserver.com"; node index.js

# Linux/Mac:
SEARXNG_URL=https://search.yourserver.com node index.js
```

### How it works

```
Model requests web_search
        ↓
   Proxy intercepts
        ↓
┌── SearXNG configured? ──┐
│  YES                     │  NO
│  Query SearXNG JSON API  │  Scrape DuckDuckGo HTML
│  (70+ engines)           │  (single engine)
│       ↓                  │       ↓
│  Got results?            │  Return results
│  YES → return them       │
│  NO  → fall back to DDG  │
└──────────────────────────┘
```

---

## ⚙️ Configuration

| Setting | How to Change | Default |
|:---|:---|:---|
| **Proxy port** | Edit `PORT` in `config.js` | `4141` |
| **Default model** | `claude config set --global model "deepseek/deepseek-v4-pro"` | `deepseek/deepseek-v4-pro` |
| **Per-session model** | `claude --model "gpt-5.4"` | — |
| **Search engine** | Set `SEARXNG_URL` env var before starting | DuckDuckGo |
| **Max search results** | Edit `maxResults` in `websearch.js` | `10` |
| **Auto-retry** | Built-in, retries 2x on transient SSE errors | Enabled |
| **Auth credentials** | Auto-read from `~/.commandcode/auth.json` | — |
| **Claude model fallback** | Edit `FALLBACK_MODEL` in `handlers.js` | `deepseek/deepseek-v4-pro` |

### Environment Variables

| Variable | Description | Example |
|:---|:---|:---|
| `SEARXNG_URL` | URL of your SearXNG instance | `http://localhost:8080` |

---

## 🏗️ Project Structure

```
command-code-proxy/
├── index.js                # HTTP server, routing, startup
├── config.js               # Auth, model registry, tool schemas
├── converter.js            # Anthropic ↔ Alpha format translation
├── handlers.js             # Request handling, web search, abort control
├── stream.js               # SSE stream converter (Alpha → Anthropic)
├── utils.js                # HTTP helpers, retry logic
├── websearch.js            # SearXNG + DuckDuckGo search engine
├── Dockerfile              # Docker image for the proxy
├── docker-compose.yml      # Run proxy + SearXNG together
├── searxng-settings.yml    # SearXNG config (JSON API enabled)
├── package.json
├── .gitignore
└── LICENSE
```

### What the Proxy Handles

| Concern | How |
|:---|:---|
| **Format translation** | Converts Anthropic Messages API ↔ Command Code Alpha format |
| **Tool conversion** | Translates built-in tools (`web_search_20250305`, `text_editor_20250429`, etc.) into standard schemas |
| **Message healing** | Injects placeholder results for orphaned tool calls from interrupted sessions |
| **Search engine** | SearXNG (70+ engines) with automatic DuckDuckGo fallback |
| **Model normalization** | Strips version suffixes and provider prefixes (`anthropic:claude-haiku-4-5-20251001` → remapped) |
| **Model remapping** | Anthropic models (`claude-*`) → `deepseek/deepseek-v4-pro` fallback |
| **Stream conversion** | Converts Alpha SSE → Anthropic SSE events in real-time |
| **Auto-retry** | Retries on transient SSE errors ("service unavailable", "overloaded") and network errors |
| **System messages** | Converts `system` role messages → `user` role (Command Code only accepts user/assistant/tool) |

---

## ☁️ Deploy to Cloud

### Option 1 — VPS (DigitalOcean, AWS, Hetzner)

```bash
# On your server:
git clone https://github.com/SomuG25/command-code-proxy.git
cd command-code-proxy

# Install Command Code CLI and login
npm install -g command-code
npx command-code

# Start the proxy
node index.js

# (Optional) Start with SearXNG
docker run -d -p 8080:8080 -v ./searxng-settings.yml:/etc/searxng/settings.yml --name searxng searxng/searxng
SEARXNG_URL=http://localhost:8080 node index.js
```

### Option 2 — PM2 (Auto-Restart & Background)

```bash
npm install -g pm2
pm2 start index.js --name cc-proxy
pm2 startup && pm2 save     # auto-start on boot
```

### Option 3 — Docker

```bash
docker build -t cc-proxy .
docker run -d -p 4141:4141 \
  -v ~/.commandcode:/root/.commandcode \
  cc-proxy
```

### Option 4 — Docker Compose (Proxy + SearXNG)

```bash
docker-compose up -d
```

This starts both the proxy and SearXNG together, pre-configured.

> **Important:** Mount `~/.commandcode` so the container can access your auth credentials.

### Connect Remotely

Once deployed, point Claude Code to your server:

```bash
claude config set --global apiBaseUrl http://your-server:4141
claude config set --global apiKey "sk-proxy"
```

---

## 🐛 Troubleshooting

<details>
<summary><strong>"Could not read ~/.commandcode/auth.json"</strong></summary>

You need to install and login to Command Code first:

```bash
npm install -g command-code
npx command-code
```

</details>

<details>
<summary><strong>403 — Model Not In Plan</strong></summary>

The selected model isn't available on your plan. Try a different one:

```bash
claude --model "deepseek/deepseek-v4-flash"
```

</details>

<details>
<summary><strong>"Service temporarily unavailable"</strong></summary>

This is a transient error from Command Code's backend. The proxy now **auto-retries up to 2 times** with a 2-second delay. If it keeps happening:

1. Wait 30 seconds and try again
2. The upstream server may be overloaded — try during off-peak hours
3. Check the proxy logs for `↻ retrying after transient error...`

</details>

<details>
<summary><strong>"SearXNG: Invalid JSON response"</strong></summary>

You must mount the `searxng-settings.yml` file when starting the Docker container. Without it, SearXNG returns HTML instead of JSON.

```bash
# Correct:
docker run -d -p 8080:8080 -v "${PWD}/searxng-settings.yml:/etc/searxng/settings.yml" --name searxng searxng/searxng

# Wrong (will return HTML, not JSON):
docker run -d -p 8080:8080 searxng/searxng
```

</details>

<details>
<summary><strong>400 BAD_REQUEST: "Invalid option at params.messages"</strong></summary>

This usually means the conversation history has grown too long or contains unsupported message formats. Fix:

1. Start a new Claude Code session with `/clear`
2. If persistent, restart the proxy

</details>

<details>
<summary><strong>Web Search shows "Did 0 searches"</strong></summary>

Make sure the proxy is running and Claude Code is routing through it:

```bash
# 1. Proxy running?
node index.js

# 2. API base URL set?
claude config set --global apiBaseUrl http://localhost:4141
```

If using SearXNG, verify it's running: `curl http://localhost:8080/search?q=test&format=json`

</details>

<details>
<summary><strong>"Tool results are missing for tool calls"</strong></summary>

This happens when you interrupt Claude Code mid-response (e.g., pressing `Esc`). The proxy heals these automatically on the next request — just continue using it.

</details>

<details>
<summary><strong>ECONNRESET / ENOTFOUND errors</strong></summary>

The proxy retries once on transient network errors. If persistent, check your internet connection or try again.

</details>

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Open an [issue](https://github.com/SomuG25/command-code-proxy/issues) for bugs or feature requests
- Submit a [pull request](https://github.com/SomuG25/command-code-proxy/pulls) with improvements
- Star the repo ⭐ if you find it useful

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[Command Code](https://commandcode.ai)** — Free AI API backend
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic's CLI coding assistant
- **[SearXNG](https://github.com/searxng/searxng)** — Privacy-respecting, open-source meta search engine
- **[DuckDuckGo](https://duckduckgo.com)** — Privacy-first web search

---

<div align="center">

**If this project saved you money, give it a ⭐**

</div>
