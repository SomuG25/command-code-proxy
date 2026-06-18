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
// Models marked [Go] work on the $1 Go plan (open-source only).
// Models marked [Pro] require Pro plan or higher ($20+/month).
const ALL_MODELS = [
  // ── Go Plan (Open Source) ──────────────────────────────────────────────
  // DeepSeek
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", plan: "go" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", plan: "go" },
  // Moonshot / Kimi
  { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "moonshot", plan: "go" },
  { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", provider: "moonshot", plan: "go" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "moonshot", plan: "go" },
  // GLM
  { id: "glm-5.1", name: "GLM-5.1", provider: "zhipu", plan: "go" },
  { id: "glm-5", name: "GLM-5", provider: "zhipu", plan: "go" },
  // MiniMax
  { id: "minimax-m3", name: "MiniMax M3", provider: "minimax", plan: "go" },
  { id: "minimax-m2.7", name: "MiniMax M2.7", provider: "minimax", plan: "go" },
  { id: "minimax-m2.5", name: "MiniMax M2.5", provider: "minimax", plan: "go" },
  // Qwen
  { id: "qwen-3.7-max", name: "Qwen 3.7 Max", provider: "qwen", plan: "go" },
  { id: "qwen-3.6-max-preview", name: "Qwen 3.6 Max Preview", provider: "qwen", plan: "go" },
  { id: "qwen-3.6-plus", name: "Qwen 3.6 Plus", provider: "qwen", plan: "go" },
  // StepFun
  { id: "step-3.5-flash", name: "Step 3.5 Flash", provider: "stepfun", plan: "go" },

  // ── Pro Plan (Premium Models) ──────────────────────────────────────────
  // Anthropic
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", plan: "pro" },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic", plan: "pro" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", plan: "pro" },
  { id: "claude-fable-5", name: "Claude Fable 5", provider: "anthropic", plan: "pro" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", plan: "pro" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", plan: "pro" },
  // OpenAI
  { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", plan: "pro" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", plan: "pro" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai", plan: "pro" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "openai", plan: "pro" },
  // Google
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google", plan: "pro" },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", provider: "google", plan: "pro" },
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
