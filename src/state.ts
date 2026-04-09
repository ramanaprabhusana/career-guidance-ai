import { Annotation } from "@langchain/langgraph";

// --- Domain Types ---

export type EducationLevel = "high_school" | "associate" | "bachelor" | "master" | "doctoral" | "other";
export type SessionGoal = "explore_options" | "pursue_specific_role";
export type Track = "career_exploration" | "role_targeting";
export type UserRating = "not_yet_familiar" | "working_knowledge" | "strong_proficiency";
export type GapCategory = "absent" | "underdeveloped" | "strong";
export type TurnType = "first_turn" | "standard" | "phase_transition" | "clarification" | "entity_transition" | "termination";
export type SkillsAssessmentStatus = "not_started" | "in_progress" | "complete" | "skipped";

export interface CandidateDirection {
  direction_title: string;
  rationale: string;
}

export type SkillType = "technical" | "soft";

export interface SkillAssessment {
  skill_name: string;
  onet_source: string;
  required_proficiency: string;
  user_rating: UserRating | null;
  gap_category: GapCategory | null;
  skill_type: SkillType;
}

export interface AnalyzerOutput {
  extracted_fields: Record<string, unknown>;
  required_complete: boolean;
  phase_suggestion: string | null;
  confidence: number;
  notes: string;
}

export interface LearningResourceItem {
  title: string;
  url: string;
  note?: string;
}

export interface EvidenceDecisionItem {
  source: string;
  detail: string;
  reason: string;
}

export interface ProgressItem {
  id: string;
  label: string;
  done: boolean;
}

// Slice S-E: one confirmable block in the block-by-block plan (Sr 31, 32).
// Fixed set of labels per Sr 32: understanding, path, skills, courses, end_goal.
export type PlanBlockId = "understanding" | "path" | "skills" | "courses" | "end_goal";
export interface PlanBlock {
  id: PlanBlockId;
  label: string;
  content: string;
  confirmed: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// --- LangGraph State Annotation ---

export const AgentState = Annotation.Root({
  // Session metadata
  sessionId: Annotation<string>,
  userId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  startedAt: Annotation<number>,

  // Conversation history
  conversationHistory: Annotation<ConversationTurn[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  conversationSummary: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  // Current user message
  userMessage: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  // Phase tracking
  currentPhase: Annotation<string>({ reducer: (_, b) => b, default: () => "orientation" }),
  previousPhase: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  newPhase: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  turnNumber: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  phaseTurnNumber: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  // Orientation fields
  jobTitle: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  industry: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  yearsExperience: Annotation<number | null>({ reducer: (_, b) => b, default: () => null }),
  educationLevel: Annotation<EducationLevel | null>({ reducer: (_, b) => b, default: () => null }),
  sessionGoal: Annotation<SessionGoal | null>({ reducer: (_, b) => b, default: () => null }),
  location: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  preferredTimeline: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // Exploration fields
  track: Annotation<Track | null>({ reducer: (_, b) => b, default: () => null }),
  interests: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...a, ...b])],
    default: () => [],
  }),
  constraints: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...a, ...b])],
    default: () => [],
  }),
  candidateDirections: Annotation<CandidateDirection[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  // Role targeting fields
  targetRole: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  skills: Annotation<SkillAssessment[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  skillsAssessmentStatus: Annotation<SkillsAssessmentStatus>({
    reducer: (_, b) => b,
    default: () => "not_started",
  }),
  candidateSkills: Annotation<Record<string, SkillAssessment[]>>({
    reducer: (_, b) => b,
    default: () => ({}),
  }),

  // Planning fields
  recommendedPath: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  timeline: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  skillDevelopmentAgenda: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  immediateNextSteps: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  planRationale: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  reportGenerated: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),

  learningResources: Annotation<LearningResourceItem[]>({ reducer: (_, b) => b, default: () => [] }),
  evidenceKept: Annotation<EvidenceDecisionItem[]>({ reducer: (_, b) => b, default: () => [] }),
  evidenceDiscarded: Annotation<EvidenceDecisionItem[]>({ reducer: (_, b) => b, default: () => [] }),
  progressItems: Annotation<ProgressItem[]>({ reducer: (_, b) => b, default: () => [] }),

  // Runtime control
  turnType: Annotation<TurnType>({ reducer: (_, b) => b, default: () => "first_turn" }),
  analyzerPrompt: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  analyzerOutput: Annotation<AnalyzerOutput | null>({ reducer: (_, b) => b, default: () => null }),
  speakerPrompt: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  speakerOutput: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  userChangedPhase: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  maxPhaseRedirects: Annotation<number>({ reducer: (_, b) => b, default: () => 2 }),
  transitionDecision: Annotation<string>({ reducer: (_, b) => b, default: () => "continue" }),
  error: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  consecutiveErrors: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  clarificationCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  clarificationTopic: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // Slice S-A: off-topic strike counter (Sr 11, 15B). Cross-phase, runtime-only.
  // Reset to 0 on any productive turn; raises OFF_TOPIC_PERSISTENT at threshold.
  offTopicStrikes: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  // Slice S-B: returning-user flags (Sr 17, 20). Populated at session-init
  // time by the profile hook; consumed by speaker-prompt-creator on first_turn.
  isReturningUser: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  priorSessionSummary: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  // C3: up to 3 recent episodic summaries, most-recent-first. Seeded by
  // server.ts /api/session prefetch via listRecentEpisodic(); consumed by
  // speaker-prompt-creator in the first_turn + isReturningUser branch so the
  // welcome-back opener can recall multi-session context, not just the last summary.
  priorEpisodicSummaries: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  resumeChoice: Annotation<"resume" | "fresh" | null>({ reducer: (_, b) => b, default: () => null }),

  // Slice S-F: safety strike counter (Sr 12). Raises SAFETY_BLOCK at threshold.
  safetyStrikes: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  // Slice S-C: resume upload extracted fields (Sr 19B, 24). Minimal only:
  // name, years, prominent domain. Deliberately NOT ATS-style parsing.
  resumeName: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  resumeYears: Annotation<number | null>({ reducer: (_, b) => b, default: () => null }),
  resumeDomain: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // Slice S-H: career-shift intent (Sr 28). When true, planning phase uses
  // the shift advisory variant (financial/emotional caveat, then re-evaluate).
  shiftIntent: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),

  // Slice S-E: block-by-block plan confirmation (Sr 31, 32). Each block is
  // delivered and must be `confirmed` before the next is surfaced.
  planBlocks: Annotation<PlanBlock[]>({ reducer: (_, b) => b, default: () => [] }),
});

export type AgentStateType = typeof AgentState.State;
