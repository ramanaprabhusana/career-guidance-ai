import type { AgentStateType, AnalyzerOutput } from "../state.js";

// Tokens that are context-sensitive: "ok" after a yes/no question is a valid
// confirm, so the LLM intent is allowed to override the pattern match.
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

// Change 9 (May 02 2026): bridge-acknowledgement tokens that fire unconditionally
// regardless of LLM user_intent. These are the deterministic backstop for the
// AN-005 gap: the LLM may still classify "sure" after a bridge turn as "confirm",
// but these patterns override that decision. A pattern-list check is more reliable
// than an LLM instruction for tokens that are structurally never a meaningful confirm.
const UNCONDITIONAL_FILLER_PATTERNS = [
  /^sure$/,
  /^sure\s+thing$/,
  /^understood$/,
  /^got\s+it$/,
  /^alright$/,
  /^i\s+see$/,
  /^makes?\s+sense$/,
  /^right$/,
  /^fair\s+enough$/,
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
  return (
    FILLER_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    UNCONDITIONAL_FILLER_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function fillerGuard(state: AgentStateType): Partial<AgentStateType> {
  const normalized = (state.userMessage ?? "").trim().toLowerCase();
  const intentIsFiller = state.analyzerOutput?.user_intent === "filler";

  // Change 9 (May 02 2026): two-tier check. Unconditional patterns (bridge
  // acknowledgements like "sure", "got it") fire regardless of LLM intent —
  // they are the deterministic backstop for the AN-005 confirm-classification
  // gap. Context-sensitive patterns ("ok", "fine") still respect the LLM
  // "confirm" override so a real yes/no answer is not incorrectly blocked.
  const isUnconditionalFiller = UNCONDITIONAL_FILLER_PATTERNS.some((p) => p.test(normalized));
  const isContextualFiller =
    FILLER_PATTERNS.some((p) => p.test(normalized)) &&
    state.analyzerOutput?.user_intent !== "confirm";

  const isFiller = intentIsFiller || isUnconditionalFiller || isContextualFiller;

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
