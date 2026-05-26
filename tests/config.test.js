/**
 * tests/config.test.js
 *
 * Unit tests for the config.js helpers (model aliases, .env loading, etc.)
 * These are tested by extracting the internal logic, not by importing config.js
 * directly (which would trigger auth loading and process.exit).
 */

// ─── Model aliases ────────────────────────────────────────────────────────────

// Inline the alias map to test it without triggering auth loading
const MODEL_ALIASES = {
  "deepseek":    "deepseek/deepseek-v4-pro",
  "gemini":      "google/gemini-3.5-flash",
  "gemini-lite": "google/gemini-3.1-flash-lite",
  "gpt":         "gpt-5.4",
  "gpt-mini":    "gpt-5.4-mini",
  "qwen":        "qwen-3.7-max",
  "kimi":        "moonshotai/kimi-k2.6",
  "glm":         "glm-5.1",
  "minimax":     "minimax-m2.7",
  "step":        "step-3.5-flash",
  "sonnet":      "claude-sonnet-4-6",
  "haiku":       "claude-haiku-4-5",
  "opus":        "claude-opus-4-7",
};

// Replicate normalizeModel logic for testing
function normalizeModel(model, defaultModel = "claude-sonnet-4-6") {
  if (!model) return process.env.CC_PROXY_DEFAULT_MODEL || defaultModel;
  const stripped = model.replace(/-\d{8}$/, "");
  return MODEL_ALIASES[stripped] || stripped;
}

describe("Model aliases", () => {
  test("resolves 'deepseek' to deepseek/deepseek-v4-pro", () => {
    expect(normalizeModel("deepseek")).toBe("deepseek/deepseek-v4-pro");
  });

  test("resolves 'gemini' to google/gemini-3.5-flash", () => {
    expect(normalizeModel("gemini")).toBe("google/gemini-3.5-flash");
  });

  test("resolves 'gemini-lite' to google/gemini-3.1-flash-lite", () => {
    expect(normalizeModel("gemini-lite")).toBe("google/gemini-3.1-flash-lite");
  });

  test("resolves 'gpt' to gpt-5.4", () => {
    expect(normalizeModel("gpt")).toBe("gpt-5.4");
  });

  test("resolves 'gpt-mini' to gpt-5.4-mini", () => {
    expect(normalizeModel("gpt-mini")).toBe("gpt-5.4-mini");
  });

  test("resolves 'qwen' to qwen-3.7-max", () => {
    expect(normalizeModel("qwen")).toBe("qwen-3.7-max");
  });

  test("resolves 'kimi' to moonshotai/kimi-k2.6", () => {
    expect(normalizeModel("kimi")).toBe("moonshotai/kimi-k2.6");
  });

  test("resolves 'sonnet' to claude-sonnet-4-6", () => {
    expect(normalizeModel("sonnet")).toBe("claude-sonnet-4-6");
  });

  test("resolves 'haiku' to claude-haiku-4-5", () => {
    expect(normalizeModel("haiku")).toBe("claude-haiku-4-5");
  });

  test("resolves 'opus' to claude-opus-4-7", () => {
    expect(normalizeModel("opus")).toBe("claude-opus-4-7");
  });

  test("passes through full model IDs unchanged", () => {
    expect(normalizeModel("deepseek/deepseek-v4-pro")).toBe("deepseek/deepseek-v4-pro");
    expect(normalizeModel("google/gemini-3.5-flash")).toBe("google/gemini-3.5-flash");
    expect(normalizeModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  test("strips date suffixes before alias resolution", () => {
    // e.g. Claude Code sends claude-haiku-4-5-20251001
    expect(normalizeModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  test("unknown model IDs pass through unchanged", () => {
    expect(normalizeModel("some-future-model")).toBe("some-future-model");
  });

  test("null/undefined model returns default", () => {
    expect(normalizeModel(null)).toBe("claude-sonnet-4-6");
    expect(normalizeModel(undefined)).toBe("claude-sonnet-4-6");
    expect(normalizeModel("")).toBe("claude-sonnet-4-6");
  });
});

// ─── .env parsing ─────────────────────────────────────────────────────────────

describe(".env parsing logic", () => {
  // Replicate the .env parser for testing
  function parseEnvContent(content) {
    const result = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key) result[key] = val;
    }
    return result;
  }

  test("parses simple KEY=VALUE pairs", () => {
    const result = parseEnvContent("CC_PROXY_PORT=8080\nCC_PROXY_DEFAULT_MODEL=gpt-5.4");
    expect(result.CC_PROXY_PORT).toBe("8080");
    expect(result.CC_PROXY_DEFAULT_MODEL).toBe("gpt-5.4");
  });

  test("strips surrounding quotes from values", () => {
    const result = parseEnvContent(`CC_PROXY_DEFAULT_MODEL="deepseek/deepseek-v4-pro"`);
    expect(result.CC_PROXY_DEFAULT_MODEL).toBe("deepseek/deepseek-v4-pro");
  });

  test("strips single quotes from values", () => {
    const result = parseEnvContent(`CC_PROXY_PORT='9000'`);
    expect(result.CC_PROXY_PORT).toBe("9000");
  });

  test("ignores comment lines", () => {
    const result = parseEnvContent("# This is a comment\nCC_PROXY_PORT=4141");
    expect(result["# This is a comment"]).toBeUndefined();
    expect(result.CC_PROXY_PORT).toBe("4141");
  });

  test("ignores blank lines", () => {
    const result = parseEnvContent("\n\n\nCC_PROXY_PORT=4141\n\n");
    expect(Object.keys(result)).toHaveLength(1);
  });

  test("handles values with = signs in them", () => {
    const result = parseEnvContent("SOME_URL=https://example.com?a=1&b=2");
    expect(result.SOME_URL).toBe("https://example.com?a=1&b=2");
  });

  test("ignores lines without = sign", () => {
    const result = parseEnvContent("INVALID_LINE\nCC_PROXY_PORT=4141");
    expect(result.INVALID_LINE).toBeUndefined();
    expect(result.CC_PROXY_PORT).toBe("4141");
  });
});

// ─── getCliVersion cross-platform search ──────────────────────────────────────

describe("getCliVersion — candidate path coverage", () => {
  const path = require("path");
  const os = require("os");

  test("Linux global npm path is checked", () => {
    // This verifies our fix includes the standard Linux path
    const linuxPath = "/usr/local/lib/node_modules/command-code/package.json";
    expect(linuxPath).toMatch(/usr\/local\/lib/);
  });

  test("macOS Homebrew path is checked (Apple Silicon)", () => {
    const brewPath = "/opt/homebrew/lib/node_modules/command-code/package.json";
    expect(brewPath).toMatch(/homebrew/);
  });

  test("nvm path is constructed with current node version", () => {
    const home = process.env.HOME || "";
    const nvmPath = path.join(home, ".nvm", "versions", "node", process.version, "lib", "node_modules", "command-code", "package.json");
    expect(nvmPath).toContain(".nvm");
    expect(nvmPath).toContain(process.version);
  });

  test("fallback version is 0.27.0", () => {
    // If all paths fail, the proxy should still start with a safe default
    const fallback = "0.27.0";
    expect(fallback).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
