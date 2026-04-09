import type { AgentStateType } from "../state.js";
import { maybeSummarize } from "../utils/summarizer.js";

/**
 * Skill 7 — rolling summary node (G2).
 *
 * Runs after the Speaker so that summarization is part of the turn contract,
 * not a server-only side effect.
 *
 * P5: the threshold check is now exposed as `shouldSummarize(state)` so the
 * graph can route around this node entirely on turns that wouldn't summarize
 * anyway. This saves a graph-dispatch hop on every short/early-session turn.
 */
export function shouldSummarize(state: AgentStateType): "yes" | "no" {
  const history = state.conversationHistory ?? [];
  if (history.length < 8) return "no";
  if (state.turnNumber <= 0 || state.turnNumber % 5 !== 0) return "no";
  return "yes";
}

export async function summarizerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Guard retained as a safety net even though the graph now routes via
  // shouldSummarize, so direct invocations (e.g. tests) still behave.
  if (shouldSummarize(state) === "no") return {};
  return await maybeSummarize(state);
}
