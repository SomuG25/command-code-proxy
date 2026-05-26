const fs = require("fs");
const path = require("path");

// ─── Load .env if present (optional, no hard dependency on dotenv pkg) ────────
try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
} catch {
  // .env loading is best-effort
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.CC_PROXY_PORT || "4141", 10);
const CMD_BASE = "api.commandcode.ai";
const ALPHA_ENDPOINT = "/alpha/generate";

// ─── Load auth from Command Code's CLI auth file ─────────────────────────────
function loadAuth() {
  const authPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    ".commandcode",
    "auth.json"
  );
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    return auth;
  } catch {
    console.error("⚠ Could not read ~/.commandcode/auth.json");
    console.error("  Make sure you're logged in: npx command-code");
    process.exit(1);
  }
}

// ─── Detect CLI version for headers ──────────────────────────────────────────
// Searches all common global npm install locations across Windows, Linux, macOS.
function getCliVersion() {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  const candidates = [
    // Windows (npm global via APPDATA)
    path.join(process.env.APPDATA || "", "npm", "node_modules", "command-code", "package.json"),
    // Linux/macOS — standard global npm paths
    "/usr/local/lib/node_modules/command-code/package.json",
    "/usr/lib/node_modules/command-code/package.json",
    // npm prefix (covers custom --prefix installs)
    path.join(process.env.npm_config_prefix || "", "lib", "node_modules", "command-code", "package.json"),
    // Homebrew on macOS (Apple Silicon & Intel)
    "/opt/homebrew/lib/node_modules/command-code/package.json",
    "/usr/local/Cellar/node/lib/node_modules/command-code/package.json",
    // nvm — scan active version
    path.join(home, ".nvm", "versions", "node", process.version, "lib", "node_modules", "command-code", "package.json"),
    // Volta
    path.join(home, ".volta", "tools", "shared", "node_modules", "command-code", "package.json"),
    // pnpm global
    path.join(home, ".local", "share", "pnpm", "global", "5", "node_modules", "command-code", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (pkg.version) return pkg.version;
    } catch {
      // Not found at this path — try next
    }
  }

  // Also try resolving from PATH via which
  try {
    const { execSync } = require("child_process");
    const which = execSync("which command-code 2>/dev/null || where command-code 2>nul", {
      encoding: "utf8",
      timeout: 1000,
    }).trim().split("\n")[0].trim();

    if (which) {
      // Walk up from the binary to find package.json
      // e.g. /usr/local/bin/command-code → /usr/local/lib/node_modules/command-code/package.json
      const binDir = path.dirname(which);
      const libPkg = path.join(binDir, "..", "lib", "node_modules", "command-code", "package.json");
      const pkg = JSON.parse(fs.readFileSync(libPkg, "utf8"));
      if (pkg.version) return pkg.version;
    }
  } catch {
    // which/where failed or package.json not found
  }

  return "0.27.0"; // Safe default fallback
}

// ─── Model registry ──────────────────────────────────────────────────────────
const ALL_MODELS = [
  // Anthropic
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  // OpenAI
  { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "openai" },
  // Google
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google" },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", provider: "google" },
  // Open Source
  { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", provider: "opensource" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "opensource" },
  { id: "glm-5.1", name: "GLM-5.1", provider: "opensource" },
  { id: "glm-5", name: "GLM-5", provider: "opensource" },
  { id: "minimax-m2.7", name: "MiniMax M2.7", provider: "opensource" },
  { id: "minimax-m2.5", name: "MiniMax M2.5", provider: "opensource" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opensource" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "opensource" },
  { id: "qwen-3.6-max-preview", name: "Qwen 3.6 Max Preview", provider: "opensource" },
  { id: "qwen-3.6-plus", name: "Qwen 3.6 Plus", provider: "opensource" },
  { id: "qwen-3.7-max", name: "Qwen 3.7 Max", provider: "opensource" },
  { id: "step-3.5-flash", name: "Step 3.5 Flash", provider: "opensource" },
];

// ─── Model aliases ────────────────────────────────────────────────────────────
// Lets users type short names instead of exact model IDs.
// e.g. claude --model "deepseek" → "deepseek/deepseek-v4-pro"
const MODEL_ALIASES = {
  // Provider shorthands
  "deepseek":  "deepseek/deepseek-v4-pro",
  "gemini":    "google/gemini-3.5-flash",
  "gemini-lite": "google/gemini-3.1-flash-lite",
  "gpt":       "gpt-5.4",
  "gpt-mini":  "gpt-5.4-mini",
  "qwen":      "qwen-3.7-max",
  "kimi":      "moonshotai/kimi-k2.6",
  "glm":       "glm-5.1",
  "minimax":   "minimax-m2.7",
  "step":      "step-3.5-flash",
  // Anthropic aliases
  "sonnet":    "claude-sonnet-4-6",
  "haiku":     "claude-haiku-4-5",
  "opus":      "claude-opus-4-7",
};

// ─── Anthropic built-in tool schemas ─────────────────────────────────────────
// Claude Code sends these as special tools with a `type` field but no
// `input_schema`. We convert them to regular tools so the model can call them,
// then Claude Code handles execution locally.
const ANTHROPIC_BUILTIN_TOOLS = {
  web_search_20250305: {
    name: "web_search",
    description: "Search the web for current information. Returns relevant search results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
  web_fetch_20250910: {
    name: "web_fetch",
    description: "Fetch content from a URL. Returns the page content as text.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
  text_editor_20250429: {
    name: "text_editor",
    description: "View, create, or edit files. Supports view, create, str_replace, and insert commands.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["view", "create", "str_replace", "insert"], description: "The command to run" },
        path: { type: "string", description: "Absolute path to the file" },
        file_text: { type: "string", description: "File content for create command" },
        old_str: { type: "string", description: "String to replace (for str_replace)" },
        new_str: { type: "string", description: "Replacement string (for str_replace or insert)" },
        insert_line: { type: "integer", description: "Line number for insert command" },
        view_range: { type: "array", items: { type: "integer" }, description: "Line range [start, end] for view" },
      },
      required: ["command", "path"],
    },
  },
  code_execution_20250522: {
    name: "code_execution",
    description: "Execute code in a sandboxed environment.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: { type: "string", description: "Programming language" },
      },
      required: ["code"],
    },
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────
const AUTH = loadAuth();
const CLI_VERSION = getCliVersion();

module.exports = {
  PORT,
  CMD_BASE,
  ALPHA_ENDPOINT,
  AUTH,
  CLI_VERSION,
  ALL_MODELS,
  MODEL_ALIASES,
  ANTHROPIC_BUILTIN_TOOLS,
};
