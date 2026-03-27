import type { AgentStateType } from "../state.js";

/**
 * Stub summarizer for MVP. Phase 2 will implement actual summarization
 * using an LLM call when conversation exceeds a configurable turn threshold.
 */
export function maybeSummarize(state: AgentStateType): Partial<AgentStateType> {
  // Phase 2: implement actual summarization at turn thresholds
  return {};
}
