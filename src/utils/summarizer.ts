import type { AgentStateType } from "../state.js";
import { config, createChatModel } from "../config.js";
import { HumanMessage } from "@langchain/core/messages";

const MIN_TURNS_FOR_SUMMARY = 8;
const MAX_HISTORY_LINES = 14;

/**
 * Rolling conversation summary for episodic memory and long threads.
 * Uses a single LLM call when GOOGLE_API_KEY is set and history is long enough;
 * otherwise returns a short deterministic digest (no API).
 */
export async function maybeSummarize(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const history = state.conversationHistory ?? [];
  if (history.length < MIN_TURNS_FOR_SUMMARY) {
    return {};
  }

  const lines = history
    .slice(-MAX_HISTORY_LINES)
    .map((t) => `${t.role}: ${t.content.slice(0, 500)}`)
    .join("\n");

  if (process.env.GOOGLE_API_KEY) {
    try {
      const model = createChatModel("analyzer", config);
      const response = await model.invoke([
        new HumanMessage(
          `Summarize this career coaching dialogue in 4-6 bullet points for future sessions. Focus on goals, target role, skills mentioned, and decisions.\n\n${lines}`
        ),
      ]);
      const text =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const summary = text.trim().slice(0, 4000);
      if (summary.length > 40) {
        return { conversationSummary: summary };
      }
    } catch {
      /* fall through */
    }
  }

  const digest = `Session digest (${history.length} turns): phases ${state.currentPhase}; target ${state.targetRole ?? "n/a"}; goal ${state.sessionGoal ?? "n/a"}.`;
  return { conversationSummary: digest.slice(0, 2000) };
}
