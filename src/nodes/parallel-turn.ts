import type { AgentStateType } from "../state.js";
import { analyzerPromptCreator } from "./analyzer-prompt-creator.js";
import { analyzer } from "./analyzer.js";
import { speakerPromptCreator } from "./speaker-prompt-creator.js";
import { speaker } from "./speaker.js";

/**
 * P9: run analyzer and speaker LLMs concurrently via Promise.all.
 *
 * The original graph chain was:
 *   analyzerPromptCreator → analyzer → stateUpdater → speakerPromptCreator → speaker
 *
 * Analyzer and speaker are two separate LLM calls. The speaker depends on
 * stateUpdater's merge of analyzer.extracted_fields only for the "phase
 * collected data" / "missing fields" view. The user's raw message is passed
 * to the speaker prompt directly, and the speaker template now instructs the
 * model to treat facts in the latest user message as known (see
 * agent_config/prompts/speaker_template.md). That closes the 1-turn-lag
 * window for the common case.
 *
 * This node runs both prompt creators synchronously against pre-merge state,
 * then awaits analyzer+speaker in parallel. Phase-redirect handling is
 * preserved inline: if the analyzer proposes a new phase under the redirect
 * budget, we rebuild the speaker prompt for the new phase and re-run the
 * speaker once. That redirect path is rare and intentionally takes the old
 * cost; the common path saves ~50% wall clock.
 */
export async function parallelTurn(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const analyzerPromptState = analyzerPromptCreator(state);
  const speakerPromptState = speakerPromptCreator(state);

  const stateWithPrompts: AgentStateType = {
    ...state,
    ...analyzerPromptState,
    ...speakerPromptState,
  } as AgentStateType;

  // first_turn / canned opener path: speakerPromptCreator returned a pre-baked
  // speakerOutput with no speakerPrompt. Analyzer short-circuits on first_turn
  // too, so both calls are effectively free — but we still invoke them so
  // their conversationHistory/analyzerOutput contracts hold.
  if (speakerPromptState.speakerOutput && !speakerPromptState.speakerPrompt) {
    const [analyzerResult, speakerResult] = await Promise.all([
      analyzer(stateWithPrompts),
      speaker(stateWithPrompts),
    ]);
    return {
      ...analyzerPromptState,
      ...speakerPromptState,
      ...analyzerResult,
      ...speakerResult,
    };
  }

  // Common path: two real LLM calls running concurrently.
  const [analyzerResult, speakerResult] = await Promise.all([
    analyzer(stateWithPrompts),
    speaker(stateWithPrompts),
  ]);

  // Phase-redirect case: the analyzer proposed a pivot AND we're under the
  // redirect budget. The parallel speaker reply was written against the OLD
  // phase, so rebuild the speaker prompt for the new phase and re-run it.
  // We do NOT re-run the analyzer — it already made its decision and forcing
  // it again would only burn latency without changing the outcome.
  const proposedPhase = analyzerResult.newPhase;
  if (
    proposedPhase &&
    proposedPhase !== state.currentPhase &&
    (state.userChangedPhase ?? 0) < state.maxPhaseRedirects
  ) {
    const pivotState: AgentStateType = {
      ...stateWithPrompts,
      ...analyzerResult,
      currentPhase: proposedPhase,
    } as AgentStateType;
    const newSpeakerPromptState = speakerPromptCreator(pivotState);

    if (newSpeakerPromptState.speakerOutput && !newSpeakerPromptState.speakerPrompt) {
      // Canned new-phase opener — no second LLM call needed.
      return {
        ...analyzerPromptState,
        ...analyzerResult,
        ...newSpeakerPromptState,
        conversationHistory: [
          {
            role: "assistant",
            content: newSpeakerPromptState.speakerOutput,
            timestamp: Date.now(),
          },
        ],
      };
    }

    const newSpeakerResult = await speaker({
      ...pivotState,
      ...newSpeakerPromptState,
    } as AgentStateType);

    return {
      ...analyzerPromptState,
      ...analyzerResult,
      ...newSpeakerPromptState,
      ...newSpeakerResult,
    };
  }

  return {
    ...analyzerPromptState,
    ...speakerPromptState,
    ...analyzerResult,
    ...speakerResult,
  };
}
