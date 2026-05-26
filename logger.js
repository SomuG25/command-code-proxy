const fs = require("fs");
const path = require("path");

// ─── Structured Logger ────────────────────────────────────────────────────────
//
// Controlled by LOG_LEVEL env var (set in .env or shell):
//
//   debug  — everything: full request payloads, headers, upstream bodies
//   info   — normal operation: requests, model, results  [DEFAULT]
//   warn   — only warnings and errors
//   error  — only errors
//   silent — nothing
//
// Optionally writes to LOG_FILE (e.g. LOG_FILE=proxy.log)

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

const RAW_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase().trim();
const CURRENT_LEVEL = LEVELS[RAW_LEVEL] ?? LEVELS.info;

// File logging (optional)
const LOG_FILE = process.env.LOG_FILE || null;
let _logStream = null;

function getLogStream() {
  if (!LOG_FILE) return null;
  if (!_logStream) {
    try {
      _logStream = fs.createWriteStream(
        path.resolve(process.cwd(), LOG_FILE),
        { flags: "a", encoding: "utf8" }
      );
      _logStream.on("error", (err) => {
        // Stop trying if the file can't be written
        console.error(`[logger] Could not write to log file: ${err.message}`);
        _logStream = null;
      });
    } catch {
      _logStream = null;
    }
  }
  return _logStream;
}

// ─── ANSI colour helpers (only in TTY) ───────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;

const COLORS = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  bold:   "\x1b[1m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  gray:   "\x1b[90m",
};

function c(color, text) {
  return USE_COLOR ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

// ─── Core emit ────────────────────────────────────────────────────────────────

function emit(levelName, parts) {
  const numericLevel = LEVELS[levelName] ?? LEVELS.info;
  if (numericLevel < CURRENT_LEVEL) return;

  const ts = new Date().toISOString();
  const line = parts.join(" ");

  // Colour the level tag
  const levelTag = {
    debug: c("gray",   "[DEBUG]"),
    info:  c("cyan",   "[INFO] "),
    warn:  c("yellow", "[WARN] "),
    error: c("red",    "[ERROR]"),
  }[levelName] ?? `[${levelName.toUpperCase()}]`;

  const consoleLine = `${c("dim", ts)} ${levelTag} ${line}`;
  const fileLine    = `${ts} [${levelName.toUpperCase()}] ${parts.map(stripAnsi).join(" ")}\n`;

  if (levelName === "error") {
    console.error(consoleLine);
  } else {
    console.log(consoleLine);
  }

  const stream = getLogStream();
  if (stream) stream.write(fileLine);
}

function stripAnsi(s) {
  // Strip ANSI escape codes from file output
  // eslint-disable-next-line no-control-regex
  return typeof s === "string" ? s.replace(/\x1b\[[0-9;]*m/g, "") : String(s);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const logger = {
  /**
   * Raw info about what LOG_LEVEL is active.
   */
  level: RAW_LEVEL,

  /**
   * log.debug(...) — only shown when LOG_LEVEL=debug
   * Useful for dumping full request/response payloads during development.
   */
  debug(...args) { emit("debug", args); },

  /**
   * log.info(...) — shown at info and debug levels (default).
   */
  info(...args)  { emit("info",  args); },

  /**
   * log.warn(...) — shown at warn, info, debug levels.
   */
  warn(...args)  { emit("warn",  args); },

  /**
   * log.error(...) — always shown (except silent).
   */
  error(...args) { emit("error", args); },

  /**
   * log.request(method, path) — logs an incoming request line.
   */
  request(method, pathname) {
    emit("info", [c("bold", `→ ${method}`), c("blue", pathname)]);
  },

  /**
   * log.upstream(status) — logs the upstream response status.
   */
  upstream(status) {
    const color = status >= 400 ? "red" : "green";
    emit("info", [`└ upstream`, c(color, `status=${status}`)]);
  },

  /**
   * log.model(model, isStream, msgCount, toolCount) — logs request details.
   */
  model(model, isStream, msgCount, toolCount) {
    emit("info", [
      `├ model=${c("cyan", model)}`,
      `stream=${isStream}`,
      `msgs=${msgCount}`,
      `tools=${toolCount}`,
    ]);
  },

  /**
   * log.search(engine, query, resultCount) — logs a web search operation.
   */
  search(engine, query, resultCount) {
    const short = query.length > 70 ? query.slice(0, 70) + "…" : query;
    emit("info", [`🔎 ${engine}:`, c("dim", `"${short}"`), `→ ${resultCount} results`]);
  },

  /**
   * log.heal(count, names) — logs orphaned tool call healing.
   */
  heal(count, names) {
    emit("warn", [`⚕  healed ${count} orphaned tool call(s):`, c("yellow", names.join(", "))]);
  },

  /**
   * log.payload(label, obj) — dumps a full object (debug only).
   */
  payload(label, obj) {
    if (CURRENT_LEVEL > LEVELS.debug) return;
    try {
      emit("debug", [label, "\n" + JSON.stringify(obj, null, 2)]);
    } catch {
      emit("debug", [label, String(obj)]);
    }
  },
};

module.exports = logger;
