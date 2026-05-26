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
[Features](#-features) •
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
| **🤖 25+ Models** | Claude, GPT-5, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, and more |
| **🔍 Web Search** | Built-in DuckDuckGo search engine — works where Anthropic's can't |
| **⚡ Streaming** | Real-time SSE streaming for fast responses |
| **🛠️ Full Tool Support** | File editing, code execution, web fetch — everything works |
| **🔄 Auto-Retry** | Retries on `ECONNRESET`, DNS failures, timeouts |
| **🧹 Self-Healing** | Fixes orphaned tool calls from interrupted sessions automatically |
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
  <td><strong>Anthropic</strong></td>
  <td><code>claude-opus-4-7</code> · <code>claude-opus-4-6</code> · <code>claude-sonnet-4-6</code> · <code>claude-haiku-4-5</code></td>
</tr>
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

> **Note:** Model availability depends on your Command Code plan. The free "Go" plan supports most models. If you get a 403 error, try a different model.

---

## 🔍 Web Search

The proxy includes a **built-in web search engine** powered by DuckDuckGo.

When the model wants to search the web, the proxy:

1. **Intercepts** the `web_search` request from Claude Code
2. **Executes** a real DuckDuckGo search (returns 10 results)
3. **Returns** results in Anthropic's native `server_tool_use` format

Claude Code displays it as `Web Search("query") — Did 1 search in 1s`. No configuration needed.

---

## 🏗️ Project Structure

```
command-code-proxy/
├── index.js          # HTTP server, routing, startup
├── config.js         # Auth, model registry, tool schemas
├── converter.js      # Anthropic ↔ Alpha format translation
├── handlers.js       # Request handling, web search, abort control
├── stream.js         # SSE stream converter (Alpha → Anthropic)
├── utils.js          # HTTP helpers, retry logic
├── websearch.js      # DuckDuckGo search integration
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
| **Web search** | Intercepts server-side search requests → executes real DuckDuckGo queries |
| **Model normalization** | Strips version suffixes (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`) |
| **Stream conversion** | Converts Alpha SSE → Anthropic SSE events in real-time |
| **Error recovery** | Auto-retries on `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`; handles client disconnects cleanly |

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
```

### Option 2 — PM2 (Auto-Restart & Background)

```bash
npm install -g pm2
pm2 start index.js --name cc-proxy
pm2 startup && pm2 save     # auto-start on boot
```

### Option 3 — Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 4141
CMD ["node", "index.js"]
```

```bash
docker build -t cc-proxy .
docker run -d -p 4141:4141 \
  -v ~/.commandcode:/root/.commandcode \
  cc-proxy
```

> **Important:** Mount `~/.commandcode` so the container can access your auth credentials.

### Connect Remotely

Once deployed, point Claude Code to your server:

```bash
claude config set --global apiBaseUrl http://your-server:4141
claude config set --global apiKey "sk-proxy"
```

---

## ⚙️ Configuration

| Setting | How to Change |
|:---|:---|
| **Port** | Edit `PORT` in `config.js` (default: `4141`) |
| **Default model** | `claude config set --global model "deepseek/deepseek-v4-pro"` |
| **Per-session model** | `claude --model "gpt-5.4"` |

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
<summary><strong>Web Search shows "Did 0 searches"</strong></summary>

Make sure the proxy is running and Claude Code is routing through it:

```bash
# 1. Proxy running?
node index.js

# 2. API base URL set?
claude config set --global apiBaseUrl http://localhost:4141
```

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
- **[DuckDuckGo](https://duckduckgo.com)** — Privacy-first web search

---

<div align="center">

**If this project saved you money, give it a ⭐**

Made with ❤️ by [SomuG25](https://github.com/SomuG25)

</div>
