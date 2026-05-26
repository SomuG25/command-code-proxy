# Contributing to command-code-proxy

Contributions are welcome! This guide will help you get set up and ship a great PR.

## Project Overview

`command-code-proxy` is a zero-dependency Node.js proxy that translates between Claude Code's Anthropic API format and Command Code's Alpha format — giving you 25+ free AI models inside Claude Code.

```
Claude Code → Proxy :4141 → api.commandcode.ai/alpha/generate
```

## Getting Started

### Prerequisites

- Node.js v18+
- A free [Command Code](https://commandcode.ai) account

### Setup

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/command-code-proxy.git
cd command-code-proxy

# 2. Install dependencies (jest for tests, dotenv for .env support)
npm install

# 3. Login to Command Code
npm install -g command-code
npx command-code

# 4. (Optional) copy .env.example and configure
cp .env.example .env

# 5. Run the proxy
node index.js

# 6. Run tests
npm test
```

## Development Workflow

### Running Tests

```bash
npm test           # run all tests once
npm run test:watch # watch mode (re-runs on file change)
```

All tests live in `tests/`. Please add tests for any new functionality.

### Code Style

- **No dependencies** in production code — the proxy should stay zero-dep (no `package.json` `dependencies`)
- Dev dependencies (Jest, etc.) are fine
- Use JSDoc comments for exported functions
- Section headers use the `// ─── Title ─────` style already in the codebase

### Project Structure

```
index.js      # HTTP server, routing, startup banner
config.js     # Auth, model registry, .env loading, tool schemas
converter.js  # Anthropic ↔ Alpha format translation
handlers.js   # Request handling, web search intercept, abort control
stream.js     # SSE stream converter (Alpha → Anthropic)
utils.js      # HTTP helpers, retry logic
websearch.js  # DuckDuckGo search integration
tests/        # Jest test suite
  converter.test.js
  stream.test.js
  config.test.js
```

## Making Changes

### Adding a New Model

1. Open `config.js`
2. Add an entry to the `ALL_MODELS` array:
   ```js
   { id: "provider/model-id", name: "Display Name", provider: "provider" }
   ```
3. Optionally add a short alias to `MODEL_ALIASES`:
   ```js
   "shortname": "provider/model-id",
   ```

### Adding a New Built-in Tool

Add an entry to `ANTHROPIC_BUILTIN_TOOLS` in `config.js` with the tool's `name`, `description`, and `input_schema`.

### Changing the Port or Default Model

Users can now configure via environment variables or `.env`:
- `CC_PROXY_PORT` — override default port (4141)
- `CC_PROXY_DEFAULT_MODEL` — override default model

## Submitting a PR

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes with clear, focused commits
3. Add or update tests if applicable: `npm test` must pass
4. Push and open a Pull Request against `main`

### PR Checklist

- [ ] `npm test` passes (all 67+ tests green)
- [ ] New features have tests
- [ ] Code follows existing style (JSDoc, section headers)
- [ ] PR description explains what and why

## Reporting Bugs

Open an [issue](https://github.com/SomuG25/command-code-proxy/issues) with:
- Node.js version (`node --version`)
- OS (Linux/macOS/Windows)
- Steps to reproduce
- Expected vs actual behavior
- Console output (redact any API keys)

## Questions

Feel free to open an issue for questions or feature discussions.
