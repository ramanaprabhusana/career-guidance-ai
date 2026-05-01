import type { AgentStateType } from "../state.js";
import { config, createChatModel, hasConfiguredLLMProvider } from "../config.js";
import { HumanMessage } from "@langchain/core/messages";
import { loadPromptTemplate, populateTemplate } from "./prompt-loader.js";

const MIN_TURNS_FOR_SUMMARY = 8;
const MAX_HISTORY_LINES = 14;

/**
 * Rolling conversation summary for episodic memory and long threads.
 * Uses a single LLM call when an LLM provider is configured and history is long enough;
 * otherwise returns a short deterministic digest (no API).
 *
 * Prompt body lives in `agent_config/prompts/summary_template.md` (Skill 7
 * framework template) and is loaded via `prompt-loader` so config is the SSOT.
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

  if (hasConfiguredLLMProvider()) {
    try {
      const template = loadPromptTemplate("summary_template.md");
      const prompt = populateTemplate(template, {
        phase: state.currentPhase ?? "orientation",
        target_role: state.targetRole ?? "n/a",
        session_goal: state.sessionGoal ?? "n/a",
        history: lines,
      });
      const model = createChatModel("analyzer", config);
      const response = await model.invoke([new HumanMessage(prompt)]);
      const text =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const summary = text.trim().slice(0, 4000);
      if (summary.length > 40) {
        return { conversationSummary: summary };
      }
    } catch {
      /* fall through to deterministic digest */
    }
  }

  const digest = `Session digest (${history.length} turns): phases ${state.currentPhase}; target ${state.targetRole ?? "n/a"}; goal ${state.sessionGoal ?? "n/a"}.`;
  return { conversationSummary: digest.slice(0, 2000) };
}
