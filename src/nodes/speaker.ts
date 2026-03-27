import type { AgentStateType } from "../state.js";
import { config, createChatModel } from "../config.js";
import { HumanMessage } from "@langchain/core/messages";

function validateSpeakerOutput(text: string): { valid: boolean; reason?: string } {
  // Check 1: Not empty
  if (!text.trim()) return { valid: false, reason: "empty output" };

  // Check 2: No JSON leakage
  if (text.includes('"extracted_fields"') || text.includes('"phase_suggestion"')) {
    return { valid: false, reason: "contains analyzer JSON" };
  }

  // Check 3: No internal field/phase names leaked
  const leakedTerms = [
    "currentPhase", "turnType", "analyzerOutput", "state_schema",
    "phase_registry", "orchestrator_rules", "AgentState",
  ];
  for (const term of leakedTerms) {
    if (text.includes(term)) {
      return { valid: false, reason: `leaked internal term: ${term}` };
    }
  }

  // Check 4: No "required" / "optional" language about fields
  if (/\brequired field\b/i.test(text) || /\boptional field\b/i.test(text)) {
    return { valid: false, reason: "used required/optional language" };
  }

  // Check 5: Reasonable length
  if (text.length > 2000) {
    return { valid: false, reason: "output too long" };
  }

  return { valid: true };
}

export async function speaker(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // If speaker output already set (e.g., first_turn fallback), return it
  if (state.speakerOutput && !state.speakerPrompt) {
    return {
      conversationHistory: [
        { role: "assistant", content: state.speakerOutput, timestamp: Date.now() },
      ],
    };
  }

  // Use fallback if no prompt
  if (!state.speakerPrompt) {
    const fallback = config.fallbackMessages[state.turnType] ?? config.fallbackMessages.standard;
    return {
      speakerOutput: fallback,
      conversationHistory: [
        { role: "assistant", content: fallback, timestamp: Date.now() },
      ],
    };
  }

  const model = createChatModel("speaker", config);

  try {
    const response = await model.invoke([new HumanMessage(state.speakerPrompt)]);
    const text = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    const validation = validateSpeakerOutput(text);

    if (validation.valid) {
      return {
        speakerOutput: text,
        consecutiveErrors: 0,
        conversationHistory: [
          { role: "assistant", content: text, timestamp: Date.now() },
        ],
      };
    }

    // Validation failed — use fallback
    const fallback = config.fallbackMessages[state.turnType] ?? config.fallbackMessages.standard;
    return {
      speakerOutput: fallback,
      conversationHistory: [
        { role: "assistant", content: fallback, timestamp: Date.now() },
      ],
    };
  } catch (e) {
    const fallback = config.fallbackMessages[state.turnType] ?? config.fallbackMessages.standard;
    return {
      speakerOutput: fallback,
      error: `Speaker error: ${(e as Error).message}`,
      consecutiveErrors: state.consecutiveErrors + 1,
      conversationHistory: [
        { role: "assistant", content: fallback, timestamp: Date.now() },
      ],
    };
  }
}
