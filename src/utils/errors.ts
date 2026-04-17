/**
 * Skill 8 — error code registry (G3).
 *
 * Mirrors `agent_config/error_catalog.md`. The catalog is the SSOT; this
 * module exists so TypeScript code can reference codes without stringly-typed
 * sprinkles. `scripts/validate-config.ts` enforces that the union below and
 * the markdown table stay in sync.
 */

export type ErrorSeverity = "recoverable" | "fatal" | "policy";

/**
 * C7: Skill 8 recovery strategy.
 *
 * Explicit decision per code so node authors aren't inventing policy in
 * try/catch. `retry` = the same op may be attempted again (bounded);
 * `fallback` = use a cached / deterministic alternative and keep going;
 * `escalate` = stop the current turn and surface to the operator;
 * `user_message_only` = tell the user (via ERROR_REGISTRY.userMessage) and
 * do not retry. `silent` = swallow and keep going, no user text.
 */
export type RecoveryStrategy =
  | "retry"
  | "fallback"
  | "escalate"
  | "user_message_only"
  | "silent";

export type ErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_JSON_PARSE"
  | "LLM_RATE_LIMIT"
  | "CONFIG_MISSING"
  | "STATE_SCHEMA_VIOLATION"
  | "RAG_RETRIEVAL_EMPTY"
  | "RAG_SOURCE_DOWN"
  | "RAG_BLANK_ROLE"
  | "PROFILE_DB_UNAVAILABLE"
  | "OFF_TOPIC_PERSISTENT"
  | "SAFETY_BLOCK";

export interface ErrorEntry {
  code: ErrorCode;
  severity: ErrorSeverity;
  /** C7: recovery strategy (matches the Recovery column in error_catalog.md). */
  recovery: RecoveryStrategy;
  /** Speaker fallback message; null means the error is silent to the user. */
  userMessage: string | null;
}

export const ERROR_REGISTRY: Record<ErrorCode, ErrorEntry> = {
  LLM_TIMEOUT:            { code: "LLM_TIMEOUT",            severity: "recoverable", recovery: "retry",             userMessage: "Just a moment — let me try that again." },
  LLM_JSON_PARSE:         { code: "LLM_JSON_PARSE",         severity: "recoverable", recovery: "retry",             userMessage: null },
  LLM_RATE_LIMIT:         { code: "LLM_RATE_LIMIT",         severity: "recoverable", recovery: "retry",             userMessage: "I'm being rate-limited by the model — give me a second." },
  CONFIG_MISSING:         { code: "CONFIG_MISSING",         severity: "fatal",       recovery: "escalate",          userMessage: "Something's off on my side — please refresh and try again." },
  STATE_SCHEMA_VIOLATION: { code: "STATE_SCHEMA_VIOLATION", severity: "recoverable", recovery: "silent",            userMessage: null },
  RAG_RETRIEVAL_EMPTY:    { code: "RAG_RETRIEVAL_EMPTY",    severity: "recoverable", recovery: "fallback",          userMessage: null },
  RAG_SOURCE_DOWN:        { code: "RAG_SOURCE_DOWN",        severity: "recoverable", recovery: "fallback",          userMessage: "Live job-market data isn't reachable right now — using cached figures." },
  // Change 5 P0 (Apr 14 2026): never silently fetch for a blank/missing role.
  // Orchestrator sets `needsRoleConfirmation` so the speaker re-asks instead.
  RAG_BLANK_ROLE:         { code: "RAG_BLANK_ROLE",         severity: "recoverable", recovery: "user_message_only", userMessage: null },
  PROFILE_DB_UNAVAILABLE: { code: "PROFILE_DB_UNAVAILABLE", severity: "recoverable", recovery: "silent",            userMessage: null },
  OFF_TOPIC_PERSISTENT:   { code: "OFF_TOPIC_PERSISTENT",   severity: "policy",      recovery: "user_message_only", userMessage: "I can only help with career guidance — let's get back to your goals." },
  SAFETY_BLOCK:           { code: "SAFETY_BLOCK",           severity: "policy",      recovery: "user_message_only", userMessage: "I can't continue this conversation. Please reach out to a human advisor." },
};

/** C7: look up the recovery strategy for a code. Node authors should call
 * this instead of branching on severity, so policy changes live in one table. */
export function recoveryFor(code: ErrorCode): RecoveryStrategy {
  return ERROR_REGISTRY[code].recovery;
}

export class AgentError extends Error {
  readonly code: ErrorCode;
  readonly severity: ErrorSeverity;
  readonly userMessage: string | null;
  constructor(code: ErrorCode, detail?: string) {
    const entry = ERROR_REGISTRY[code];
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.severity = entry.severity;
    this.userMessage = entry.userMessage;
  }
}

/** Structured log line for observability hooks (LangSmith / stdout). */
export function logAgentError(err: AgentError, context: Record<string, unknown> = {}): void {
  // Keep this dependency-free so it can be called from any node.
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "error", code: err.code, severity: err.severity, message: err.message, ...context }));
}
