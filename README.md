# ⚡ Command Code Proxy

> **Use 25+ AI models through Claude Code's interface — completely free.**

A lightweight Node.js proxy that translates Claude Code's Anthropic API format into Command Code's `/alpha/generate` endpoint. This lets you use **GPT-5, Gemini, DeepSeek, Qwen, Kimi, and more** — all from within Claude Code's powerful coding interface.

```
Claude Code ──→ Proxy (localhost:4141) ──→ Command Code API
                    │
              Translates Anthropic ↔ Alpha format
              Handles web search via DuckDuckGo
              Fixes tool calls, message ordering
```

## ✨ Features

- 🆓 **Free** — Uses Command Code's free "Go" plan. No API keys to buy.
- 🤖 **25+ models** — Claude, GPT-5, Gemini, DeepSeek, Qwen, Kimi, and more
- 🔍 **Web search** — Built-in DuckDuckGo search (works where Anthropic's server-side search can't)
- 🛠️ **Full tool support** — File editing, code execution, web fetch all work
- ⚡ **Streaming** — Real-time streaming responses
- 🔄 **Auto-retry** — Retries on network errors (ECONNRESET, DNS failures)
- 🧹 **Message healing** — Fixes orphaned tool calls from interrupted sessions

---

## 📦 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Command Code CLI](https://commandcode.ai) account (free "Go" plan works)

### 1. Install Command Code CLI & Login

```bash
npm install -g command-code
npx command-code
```

This creates `~/.commandcode/auth.json` with your credentials. The proxy reads this file automatically.

### 2. Clone & Run the Proxy

```bash
git clone https://github.com/SomuG25/command-code-proxy.git
cd command-code-proxy
node index.js
```

You should see:

```
╔══════════════════════════════════════════════════════════╗
║  ⚡ CC-Proxy v3 on http://localhost:4141               ║
╠══════════════════════════════════════════════════════════╣
║  Claude Code ──→ Proxy ──→ /alpha/generate             ║
║  Uses CLI endpoint (works on FREE Go plan!)            ║
╚══════════════════════════════════════════════════════════╝
```

### 3. Configure Claude Code

Point Claude Code to use the proxy as its API endpoint:

```bash
# Set the API base URL to your proxy
claude config set --global apiBaseUrl http://localhost:4141

# Set any dummy API key (the proxy uses Command Code auth)
claude config set --global apiKey "sk-proxy"
```

### 4. Use Any Model

```bash
# Start Claude Code with a specific model
claude --model "deepseek/deepseek-v4-pro"

# Or set a default model
claude config set --global model "deepseek/deepseek-v4-pro"
```

Then just use Claude Code normally! All tools (file editing, web search, code execution) work.

---

## 🤖 Available Models

| Provider | Models | Notes |
|---|---|---|
| **Anthropic** | `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` | |
| **OpenAI** | `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini` | |
| **Google** | `google/gemini-3.5-flash`, `google/gemini-3.1-flash-lite` | |
| **DeepSeek** | `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash` | Great for coding |
| **Qwen** | `qwen-3.7-max`, `qwen-3.6-max-preview`, `qwen-3.6-plus` | |
| **Kimi** | `moonshotai/kimi-k2.6`, `moonshotai/kimi-k2.5` | |
| **Others** | `glm-5.1`, `glm-5`, `minimax-m2.7`, `minimax-m2.5`, `step-3.5-flash` | |

> **Tip:** Not all models may be available on the free "Go" plan. If you get a 403 error, try a different model.

---

## 🔍 Web Search

The proxy includes a **built-in web search engine** powered by DuckDuckGo. When Claude Code asks the model to search the web:

1. The proxy intercepts the search request
2. Executes a real DuckDuckGo search (10 results)
3. Returns results in Anthropic's `server_tool_use` format
4. The model uses these results to answer your question

This works automatically — no configuration needed.

---

## 🏗️ Architecture

```
┌─────────────┐    Anthropic API     ┌─────────────┐    Alpha API     ┌──────────────┐
│ Claude Code  │ ──────────────────→ │   Proxy      │ ──────────────→ │ Command Code │
│ (CLI client) │ ←────────────────── │ :4141        │ ←────────────── │ API Server   │
└─────────────┘    SSE stream        └──────┬───────┘    SSE stream   └──────────────┘
                                            │
                                   ┌────────┴────────┐
                                   │  DuckDuckGo     │
                                   │  (web search)   │
                                   └─────────────────┘
```

### Files

| File | Description |
|---|---|
| `index.js` | HTTP server, routing, startup banner |
| `config.js` | Auth loading, model registry, built-in tool schemas |
| `converter.js` | Anthropic → Alpha message/tool format conversion |
| `handlers.js` | Request handlers, web search interception, streaming |
| `stream.js` | Alpha SSE → Anthropic SSE stream converter |
| `utils.js` | HTTP helpers, retry logic, response utilities |
| `websearch.js` | DuckDuckGo search engine integration |

### What the Proxy Does

1. **Format Translation** — Converts Anthropic's Messages API format to Command Code's Alpha format and back
2. **Tool Conversion** — Translates built-in Anthropic tools (`web_search_20250305`, `text_editor_20250429`, etc.) into regular tool schemas
3. **Message Healing** — Fixes orphaned tool calls from interrupted sessions by injecting placeholder results
4. **Web Search** — Intercepts server-side web search requests and executes real DuckDuckGo searches
5. **Model Normalization** — Strips version suffixes from model names (e.g., `claude-haiku-4-5-20251001` → `claude-haiku-4-5`)
6. **Stream Conversion** — Converts Alpha's SSE events to Anthropic's SSE format in real-time
7. **Error Recovery** — Auto-retries on transient network errors, handles client disconnects cleanly

---

## ☁️ Deploy to Cloud

### Deploy on a VPS (DigitalOcean, AWS, etc.)

```bash
# 1. SSH into your server
ssh user@your-server

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Command Code CLI and login
npm install -g command-code
npx command-code

# 4. Clone and run
git clone https://github.com/SomuG25/command-code-proxy.git
cd command-code-proxy
node index.js
```

### Run with PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start the proxy (auto-restart on crash)
pm2 start index.js --name cc-proxy

# Auto-start on system boot
pm2 startup
pm2 save
```

### Run with Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 4141
CMD ["node", "index.js"]
```

```bash
docker build -t cc-proxy .
docker run -d -p 4141:4141 -v ~/.commandcode:/root/.commandcode cc-proxy
```

> **Important:** Mount your `~/.commandcode` directory so the proxy can access your auth credentials.

### Use Remotely

If you deploy the proxy on a server, point Claude Code to that server:

```bash
claude config set --global apiBaseUrl http://your-server-ip:4141
claude config set --global apiKey "sk-proxy"
```

---

## 🔧 Configuration

### Change Port

Edit `config.js` and change the `PORT` constant:

```javascript
const PORT = 4141; // Change to your preferred port
```

### Change Default Model

```bash
claude config set --global model "qwen-3.7-max"
# or pass it each time
claude --model "gpt-5.4"
```

---

## 🐛 Troubleshooting

### "Could not read ~/.commandcode/auth.json"
You need to login to Command Code first:
```bash
npm install -g command-code
npx command-code
```

### 403 Model Not In Plan
The model you selected isn't available on your plan. Try a different model:
```bash
claude --model "deepseek/deepseek-v4-flash"
```

### Web Search Shows "Did 0 searches"
This means the proxy isn't running or Claude Code isn't routing through it. Make sure:
1. The proxy is running (`node index.js`)
2. `apiBaseUrl` is set: `claude config set --global apiBaseUrl http://localhost:4141`

### Connection Errors (ECONNRESET, ENOTFOUND)
The proxy auto-retries once on transient network errors. If persistent, check your internet connection.

### "Tool results are missing for tool calls"
This happens when you interrupt Claude Code mid-response. The proxy automatically heals these orphaned tool calls on the next request.

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

## 🙏 Credits

- [Command Code](https://commandcode.ai) — Free AI API backend
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's CLI coding assistant
- [DuckDuckGo](https://duckduckgo.com) — Web search engine

---

**⭐ Star this repo if it helped you!**
