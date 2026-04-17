/**
 * P1 recovery-matrix regression gate (Apr 17 2026).
 *
 * Asserts that every ErrorCode in the catalog has an explicit recovery
 * strategy and that the public API contract (AgentError fields, userMessage
 * propagation, logIncident shape) stays stable. Dependency-free; no Gemini.
 *
 * Run: `npm run recovery`
 */

import {
  AgentError,
  ERROR_REGISTRY,
  recoveryFor,
  logIncident,
  type ErrorCode,
} from "../utils/errors.js";

let failed = 0;
let passed = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    // eslint-disable-next-line no-console
    console.error(`  \u2717 ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function section(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n[${name}]`);
}

// ---------------------------------------------------------------------------
// [1] every code in the registry has a defined recovery strategy
// ---------------------------------------------------------------------------
section("1] registry completeness");

const allCodes = Object.keys(ERROR_REGISTRY) as ErrorCode[];
assert("registry is non-empty", allCodes.length > 0);

for (const code of allCodes) {
  const entry = ERROR_REGISTRY[code];
  assert(
    `${code} has severity + recovery`,
    typeof entry.severity === "string" && typeof entry.recovery === "string",
  );
  assert(
    `${code} recovery in allowed set`,
    ["retry", "fallback", "escalate", "user_message_only", "silent"].includes(entry.recovery),
    `got ${entry.recovery}`,
  );
}

// ---------------------------------------------------------------------------
// [2] policy codes MUST have a user-visible message
// ---------------------------------------------------------------------------
section("2] policy codes surface a user message");

for (const code of allCodes) {
  const entry = ERROR_REGISTRY[code];
  if (entry.severity === "policy") {
    assert(`${code} (policy) has userMessage`, entry.userMessage !== null);
  }
}

// ---------------------------------------------------------------------------
// [3] P1 codes exist with expected strategies
// ---------------------------------------------------------------------------
section("3] P1 new codes wired correctly");

assert("EXPORT_FAILURE -> user_message_only", recoveryFor("EXPORT_FAILURE") === "user_message_only");
assert("DB_WRITE_FAILED -> fallback",        recoveryFor("DB_WRITE_FAILED") === "fallback");
assert("TOOL_EXECUTION_FAILED -> fallback",  recoveryFor("TOOL_EXECUTION_FAILED") === "fallback");
assert("EXPORT_FAILURE has user message",    !!ERROR_REGISTRY.EXPORT_FAILURE.userMessage);

// ---------------------------------------------------------------------------
// [4] AgentError propagates code + severity + userMessage
// ---------------------------------------------------------------------------
section("4] AgentError contract");

const e = new AgentError("RAG_BLANK_ROLE", "blank");
assert("code preserved",        e.code === "RAG_BLANK_ROLE");
assert("severity preserved",    e.severity === "recoverable");
assert("userMessage preserved", e.userMessage === ERROR_REGISTRY.RAG_BLANK_ROLE.userMessage);
assert("is Error instance",     e instanceof Error);

// ---------------------------------------------------------------------------
// [5] logIncident accepts sessionId/phase/fallbackUsed without throwing
// ---------------------------------------------------------------------------
section("5] logIncident shape");

// capture stderr
const realErr = console.error;
let captured = "";
console.error = (msg: unknown) => { captured += String(msg) + "\n"; };
try {
  logIncident("EXPORT_FAILURE", { sessionId: "s1", phase: "planning", fallbackUsed: "cached_report" });
} finally {
  console.error = realErr;
}

const line = captured.trim().split("\n")[0] ?? "";
let parsed: Record<string, unknown> = {};
try { parsed = JSON.parse(line); } catch { /* noop */ }

assert("logIncident emits JSON",            typeof parsed.code === "string");
assert("logIncident carries sessionId",     parsed.sessionId === "s1");
assert("logIncident carries phase",         parsed.phase === "planning");
assert("logIncident carries fallbackUsed",  parsed.fallbackUsed === "cached_report");
assert("logIncident echoes recovery",       parsed.recovery === "user_message_only");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  // eslint-disable-next-line no-console
  console.error("Recovery regression suite FAILED");
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("All recovery assertions passed.");
}
