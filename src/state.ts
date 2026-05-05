import { Annotation } from "@langchain/langgraph";

// --- Domain Types ---

export type EducationLevel = "high_school" | "associate" | "bachelor" | "master" | "doctoral" | "other";
export type SessionGoal = "explore_options" | "pursue_specific_role";
export type Track = "career_exploration" | "role_targeting";
export type UserRating = "beginner" | "intermediate" | "advanced" | "expert";
export type GapCategory = "absent" | "underdeveloped" | "strong";
export type TurnType = "first_turn" | "standard" | "phase_transition" | "clarification" | "entity_transition" | "termination";
export type SkillsAssessmentStatus = "not_started" | "in_progress" | "complete" | "skipped";

// --- Change 4: Structured memory & role-switching continuity ---

export type UserPersona = "new_user" | "returning_continue" | "returning_restart";

export interface RoleHistoryEntry {
  role_name: string;
  status: "explored" | "compared" | "targeted" | "deprioritized" | "inactive" | "history";
  first_seen_at: number;
  notes?: string;
}

export interface PriorPlanSnapshot {
  target_role: string;
  generated_at: number;
  recommended_path: string | null;
  skill_development_agenda: string[];
  immediate_next_steps: string[];
  timeline: string | null;
  plan_blocks?: PlanBlock[];
  report_generated?: boolean;
  pdf_path?: string;
}

export interface RoleSwitchContext {
  from_role: string;
  to_role: string;
  shared_skills: string[];      // skill_names that exist in both roles' O*NET sets
  rehydrated_ratings: number;   // count of ratings copied across
  initiated_at: number;
}

export interface RoleComparisonContext {
  role_a: string;
  role_b: string;
  shared_skills: string[];
  unique_a: string[];
  unique_b: string[];
  recommended_priority: "role_a" | "role_b" | null;
  rationale: string | null;
}

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

// AN-001 (DEMO_REQUIREMENTS_MATRIX_May02): fine-grained contextual turn functions.
// More precise than user_intent; covers role-switch and evidence/report requests.
export type TurnFunction =
  | "confirm"          // user agrees with a specific confirmable assistant prompt
  | "acknowledge"      // bare ack with no actionable intent (e.g. "ok" after explanation)
  | "provide_info"     // user states a new fact
  | "clarify"          // user asks for clarification
  | "correct"          // user revises a prior answer
  | "switch_role"      // user signals intent to evaluate a different role
  | "request_evidence" // user asks for wage/market/skills data
  | "request_report"   // user asks for report/export
  | "uncertain"        // user expresses doubt, needs help deciding
  | "invalid"          // user's response does not satisfy the required field
  | null;

export interface AnalyzerOutput {
  extracted_fields: Record<string, unknown>;
  required_complete: boolean;
  phase_suggestion: string | null;
  confidence: number;
  notes: string;
  // Change 6 (May 01 2026): LLM-classified intent using conversation context.
  // Used by fillerGuard and stateUpdater instead of hardcoded word matching.
  // "confirm"  — user agrees/accepts the most recent question or proposal
  // "filler"   — acknowledgement with no meaningful content, no clear agreement
  // "question" — user is asking something
  // "new_info" — user provides a new fact
  // "correction" — user changes a prior answer
  // null       — mixed or unclear
  user_intent?: "confirm" | "filler" | "question" | "new_info" | "correction" | null;

  // AN-001 / CONF-003 (2026-05-03, additive extension, demo stabilization).
  // All fields optional — backward compat: existing logic uses user_intent when these are absent.
  // Orchestrator gates prefer turn_function when present (Phase 3 wiring).
  turn_function?: TurnFunction;
  turn_confidence?: number;           // 0.0–1.0 confidence in turn_function classification
  referenced_prior_prompt?: boolean;  // true if cue directly responds to prior assistant question
  target_field?: string | null;       // which field or action the cue relates to
  proposed_state_patch?: Record<string, unknown>; // candidate state update — NOT an actual write
  requires_orchestrator_gate?: boolean; // true if Orchestrator must validate before action
  reason?: string;                    // brief explanation for traceability (TST-002)
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
  skillsTargetRole: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  skillsAssessmentStatus: Annotation<SkillsAssessmentStatus>({
    reducer: (_, b) => b,
    default: () => "not_started",
  }),
  candidateSkills: Annotation<Record<string, SkillAssessment[]>>({
    reducer: (_, b) => b,
    default: () => ({}),
  }),

  // Post-assessment fields (Change 3: mandatory skills assessment)
  learningNeeds: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  learningNeedsComplete: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  skillsEvaluationSummary: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  userConfirmedEvaluation: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
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
  // Change 6 (May 01 2026): ties the completion signal to a specific role.
  // Set to targetRole when a PDF/HTML export succeeds; cleared on role switch.
  // The planning-terminal guard checks this against the current targetRole so
  // the "Career Plan is Ready" card cannot reappear after a role switch even
  // if state.reportGenerated is still true from the prior session.
  reportGeneratedForRole: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

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
  pendingMemoryDeletionConfirmation: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),

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

  // --- Change 4: Structured role memory & persona-aware continuity ---
  // Persona gates the welcome flow and controls whether profile facts are
  // re-asked on session init. `new_user` → standard orientation; `returning_continue`
  // → offer to resume the prior target; `returning_restart` → keep profile facts
  // but reset path-specific state (see applyRestartPivot in server.ts).
  userPersona: Annotation<UserPersona>({
    reducer: (_, b) => b,
    default: () => "new_user",
  }),
  // BR-11: hard cap of 3 candidate industries during exploration_career.
  // Reducer appends unique entries and truncates to 3 so downstream code can
  // trust the cap without re-checking.
  candidateIndustries: Annotation<string[]>({
    reducer: (a, b) => Array.from(new Set([...(a ?? []), ...b])).slice(0, 3),
    default: () => [],
  }),
  prioritizedIndustries: Annotation<string[]>({
    reducer: (_, b) => b.slice(0, 3),
    default: () => [],
  }),
  // Merge-by-role_name role history: upserts so the same role can be
  // re-promoted (e.g. from "explored" → "targeted") without losing its
  // first_seen_at anchor. Used for delta-question logic (BR-9).
  exploredRoles: Annotation<RoleHistoryEntry[]>({
    reducer: (a, b) => {
      const merged = [...(a ?? [])];
      for (const entry of b ?? []) {
        const i = merged.findIndex(
          (e) => e.role_name.toLowerCase() === entry.role_name.toLowerCase()
        );
        if (i >= 0) merged[i] = { ...merged[i], ...entry };
        else merged.push(entry);
      }
      return merged;
    },
    default: () => [],
  }),
  // BR-10: hard cap of 2 roles in active comparison.
  comparedRoles: Annotation<string[]>({
    reducer: (_, b) => b.slice(0, 2),
    default: () => [],
  }),
  previousTargetRole: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  roleSwitchContext: Annotation<RoleSwitchContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  // Set true after the speaker delivers the role-switch recap turn so the
  // orchestrator can resume normal transitions (see determineTransition guard).
  roleSwitchAcknowledged: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  roleComparisonContext: Annotation<RoleComparisonContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  // Snapshot of the most recent completed plan. Kept separate from
  // exploredRoles[] because the speaker needs O(1) access for the
  // "prior plan on file" callout without iterating history.
  priorPlan: Annotation<PriorPlanSnapshot | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  // Change 5 P0 (Apr 14 2026): set true by the orchestrator when RAG
  // auto-fetch is needed but `targetRole` is blank / unconfirmed. The
  // speaker reads this and asks the user to pick a specific role instead
  // of silently falling back to an unrelated cached occupation (Apr 12
  // "Data Entry Keyer" regression).
  needsRoleConfirmation: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),

  // CONF-004 (2026-05-04): set true by speaker-prompt-creator when the
  // MANDATORY OVERRIDE block content is appended (i.e. a plan block was
  // just presented to the user). The state-updater reads this on the NEXT
  // turn to allow isConfirmation() to advance the block even when Gemini
  // misclassifies "yes" as turn_function:"acknowledge".
  blockJustPresented: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),

  // --- Change 5 P0 (Apr 14 2026): scoped ReAct loop channels ---
  // Gated by `ENABLE_REACT_LOOP=true` env AND a named intent. The default
  // chat path is single-pass (analyzer → state-updater → speaker); these
  // channels are only populated when the user explicitly asks for "deep
  // research this role" and the orchestrator approves the loop. Hard caps
  // are enforced inside `reactExecutor` (≤ maxReactSteps AND ≤ 15s elapsed).
  reactIntent: Annotation<"deep_research_role" | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  reactStepCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  maxReactSteps: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 5,
  }),
  reactObservationLog: Annotation<
    Array<{ step: number; tool: string; args: Record<string, unknown>; ok: boolean; summary: string }>
  >({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
  pendingReactTool: Annotation<{ name: string; args: Record<string, unknown> } | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
