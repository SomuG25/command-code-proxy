#!/usr/bin/env node
// ─── CC-Proxy Setup Script ────────────────────────────────────────────────────
//
// Automatically configures Claude Code to use the proxy, and saves a backup
// of the original settings so you can restore them at any time.
//
// Usage:
//   node setup.js           ← configure Claude Code → proxy
//   node setup.js --restore ← restore original Claude Code settings
//   node setup.js --status  ← show current Claude Code API config

const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.CC_PROXY_PORT || "4141", 10);
const PROXY_URL = `http://localhost:${PORT}/v1`;
const PROXY_KEY = "sk-proxy";
const BACKUP_FILE = path.join(__dirname, ".claude-config-backup.json");

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const bold  = (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const cyan  = (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const yellow= (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const red   = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const dim   = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

// ─── Claude config helpers ────────────────────────────────────────────────────

/**
 * Run `claude config get --global <key>` and return the value, or null.
 */
function claudeGet(key) {
  try {
    const out = execSync(`claude config get --global ${key}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    // Output format: "key: value"
    const idx = out.indexOf(":");
    return idx !== -1 ? out.slice(idx + 1).trim() : out;
  } catch {
    return null;
  }
}

/**
 * Run `claude config set --global <key> <value>`.
 */
function claudeSet(key, value) {
  execFileSync("claude", ["config", "set", "--global", key, value], {
    stdio: "inherit",
    timeout: 8000,
  });
}

/**
 * Check if the `claude` CLI is available.
 */
function checkClaudeCli() {
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function doStatus() {
  console.log(`\n${bold("Current Claude Code API configuration:")}\n`);

  const apiBase = claudeGet("apibaseurl");
  const apiKey  = claudeGet("apikey");
  const model   = claudeGet("model");

  const isProxy = apiBase && apiBase.includes(`localhost:${PORT}`);

  console.log(`  API Base URL: ${cyan(apiBase || "(not set — uses Anthropic default)")}`);
  console.log(`  API Key:      ${dim(apiKey ? apiKey.slice(0, 8) + "…" : "(not set)")}`);
  console.log(`  Model:        ${model || "(not set)"}`);
  console.log();

  if (isProxy) {
    console.log(green("  ✓ Claude Code is currently pointing at cc-proxy."));
  } else {
    console.log(yellow("  ⚡ Claude Code is NOT using cc-proxy (pointing at Anthropic or another URL)."));
  }

  const hasBackup = fs.existsSync(BACKUP_FILE);
  if (hasBackup) {
    const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
    console.log(dim(`\n  Backup saved: ${BACKUP_FILE}`));
    console.log(dim(`  Backup API Base: ${backup.apibaseurl || "(none)"}`));
    console.log(dim(`  Backup API Key:  ${backup.apikey ? backup.apikey.slice(0, 8) + "…" : "(none)"}`));
  }

  console.log();
}

function doSetup() {
  console.log(`\n${bold("cc-proxy Setup")}\n`);

  if (!checkClaudeCli()) {
    console.error(red("  ✗ 'claude' CLI not found. Install it first:"));
    console.error(red("    npm install -g command-code\n"));
    process.exit(1);
  }

  // ── Read and back up current settings ──────────────────────────────────────
  const currentBase = claudeGet("apibaseurl");
  const currentKey  = claudeGet("apikey");
  const currentModel= claudeGet("model");

  // Don't overwrite a backup that still points at the real API
  // (prevents losing the original backup if setup is run twice)
  const alreadyProxy = currentBase && currentBase.includes(`localhost:${PORT}`);

  if (!alreadyProxy) {
    const backup = {
      apibaseurl: currentBase,
      apikey: currentKey,
      model: currentModel,
      backedUpAt: new Date().toISOString(),
    };
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
    console.log(dim(`  ✓ Backed up original settings to ${path.basename(BACKUP_FILE)}`));
  } else {
    console.log(yellow("  ⚠  Claude Code is already pointing at the proxy — re-applying settings."));
  }

  // ── Apply proxy settings ────────────────────────────────────────────────────
  console.log(`\n  Configuring Claude Code to use the proxy...`);

  claudeSet("apibaseurl", PROXY_URL);
  claudeSet("apikey", PROXY_KEY);

  console.log(`\n${green("  ✓ Done! Claude Code now uses cc-proxy.")}\n`);
  console.log("  ┌─────────────────────────────────────────────────────────────┐");
  console.log(`  │  Proxy URL: ${cyan(PROXY_URL.padEnd(49))}│`);
  console.log(`  │  API Key:   ${cyan(PROXY_KEY.padEnd(49))}│`);
  console.log("  └─────────────────────────────────────────────────────────────┘");
  console.log();
  console.log(`  ${bold("Next steps:")}`);
  console.log(`    1. Start the proxy:  ${cyan("node index.js")}`);
  console.log(`    2. Use Claude Code:  ${cyan('claude --model "deepseek" "your prompt"')}`);
  console.log();
  console.log(dim(`  To restore original settings:  node setup.js --restore`));
  console.log(dim(`  To check current config:       node setup.js --status`));
  console.log();
}

function doRestore() {
  console.log(`\n${bold("Restoring original Claude Code settings...")}\n`);

  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(red("  ✗ No backup found. Did you run 'node setup.js' first?"));
    console.error(dim(`    Expected backup at: ${BACKUP_FILE}\n`));
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));

  if (backup.apibaseurl) {
    claudeSet("apibaseurl", backup.apibaseurl);
    console.log(`  ✓ Restored API base URL: ${cyan(backup.apibaseurl)}`);
  } else {
    // No original base URL → clear to default (remove the key)
    try {
      execSync("claude config unset --global apibaseurl", { stdio: "pipe", timeout: 5000 });
      console.log("  ✓ Cleared API base URL (restored to Anthropic default)");
    } catch {
      console.log(yellow("  ⚠  Could not clear apibaseurl — set it manually if needed"));
    }
  }

  if (backup.apikey) {
    claudeSet("apikey", backup.apikey);
    console.log(`  ✓ Restored API key: ${dim(backup.apikey.slice(0, 8) + "…")}`);
  }

  if (backup.model) {
    claudeSet("model", backup.model);
    console.log(`  ✓ Restored model: ${backup.model}`);
  }

  // Remove backup file
  fs.unlinkSync(BACKUP_FILE);

  console.log(`\n${green("  ✓ Claude Code is restored to its original configuration.")}\n`);
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (arg === "--restore") {
  doRestore();
} else if (arg === "--status") {
  doStatus();
} else if (!arg || arg === "--setup") {
  doSetup();
} else {
  console.error(red(`Unknown argument: ${arg}`));
  console.error("Usage:");
  console.error("  node setup.js           ← configure proxy");
  console.error("  node setup.js --restore ← restore original");
  console.error("  node setup.js --status  ← check current config");
  process.exit(1);
}
