import type { AgentStateType } from "../state.js";
import { maybeSummarize } from "../utils/summarizer.js";

/**
 * Skill 7 — rolling summary node (G2).
 *
 * Runs after the Speaker so that summarization is part of the turn contract,
 * not a server-only side effect. The threshold check itself lives inside
 * `maybeSummarize` (history length + turn cadence), so this node is a thin
 * dispatcher that always returns a partial state patch.
 */
export async function summarizerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Cadence guard: only attempt every 5 turns once history is non-trivial.
  // Mirrors the gate previously held in server.ts so behavior is unchanged.
  const history = state.conversationHistory ?? [];
  if (history.length < 8) return {};
  if (state.turnNumber <= 0 || state.turnNumber % 5 !== 0) return {};

  return await maybeSummarize(state);
}
