/**
 * Skill 8 — error code registry (G3).
 *
 * Mirrors `agent_config/error_catalog.md`. The catalog is the SSOT; this
 * module exists so TypeScript code can reference codes without stringly-typed
 * sprinkles. `scripts/validate-config.ts` enforces that the union below and
 * the markdown table stay in sync.
 */

export type ErrorSeverity = "recoverable" | "fatal" | "policy";

export type ErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_JSON_PARSE"
  | "LLM_RATE_LIMIT"
  | "CONFIG_MISSING"
  | "STATE_SCHEMA_VIOLATION"
  | "RAG_RETRIEVAL_EMPTY"
  | "RAG_SOURCE_DOWN"
  | "PROFILE_DB_UNAVAILABLE"
  | "OFF_TOPIC_PERSISTENT"
  | "SAFETY_BLOCK";

export interface ErrorEntry {
  code: ErrorCode;
  severity: ErrorSeverity;
  /** Speaker fallback message; null means the error is silent to the user. */
  userMessage: string | null;
}

export const ERROR_REGISTRY: Record<ErrorCode, ErrorEntry> = {
  LLM_TIMEOUT: { code: "LLM_TIMEOUT", severity: "recoverable", userMessage: "Just a moment — let me try that again." },
  LLM_JSON_PARSE: { code: "LLM_JSON_PARSE", severity: "recoverable", userMessage: null },
  LLM_RATE_LIMIT: { code: "LLM_RATE_LIMIT", severity: "recoverable", userMessage: "I'm being rate-limited by the model — give me a second." },
  CONFIG_MISSING: { code: "CONFIG_MISSING", severity: "fatal", userMessage: "Something's off on my side — please refresh and try again." },
  STATE_SCHEMA_VIOLATION: { code: "STATE_SCHEMA_VIOLATION", severity: "recoverable", userMessage: null },
  RAG_RETRIEVAL_EMPTY: { code: "RAG_RETRIEVAL_EMPTY", severity: "recoverable", userMessage: null },
  RAG_SOURCE_DOWN: { code: "RAG_SOURCE_DOWN", severity: "recoverable", userMessage: "Live job-market data isn't reachable right now — using cached figures." },
  PROFILE_DB_UNAVAILABLE: { code: "PROFILE_DB_UNAVAILABLE", severity: "recoverable", userMessage: null },
  OFF_TOPIC_PERSISTENT: { code: "OFF_TOPIC_PERSISTENT", severity: "policy", userMessage: "I can only help with career guidance — let's get back to your goals." },
  SAFETY_BLOCK: { code: "SAFETY_BLOCK", severity: "policy", userMessage: "I can't continue this conversation. Please reach out to a human advisor." },
};

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
