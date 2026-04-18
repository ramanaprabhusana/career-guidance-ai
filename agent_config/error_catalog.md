# Error catalog (Skill 8)

Single source of truth for runtime error codes, recovery strategy, and the
user-visible message the Speaker is allowed to fall back to. Nodes import
these codes via `src/utils/errors.ts`. New errors must be added here **before**
new code paths reference them (Skill 9 validation enforces parity).

| Code | Trigger | Severity | Recovery | User-visible message |
|------|---------|----------|----------|----------------------|
| `LLM_TIMEOUT` | Analyzer / Speaker LLM call exceeds wall-clock budget | recoverable | Retry once with shorter prompt; on second failure fall through to deterministic path | "Just a moment — let me try that again." |
| `LLM_JSON_PARSE` | Analyzer returns non-JSON or schema-invalid JSON | recoverable | Re-prompt analyzer with stricter wrapper; if still bad, treat as empty delta and continue | (silent — no user message) |
| `LLM_RATE_LIMIT` | Provider 429 / quota exceeded | recoverable | Exponential backoff (max 2 retries); on exhaustion, deterministic digest path | "I'm being rate-limited by the model — give me a second." |
| `CONFIG_MISSING` | `loadPromptTemplate` / `loadSkillFile` cannot find the requested file | fatal | Abort the turn; surface to logs + `validate-config` next run | "Something's off on my side — please refresh and try again." |
| `STATE_SCHEMA_VIOLATION` | State updater receives a delta that violates `state_schema.json` (e.g. discard without `reason`, see G7) | recoverable | Drop the offending field, log, continue with rest of delta | (silent) |
| `RAG_RETRIEVAL_EMPTY` | Tool executor returns no chunks for a target role | recoverable | Fall back to curated `data/occupations.json`; flag in evidence | (silent) |
| `RAG_SOURCE_DOWN` | O*NET / BLS / USAJOBS connector raises network error | recoverable | Use cached / curated dataset; mark `evidenceDiscarded` with reason `source_down` | "Live job-market data isn't reachable right now — using cached figures." |
| `RAG_BLANK_ROLE` | RAG / tool call dispatched with blank or whitespace-only `role` (Change 5 P0, Apr 14 2026) | recoverable | Set `needsRoleConfirmation = true` in state so the speaker asks the user to name a specific role instead of falling back to a random cached occupation | (silent — speaker emits the role-confirmation ask, not an error message) |
| `PROFILE_DB_UNAVAILABLE` | `better-sqlite3` open or query fails | recoverable | Skip profile load/save for this turn; continue stateless | (silent) |
| `DB_WRITE_FAILED` | SQLite write (profile / session / episodic) raises (P1, Apr 17 2026) | recoverable | Retry once in-memory, then fall back to memory-only state for this turn; log with sessionId + phase | (silent) |
| `EXPORT_FAILURE` | PDF/HTML/JSON export raises (pdfkit/fs/render failure) (P1, Apr 17 2026) | recoverable | Return 500 with catalog `userMessage`; never leaves the session in a half-written state | "I couldn't generate that report — please try again in a moment." |
| `TOOL_EXECUTION_FAILED` | Generic non-network tool failure outside the RAG/DB taxonomies (P1, Apr 17 2026) | recoverable | Orchestrator uses deterministic fallback for the tool class; speaker continues without the tool data | (silent) |
| `OFF_TOPIC_PERSISTENT` | User repeatedly off-topic after 2 redirects (Sr 11/15B) | policy | Speaker delivers polite scope reminder; increment soft strike | "I can only help with career guidance — let's get back to your goals." |
| `SAFETY_BLOCK` | Offensive / sexist content (Sr 12) past warning threshold | policy | Block further turns; surface handoff stub | "I can't continue this conversation. Please reach out to a human advisor." |

## Conventions
- **recoverable** errors must never abort the graph turn — they fall through to a deterministic path or a silent skip.
- **fatal** errors abort the current turn and are logged with full stack to the LangSmith trace.
- **policy** errors are not bugs — they encode product/safety rules and always produce a user-visible Speaker message.
- New codes added here MUST also be added to the `ErrorCode` union in `src/utils/errors.ts`; `validate-config.ts` checks both lists agree.
