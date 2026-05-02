import type { AgentStateType, AnalyzerOutput } from "../state.js";

const FILLER_PATTERNS = [
  /^ok(?:ay)?$/,
  /^hmm+$/,
  /^maybe$/,
  /^not sure$/,
  /^i\s+don'?t\s+know$/,
  /^you\s+tell\s+me$/,
  /^whatever\s+you\s+think$/,
  /^fine$/,
  /^continue$/,
  // Change 8 (May 02 2026): positive single-word reactions carry no career-fact
  // information and must not trigger state writes or report-generation messages.
  // Bug AN-013: "nice" after a plan block caused the bot to emit "your report
  // is being generated". These tokens are structurally identical to "ok" after
  // a statement (not a question) and must be caught by the filler guard.
  /^nice$/,
  /^great$/,
  /^cool$/,
  /^wow$/,
  /^thanks$/,
  /^thank\s+you$/,
  /^awesome$/,
  /^excellent$/,
  /^perfect$/,
  /^interesting$/,
  /^lovely$/,
  /^noted$/,
  /^good$/,
  /^sounds good$/,
  /^looks good$/,
];

const DURABLE_FIELD_NAMES = new Set([
  "target_role",
  "job_title",
  "industry",
  "years_experience",
  "education_level",
  "location",
  "preferred_timeline",
  "skills",
  "learning_needs",
  "timeline",
  "recommended_path",
  "plan_blocks",
  "report_generated",
]);

export function isFillerOrAmbiguous(message: string | null | undefined): boolean {
  const normalized = (message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return FILLER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function fillerGuard(state: AgentStateType): Partial<AgentStateType> {
  // Change 6 (May 01 2026): prefer LLM-classified intent over regex patterns.
  // The LLM has conversation context; regex cannot tell "ok" after a yes/no
  // question (= confirm) from "ok" as an empty filler between turns (= filler).
  // Both signals must agree — if the LLM says "confirm", let it through even
  // if the text looks like a filler word.
  const intentIsFiller = state.analyzerOutput?.user_intent === "filler";
  const textIsFiller = isFillerOrAmbiguous(state.userMessage);
  const isFiller = intentIsFiller || (textIsFiller && state.analyzerOutput?.user_intent !== "confirm");

  if (!isFiller || !state.analyzerOutput) {
    return {};
  }

  const cleanedFields = Object.fromEntries(
    Object.entries(state.analyzerOutput.extracted_fields ?? {}).filter(
      ([field]) => !DURABLE_FIELD_NAMES.has(field),
    ),
  );

  const analyzerOutput: AnalyzerOutput = {
    ...state.analyzerOutput,
    extracted_fields: cleanedFields,
    required_complete: false,
    phase_suggestion: null,
    confidence: Math.min(state.analyzerOutput.confidence ?? 0, 0.3),
    notes: [
      state.analyzerOutput.notes,
      "Filler / ambiguous intent guard: durable state writes blocked; ask bounded career-guidance clarification if needed.",
    ]
      .filter(Boolean)
      .join(" "),
  };

  return {
    analyzerOutput,
    newPhase: null,
  };
}
