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
  if (!isFillerOrAmbiguous(state.userMessage) || !state.analyzerOutput) {
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
