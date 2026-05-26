const fs = require("fs");
const path = require("path");

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = 4141;
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
function getCliVersion() {
  try {
    const pkgPath = path.join(
      process.env.APPDATA || "",
      "npm/node_modules/command-code/package.json"
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "0.27.0";
  } catch {
    return "0.27.0";
  }
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
  ANTHROPIC_BUILTIN_TOOLS,
};
