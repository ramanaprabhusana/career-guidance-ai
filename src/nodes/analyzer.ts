import type { AgentStateType, AnalyzerOutput } from "../state.js";
import { config, createChatModel } from "../config.js";
import { HumanMessage } from "@langchain/core/messages";

const EMPTY_OUTPUT: AnalyzerOutput = {
  extracted_fields: {},
  required_complete: false,
  phase_suggestion: null,
  confidence: 0,
  notes: "",
};

function parseAnalyzerResponse(text: string): AnalyzerOutput {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in analyzer response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    extracted_fields: parsed.extracted_fields ?? {},
    required_complete: parsed.required_complete ?? false,
    phase_suggestion: parsed.phase_suggestion ?? null,
    confidence: parsed.confidence ?? 0,
    notes: parsed.notes ?? "",
  };
}

export async function analyzer(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Skip on first turn
  if (state.turnType === "first_turn" || !state.analyzerPrompt) {
    return {
      analyzerOutput: null,
      newPhase: null,
    };
  }

  const model = createChatModel("analyzer", config);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await model.invoke([new HumanMessage(state.analyzerPrompt)]);
      const text = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

      const output = parseAnalyzerResponse(text);

      // Determine if phase should change
      const newPhase = output.phase_suggestion &&
        output.phase_suggestion !== state.currentPhase &&
        output.confidence >= 0.8
        ? output.phase_suggestion
        : null;

      return {
        analyzerOutput: output,
        newPhase,
        consecutiveErrors: 0,
        userChangedPhase: newPhase ? state.userChangedPhase + 1 : state.userChangedPhase,
      };
    } catch (e) {
      lastError = e as Error;
      if (attempt < config.maxRetries) {
        continue;
      }
    }
  }

  // All retries exhausted — return empty output
  return {
    analyzerOutput: EMPTY_OUTPUT,
    newPhase: null,
    error: `Analyzer failed after ${config.maxRetries + 1} attempts: ${lastError?.message}`,
    consecutiveErrors: state.consecutiveErrors + 1,
  };
}
