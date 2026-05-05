import type {
  AgentStateType,
  TurnType,
  SkillAssessment,
  GapCategory,
  UserRating,
  LearningResourceItem,
  EvidenceDecisionItem,
  ProgressItem,
  RoleHistoryEntry,
  RoleSwitchContext,
  PriorPlanSnapshot,
} from "../state.js";
import { config } from "../config.js";
import { retrieveSkillsForMultipleRoles, categorizeSkillType } from "../utils/rag.js";
import { runTool } from "./tool-executor.js";
import { saveProfileHook, appendEpisodicHook } from "../utils/profile-hooks.js";
import { AgentError, logAgentError } from "../utils/errors.js";
import { isOffTopic, MAX_OFF_TOPIC_STRIKES } from "../utils/topic-guard.js";
import { isOffensive, MAX_SAFETY_STRIKES } from "../utils/safety-guard.js";

// ARCH-001 / TST-002: structured responsibility markers.
// Tag | Responsibility
// [ORCHESTRATOR_DECISION] | Orchestrator: deciding what to do next (phase, tool, report)
// [PHASE_DECISION]         | Orchestrator: stay-in-phase or advance with explicit reason
// [STATE_WRITE]            | State Updater: persisting an approved field value
// [RETRIEVAL_GATE]         | Orchestrator: allowing or blocking RAG / tool dispatch
// [REPORT_GATE]            | Orchestrator: evaluating report readiness
function logOrch(tag: string, payload: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify({ tag, ...payload }));
  } catch {
    /* never throw from logging */
  }
}

function deriveGapCategory(userRating: UserRating | null, requiredProficiency: string): GapCategory | null {
  if (!userRating) return null;

  const lowerReq = requiredProficiency.toLowerCase();
  const highRequired = ["expert", "advanced", "high", "extensive"].some(
    (w) => lowerReq.includes(w)
  );
  const expertRequired = ["expert", "extensive"].some(
    (w) => lowerReq.includes(w)
  );

  if (userRating === "beginner") return "absent";
  if (userRating === "intermediate") {
    return highRequired ? "underdeveloped" : "strong";
  }
  if (userRating === "advanced") {
    return expertRequired ? "underdeveloped" : "strong";
  }
  return "strong"; // expert
}

/**
 * Change 5 (P0, Apr 14 2026 sprint): single choke point for every
 * `targetRole` write. Protects against the Apr 12 regression where thin
 * user replies ("ok", "yes") caused the analyzer to emit an empty /
 * null `target_role`, which then blanked a previously-confirmed role.
 *
 * Returns the resolved role string that was actually written, or null
 * if the incoming value was not a non-empty string (in which case
 * `updates.targetRole` is left alone — never blanked).
 *
 * Logs every real change so regressions are visible in stderr/LangSmith.
 */
function applyTargetRoleWrite(
  updates: Partial<AgentStateType>,
  incomingRaw: unknown,
  currentTargetRole: string | null,
  reason: string
): string | null {
  if (typeof incomingRaw !== "string") return null;
  const incoming = incomingRaw.trim();
  if (!incoming) return null;
  const current = currentTargetRole?.trim() ?? null;
  if (current && incoming.toLowerCase() === current.toLowerCase()) {
    // No-op rewrite (normalize trim); do not log noise.
    updates.targetRole = incoming;
    return incoming;
  }
  logOrch("[STATE_WRITE]", {
    event: "target_role_write",
    from: current,
    to: incoming,
    reason,
  });
  updates.targetRole = incoming;
  return incoming;
}

function mergeOrientationFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};

  // Change 7 (May 01 2026): orientation fields are locked once the user leaves
  // the orientation phase. The analyzer can still extract them (e.g. if the user
  // volunteers a job title while discussing skills), but we must not let a
  // late extraction silently overwrite a value the user already confirmed and
  // that may have advanced the conversation. Exception: target_role is managed
  // separately by applyTargetRoleWrite and is never orientation-locked.
  // OR-002B (2026-05-03): prefer isCorrection() which reads turn_function first.
  const orientationLocked =
    state.currentPhase !== "orientation" &&
    !isCorrection(state.analyzerOutput);

  if (fields.job_title !== undefined && !orientationLocked) updates.jobTitle = fields.job_title as string;
  if (fields.industry !== undefined && !orientationLocked) updates.industry = fields.industry as string;
  if (fields.years_experience !== undefined && !orientationLocked) updates.yearsExperience = fields.years_experience as number;
  if (fields.education_level !== undefined && !orientationLocked) updates.educationLevel = fields.education_level as AgentStateType["educationLevel"];
  if (fields.session_goal !== undefined && !orientationLocked) updates.sessionGoal = fields.session_goal as AgentStateType["sessionGoal"];
  if (fields.location !== undefined && !orientationLocked) updates.location = fields.location as string;
  if (fields.preferred_timeline !== undefined) updates.preferredTimeline = fields.preferred_timeline as string;
  // Also capture target_role if mentioned during orientation.
  // Change 5 P0: guarded write — null/blank target_role never clears a prior role.
  if (fields.target_role !== undefined) {
    applyTargetRoleWrite(updates, fields.target_role, state.targetRole, "orientation_merge");
  }
  return updates;
}

function mergeExplorationFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};
  if (fields.interests) {
    const newInterests = fields.interests as string[];
    updates.interests = [...new Set([...state.interests, ...newInterests])];
  }
  if (fields.constraints) {
    const newConstraints = fields.constraints as string[];
    updates.constraints = [...new Set([...state.constraints, ...newConstraints])];
  }
  if (fields.candidate_directions) {
    const incoming = fields.candidate_directions as AgentStateType["candidateDirections"];
    const existing = state.candidateDirections;
    const existingTitles = new Set(existing.map(d => d.direction_title.toLowerCase()));
    const deduped = incoming.filter(d => !existingTitles.has(d.direction_title.toLowerCase()));
    updates.candidateDirections = [...existing, ...deduped];
  }
  // Capture target_role when user picks a specific role during exploration.
  // Change 5 P0: guarded write — null/blank target_role never clears a prior role.
  if (fields.target_role !== undefined) {
    applyTargetRoleWrite(updates, fields.target_role, state.targetRole, "exploration_merge");
  }
  // Change 4 (BR-11): capture candidate industries, cap at 3, raise a
  // clarification signal when the user names a 4th so the speaker can help
  // them narrow with reasoned tradeoffs.
  const industryMerge = mergeIndustryFields(state, fields);
  if (industryMerge.candidateIndustries) {
    updates.candidateIndustries = industryMerge.candidateIndustries;
  }
  if (industryMerge.overLimitSignal) {
    updates.clarificationCount = state.clarificationCount + 1;
    updates.clarificationTopic = "INDUSTRY_CAP_HIT";
  }
  return updates;
}

/**
 * Change 4 (BR-9): carry user_rating values from one role's skill set to
 * another when the skill_name matches. Used when a user pivots target_role
 * mid-session so they don't have to re-rate shared skills (e.g. Financial
 * Analyst → Quantitative Analyst both need "Mathematics" and "Critical
 * Thinking"). Also recomputes gap_category against the new role's required
 * proficiency so the gap analysis is correct for the NEW role, not the old.
 *
 * Normalizes skill_name case + whitespace so "Python Programming" matches
 * "python  programming" etc.
 */
function rehydrateSkillRatings(
  newSkills: SkillAssessment[],
  ratingSource: SkillAssessment[],
): { skills: SkillAssessment[]; rehydrated: number; sharedNames: string[] } {
  const lut = new Map<string, UserRating>();
  for (const s of ratingSource) {
    if (s.user_rating !== null) {
      lut.set(s.skill_name.toLowerCase().trim(), s.user_rating);
    }
  }
  let rehydrated = 0;
  const sharedNames: string[] = [];
  const out = newSkills.map((s) => {
    const prior = lut.get(s.skill_name.toLowerCase().trim());
    if (prior && s.user_rating === null) {
      rehydrated += 1;
      sharedNames.push(s.skill_name);
      return {
        ...s,
        user_rating: prior,
        gap_category: deriveGapCategory(prior, s.required_proficiency),
      };
    }
    return s;
  });
  return { skills: out, rehydrated, sharedNames };
}

/**
 * Change 4 (BR-9): detect same-session target_role pivots. If the user
 * already had a target and is now naming a different one, archive the prior
 * target, snapshot any existing plan, seed roleSwitchContext, and clear path
 * state so the auto-fetch block below refetches skills for the new role
 * (at which point the rehydration hook kicks in).
 *
 * Called from BOTH `mergeRoleTargetingFields` AND `mergePlanningFields` so
 * that a pivot works from any phase the user might be in when they change
 * their mind (including mid-plan delivery).
 *
 * @param fromPlanning when true, also walks the phase back to
 *   `exploration_role_targeting` so the auto-fetch + rehydration hook runs
 *   and the user goes through delta-only skill questions before the new plan.
 */
function applyRoleSwitchPivot(
  state: AgentStateType,
  updates: Partial<AgentStateType>,
  incomingRoleRaw: string,
  fromPlanning: boolean
): void {
  const incomingRole = incomingRoleRaw.trim();
  const currentRole = state.targetRole?.trim();
  const isPivot =
    !!incomingRole &&
    !!currentRole &&
    incomingRole.toLowerCase() !== currentRole.toLowerCase();

  // Change 5 P0: guarded write — never blank a previously-set role when
  // analyzer returns empty / null on a thin turn. Callers also pre-filter.
  applyTargetRoleWrite(
    updates,
    incomingRole,
    currentRole ?? null,
    fromPlanning ? "planning_pivot" : "role_targeting_pivot"
  );

  // Change 7 (May 01 2026): explicitly clear needsRoleConfirmation whenever
  // a non-blank role is confirmed via pivot. Without this, the flag can persist
  // for one extra turn and the speaker re-asks "what role?" even though the
  // role was just written above.
  if (incomingRole) {
    updates.needsRoleConfirmation = false;
  }

  if (!isPivot) return;

  updates.previousTargetRole = currentRole ?? null;

  // Snapshot prior plan if any plan content exists.
  if (
    state.recommendedPath ||
    (state.skillDevelopmentAgenda ?? []).length > 0 ||
    (state.immediateNextSteps ?? []).length > 0
  ) {
    const snapshot: PriorPlanSnapshot = {
      target_role: currentRole!,
      generated_at: Date.now(),
      recommended_path: state.recommendedPath ?? null,
      skill_development_agenda: state.skillDevelopmentAgenda ?? [],
      immediate_next_steps: state.immediateNextSteps ?? [],
      timeline: state.timeline ?? null,
      plan_blocks: state.planBlocks ?? [],
      report_generated: state.reportGenerated ?? false,
    };
    updates.priorPlan = snapshot;
  }

  // Deprioritize the prior role in history.
  const historyEntry: RoleHistoryEntry = {
    role_name: currentRole!,
    status: "inactive",
    first_seen_at: Date.now(),
    notes: "Marked inactive after role switch; prior artifacts preserved as history.",
  };
  updates.exploredRoles = [...state.exploredRoles, historyEntry];

  // Seed the context so the speaker can deliver a recap turn.
  const switchContext: RoleSwitchContext = {
    from_role: currentRole!,
    to_role: incomingRole!,
    shared_skills: [],
    rehydrated_ratings: 0,
    initiated_at: Date.now(),
  };
  updates.roleSwitchContext = switchContext;
  updates.roleSwitchAcknowledged = false;

  // Clear path-specific state so the auto-fetch block refetches skills.
  updates.skills = [];
  updates.skillsTargetRole = null;
  updates.skillsAssessmentStatus = "not_started";
  updates.learningNeeds = [];
  updates.learningNeedsComplete = false;
  updates.skillsEvaluationSummary = null;
  updates.userConfirmedEvaluation = false;
  updates.recommendedPath = null;
  updates.timeline = null;
  updates.skillDevelopmentAgenda = [];
  updates.immediateNextSteps = [];
  updates.planRationale = null;
  updates.planBlocks = [];
  // Change 8 (May 02 2026): clear evidence attribution so the new role's
  // report evidence log starts fresh. Bug OR-011: SE→DA→PM PDF showed
  // "[O*NET] Data Analyst" in the PM plan evidence log because evidenceKept
  // was not cleared on pivot. DA evidence lives in priorPlan (Appendix A).
  updates.evidenceKept = [];
  updates.evidenceDiscarded = [];

  // When the pivot happens during PLANNING, walk the phase back to
  // role_targeting so the auto-fetch + rehydration hook runs and the user
  // goes through delta-only questions on the new role before the new plan.
  if (fromPlanning) {
    updates.currentPhase = "exploration_role_targeting";
    updates.phaseTurnNumber = 0;
    updates.previousPhase = "planning";
    updates.newPhase = null;
    updates.progressItems = [];
    updates.reportGenerated = false;
    updates.reportGeneratedForRole = null; // Change 6: invalidate role-scoped completion
    // Change 7 (May 01 2026): explicitly reset transitionDecision so the
    // completion signal from the prior role's plan does not bleed into the
    // next API response. Without this, state.transitionDecision = "complete"
    // persists for one turn after the pivot → isComplete: true → card re-fires.
    updates.transitionDecision = "continue";
  }
}

function mergeRoleTargetingFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};

  // Change 5 P0: only dispatch the pivot path if the incoming role is a
  // non-empty string. Thin acknowledgments that produce target_role: null
  // or "" must not invoke the pivot (which would clear prior role state).
  if (fields.target_role !== undefined) {
    const incoming =
      typeof fields.target_role === "string" ? fields.target_role.trim() : "";
    if (incoming) {
      applyRoleSwitchPivot(state, updates, incoming, false);
    }
  }

  // Change 7 (May 01 2026): lock skill ratings once the evaluation is fully
  // confirmed. If the user confirmed their ratings AND 100% of skills are
  // rated, further analyzer extractions for individual skill ratings must be
  // ignored (unless the user is explicitly correcting a rating).
  // OR-002B (2026-05-03): prefer isCorrection() which reads turn_function first.
  const skillsLocked =
    state.userConfirmedEvaluation &&
    state.skillsAssessmentStatus === "complete" &&
    !isCorrection(state.analyzerOutput);

  // Merge skill ratings
  if (fields.skills && !skillsLocked) {
    const incomingSkills = fields.skills as Record<string, unknown>[];
    const updatedSkills = [...(updates.skills ?? state.skills)];

    for (const incoming of incomingSkills) {
      const idx = updatedSkills.findIndex(
        (s) => s.skill_name.toLowerCase() === (incoming.skill_name as string)?.toLowerCase()
      );
      if (idx >= 0) {
        const userRating = (incoming.user_rating as UserRating) ?? updatedSkills[idx].user_rating;
        updatedSkills[idx] = {
          ...updatedSkills[idx],
          user_rating: userRating,
          gap_category: deriveGapCategory(userRating, updatedSkills[idx].required_proficiency),
        };
      }
    }
    updates.skills = updatedSkills;
  }

  // Change 3: post-assessment fields
  if (fields.learning_needs !== undefined && Array.isArray(fields.learning_needs) && !skillsLocked) {
    updates.learningNeeds = fields.learning_needs as string[];
  }
  if (fields.learning_needs_complete === true) {
    updates.learningNeedsComplete = true;
  }
  if (fields.skills_evaluation_summary !== undefined && !skillsLocked) {
    updates.skillsEvaluationSummary = fields.skills_evaluation_summary as string;
  }
  if (fields.user_confirmed_evaluation === true) {
    updates.userConfirmedEvaluation = true;
  }

  // Change 4 (Bug E7): planning gate loop fix.
  // The old check `if (fields.learning_needs_complete === true)` only flipped
  // on an explicit analyzer signal, so the bot looped 4x after the user had
  // already provided priorities + timeframe + confirmation. Fallback rule:
  // if the user has ANY learning needs captured AND the analyzer extracted a
  // priority-related field AND the latest message looks like a confirmation,
  // consider learning needs complete.
  const learningNeedsCurrent =
    updates.learningNeeds ?? state.learningNeeds ?? [];
  const priorityFieldExtracted =
    fields.priorities !== undefined ||
    fields.focus_first !== undefined ||
    fields.top_priority !== undefined;
  // OR-002 / CONF-001 (2026-05-03): resolveUserConfirming prefers turn_function,
  // falls back to user_intent (Change 6), then isConfirmation() (CONF-001 backstop).
  // CONF-001b (2026-05-04): these two gates specifically need the isConfirmation()
  // backstop even when turn_function is present but not "confirm" — Gemini often
  // classifies post-summary "yes" utterances as turn_function:"acknowledge" which
  // bypasses resolveUserConfirming. Using || isConfirmation() restores the
  // narrow backstop that CONF-001 intended for these two fields only.
  const userIsConfirming =
    resolveUserConfirming(state.analyzerOutput, state.userMessage) ||
    isConfirmation(state.userMessage);

  if (
    updates.learningNeedsComplete !== true &&
    !state.learningNeedsComplete &&
    learningNeedsCurrent.length > 0 &&
    (priorityFieldExtracted || state.learningNeeds.length > 0) &&
    userIsConfirming
  ) {
    updates.learningNeedsComplete = true;
  }
  // Same fallback for userConfirmedEvaluation: if the summary was presented
  // last turn and the user just said "yes / looks right / accurate", flip it.
  if (
    updates.userConfirmedEvaluation !== true &&
    !state.userConfirmedEvaluation &&
    state.skillsEvaluationSummary &&
    userIsConfirming
  ) {
    updates.userConfirmedEvaluation = true;
  }

  // CONF-003 (2026-05-04): secondary learningNeedsComplete fallback — fires when all
  // skills are rated AND user is confirming, even if the analyzer never extracted a
  // learning_needs array. Prevents the planning gate from stalling when Gemini omits
  // learning_needs on post-summary "yes" turns.
  // CONF-003b (2026-05-04): removed the state.skillsEvaluationSummary guard — Gemini
  // frequently omits extracting skills_evaluation_summary so the field stays null even
  // after the bot has presented the summary. allSkillsAssessed already proves the full
  // assessment was completed; requiring an additional summary extraction was redundant
  // and caused the gate to stall indefinitely in production sessions.
  const allSkillsAssessed =
    state.skills.length > 0 &&
    state.skills.every((s) => s.user_rating != null);
  if (
    updates.learningNeedsComplete !== true &&
    !state.learningNeedsComplete &&
    allSkillsAssessed &&
    userIsConfirming
  ) {
    updates.learningNeedsComplete = true;
  }

  return updates;
}

// Change 4: extract candidate industries during career exploration (BR-11).
// The reducer in state.ts caps at 3; this merge helper emits a notes-style
// signal when the user names a 4th so the speaker can help them narrow.
function mergeIndustryFields(
  state: AgentStateType,
  fields: Record<string, unknown>,
): { candidateIndustries?: string[]; overLimitSignal: boolean } {
  const out: { candidateIndustries?: string[]; overLimitSignal: boolean } = {
    overLimitSignal: false,
  };
  const raw = fields.candidate_industries;
  if (!Array.isArray(raw)) return out;
  const incoming = raw
    .filter((x) => typeof x === "string")
    .map((x) => (x as string).trim())
    .filter(Boolean);
  if (incoming.length === 0) return out;
  const combined = Array.from(
    new Set([...(state.candidateIndustries ?? []), ...incoming]),
  );
  if (combined.length > 3) {
    out.overLimitSignal = true;
  }
  out.candidateIndustries = combined.slice(0, 3);
  return out;
}

function parseLearningResources(raw: unknown): LearningResourceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LearningResourceItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!title || !url) continue;
    const note = typeof o.note === "string" ? o.note.trim() : undefined;
    out.push(note ? { title, url, note } : { title, url });
  }
  return out;
}

function parseEvidenceDecisions(
  raw: unknown,
  options: { kind: "kept" | "discarded" } = { kind: "kept" }
): EvidenceDecisionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceDecisionItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const source = typeof o.source === "string" ? o.source.trim() : "";
    const detail = typeof o.detail === "string" ? o.detail.trim() : "";
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    if (!source || !detail) continue;
    // G7: discard entries MUST carry a non-empty reason. Drop and log
    // STATE_SCHEMA_VIOLATION rather than silently coercing to "Not specified".
    if (options.kind === "discarded" && !reason) {
      logAgentError(
        new AgentError("STATE_SCHEMA_VIOLATION", "evidence_discarded item missing reason"),
        { source, detail }
      );
      continue;
    }
    out.push({ source, detail, reason: reason || "Not specified" });
  }
  return out;
}

function mergeByUrl(a: LearningResourceItem[], b: LearningResourceItem[]): LearningResourceItem[] {
  const seen = new Set(a.map((r) => r.url));
  const merged = [...a];
  for (const r of b) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    merged.push(r);
  }
  return merged;
}

function mergePlanningFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};

  // Change 4 (BR-9): detect mid-plan role pivots. Walks phase back to
  // exploration_role_targeting so the auto-fetch + rehydration hook runs
  // on the next state-updater pass.
  // Change 5 P0 (Apr 14): only dispatch if incoming is a non-empty string —
  // thin "ok" replies must not trigger a pivot that wipes the current plan.
  if (fields.target_role !== undefined) {
    const incoming =
      typeof fields.target_role === "string" ? fields.target_role.trim() : "";
    if (incoming) {
      applyRoleSwitchPivot(state, updates, incoming, true);
    }
  }

  if (fields.timeline !== undefined) updates.timeline = fields.timeline as string;
  if (fields.recommended_path !== undefined) updates.recommendedPath = fields.recommended_path as string;
  if (fields.skill_development_agenda !== undefined) updates.skillDevelopmentAgenda = fields.skill_development_agenda as string[];
  if (fields.immediate_next_steps !== undefined) updates.immediateNextSteps = fields.immediate_next_steps as string[];
  if (fields.plan_rationale !== undefined) updates.planRationale = fields.plan_rationale as string;
  if (fields.report_generated !== undefined) updates.reportGenerated = fields.report_generated as boolean;

  if (fields.learning_resources !== undefined) {
    const incoming = parseLearningResources(fields.learning_resources);
    updates.learningResources = mergeByUrl(state.learningResources ?? [], incoming).slice(0, 30);
  }
  if (fields.evidence_kept !== undefined) {
    const incoming = parseEvidenceDecisions(fields.evidence_kept);
    updates.evidenceKept = [...(state.evidenceKept ?? []), ...incoming].slice(0, 50);
  }
  if (fields.evidence_discarded !== undefined) {
    const incoming = parseEvidenceDecisions(fields.evidence_discarded, { kind: "discarded" });
    updates.evidenceDiscarded = [...(state.evidenceDiscarded ?? []), ...incoming].slice(0, 50);
  }

  // Slice S-E (Sr 31, 32): plan_blocks merge. Analyzer may deliver the full
  // block set at once; each block carries a `confirmed: false` default.
  if (fields.plan_blocks !== undefined && Array.isArray(fields.plan_blocks)) {
    const parsed = parsePlanBlocks(fields.plan_blocks);
    if (parsed.length > 0) updates.planBlocks = parsed;
  }

  // Slice S-H (Sr 28): shift_intent toggle. Once true, stays true for the session.
  if (fields.shift_intent === true) updates.shiftIntent = true;

  return updates;
}

// OR-001 / OR-002 / CONF-001 (2026-05-03): Orchestrator confirmation resolution.
// Priority:
//   1. turn_function == "confirm" AND referenced_prior_prompt == true  (AN-001 contextual gate)
//   2. user_intent == "confirm"  (Change 6 legacy field)
//   3. isConfirmation(userMessage)  (CONF-001: kept ONLY as narrow fallback for learningNeedsComplete gate)
// Callers outside learningNeedsComplete/planBlock should use resolveUserConfirming.
function resolveUserConfirming(
  analyzerOutput: AgentStateType["analyzerOutput"] | null | undefined,
  userMessage: string | null | undefined,
): boolean {
  if (!analyzerOutput) return isConfirmation(userMessage);
  const ao = analyzerOutput as unknown as Record<string, unknown>;
  // Prefer AN-001 turn_function when present
  if (ao.turn_function !== undefined && ao.turn_function !== null) {
    return ao.turn_function === "confirm" && ao.referenced_prior_prompt === true;
  }
  // Fall back to Change 6 user_intent
  if (analyzerOutput.user_intent !== undefined && analyzerOutput.user_intent !== null) {
    return analyzerOutput.user_intent === "confirm";
  }
  // CONF-001 backstop — only for legacy turns without new fields
  return isConfirmation(userMessage);
}

// OR-002 (2026-05-03): correction signal prefers turn_function over user_intent.
function isCorrection(analyzerOutput: AgentStateType["analyzerOutput"] | null | undefined): boolean {
  if (!analyzerOutput) return false;
  const ao = analyzerOutput as unknown as Record<string, unknown>;
  if (ao.turn_function !== undefined && ao.turn_function !== null) {
    return ao.turn_function === "correct";
  }
  return analyzerOutput.user_intent === "correction";
}

// OR-002 (2026-05-03): role-switch detection prefers turn_function over heuristics.
function isRoleSwitchSignal(analyzerOutput: AgentStateType["analyzerOutput"] | null | undefined): boolean {
  if (!analyzerOutput) return false;
  const ao = analyzerOutput as unknown as Record<string, unknown>;
  if (ao.turn_function !== undefined && ao.turn_function !== null) {
    return ao.turn_function === "switch_role";
  }
  return false;
}

function isConfirmation(message: string | null | undefined): boolean {
  if (!message) return false;
  const t = message.toLowerCase().trim();
  if (!t) return false;
  const markers = ["yes", "yep", "yeah", "sure", "ok", "okay", "confirmed", "looks good", "agreed", "approve", "go ahead", "proceed", "sounds good", "lgtm"];
  return markers.some((m) => t === m || t.startsWith(`${m},`) || t.startsWith(`${m} `) || t.includes(` ${m} `));
}

function parsePlanBlocks(raw: unknown): import("../state.js").PlanBlock[] {
  if (!Array.isArray(raw)) return [];
  const validIds: ReadonlyArray<string> = ["understanding", "path", "skills", "courses", "end_goal"];
  const out: import("../state.js").PlanBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!validIds.includes(id)) continue;
    const label = typeof o.label === "string" ? o.label : id;
    const content = typeof o.content === "string" ? o.content.trim() : "";
    if (!content) continue;
    const confirmed = o.confirmed === true;
    out.push({ id: id as import("../state.js").PlanBlockId, label, content, confirmed });
  }
  return out;
}

/**
 * Change 5 P0 (Apr 14 2026): seed the 5 canonical plan blocks from whatever
 * planning-phase state is already populated. Called exclusively on planning
 * entry (when planBlocks is empty) so the speaker has something concrete to
 * present block-by-block instead of looping on "preparing your plan".
 *
 * Each block's `content` is a short human-readable paragraph assembled
 * deterministically from existing state channels. The speaker is responsible
 * for prose rendering — this function only guarantees that `planBlocks`
 * exists and is non-empty when the planning phase starts.
 */
function seedPlanBlocks(
  state: AgentStateType,
  updates: Partial<AgentStateType>,
): import("../state.js").PlanBlock[] {
  const effectiveTrack = updates.track ?? state.track;
  const targetRole = updates.targetRole ?? state.targetRole ?? null;
  const directions = updates.candidateDirections ?? state.candidateDirections ?? [];
  const skills = updates.skills ?? state.skills ?? [];
  const agenda = updates.skillDevelopmentAgenda ?? state.skillDevelopmentAgenda ?? [];
  const nextSteps = updates.immediateNextSteps ?? state.immediateNextSteps ?? [];
  const timeline = updates.timeline ?? state.timeline ?? null;
  const resources = updates.learningResources ?? state.learningResources ?? [];
  const strengths = skills.filter((s) => s.gap_category === "strong");
  const gaps = skills.filter(
    (s) => s.gap_category === "absent" || s.gap_category === "underdeveloped",
  );

  const blocks: import("../state.js").PlanBlock[] = [];

  // 1. understanding — recap what the user wants
  const understandingParts: string[] = [];
  if (targetRole) {
    understandingParts.push(`You're targeting ${targetRole}.`);
  } else if (directions.length > 0) {
    understandingParts.push(
      `You're exploring ${directions.length} direction${directions.length === 1 ? "" : "s"}: ${directions.map((d) => d.direction_title).slice(0, 3).join(", ")}.`,
    );
  }
  if (state.jobTitle) {
    understandingParts.push(`Current role on file: ${state.jobTitle}.`);
  }
  if (timeline) {
    understandingParts.push(`Preferred timeline: ${timeline}.`);
  }
  if (understandingParts.length > 0) {
    blocks.push({
      id: "understanding",
      label: "Understanding your situation",
      content: understandingParts.join(" "),
      confirmed: false,
    });
  }

  // 2. path — the recommended path
  const pathContent = updates.recommendedPath ?? state.recommendedPath ?? null;
  if (pathContent) {
    blocks.push({
      id: "path",
      label: "Recommended path",
      content: pathContent,
      confirmed: false,
    });
  }

  // 3. skills — strengths + gaps
  const skillsParts: string[] = [];
  if (strengths.length > 0) {
    skillsParts.push(
      `Strengths: ${strengths.slice(0, 4).map((s) => s.skill_name).join(", ")}.`,
    );
  }
  if (gaps.length > 0) {
    skillsParts.push(
      `Focus areas: ${gaps.slice(0, 4).map((s) => s.skill_name).join(", ")}.`,
    );
  }
  if (agenda.length > 0) {
    skillsParts.push(`Development agenda: ${agenda.slice(0, 3).join("; ")}.`);
  }
  if (skillsParts.length > 0) {
    blocks.push({
      id: "skills",
      label: "Skill development plan",
      content: skillsParts.join(" "),
      confirmed: false,
    });
  }

  // 4. courses — learning resources (if any)
  if (resources.length > 0) {
    const top = resources
      .slice(0, 4)
      .map((r) => (r.url ? `${r.title} (${r.url})` : r.title))
      .join("; ");
    blocks.push({
      id: "courses",
      label: "Suggested learning resources",
      content: top,
      confirmed: false,
    });
  } else if (effectiveTrack === "role_targeting" && gaps.length > 0) {
    blocks.push({
      id: "courses",
      label: "Suggested learning resources",
      content: `We'll pull 3–6 reputable resources focused on ${gaps
        .slice(0, 2)
        .map((s) => s.skill_name)
        .join(" and ")} once you confirm the plan direction.`,
      confirmed: false,
    });
  }

  // 5. end_goal — what "done" looks like
  const endParts: string[] = [];
  if (nextSteps.length > 0) {
    endParts.push(`Immediate next steps: ${nextSteps.slice(0, 3).join("; ")}.`);
  }
  if (targetRole) {
    endParts.push(
      `Goal: be interview-ready for ${targetRole} roles${timeline ? ` within ${timeline}` : ""}.`,
    );
  } else if (directions.length > 0) {
    endParts.push(
      `Goal: narrow the ${directions.length} candidate direction${directions.length === 1 ? "" : "s"} to one target role and start a focused plan.`,
    );
  }
  if (endParts.length > 0) {
    blocks.push({
      id: "end_goal",
      label: "End goal & next steps",
      content: endParts.join(" "),
      confirmed: false,
    });
  }

  return blocks;
}

/**
 * Change 5 P0 (Apr 14 2026): advance the next unconfirmed plan block when
 * the user confirms ("ok", "yes", "sounds good"). This is what prevents the
 * "preparing your plan" loop — each confirmed message flips one block.
 */
function advanceNextPlanBlock(
  blocks: import("../state.js").PlanBlock[] | undefined,
): import("../state.js").PlanBlock[] | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const idx = blocks.findIndex((b) => !b.confirmed);
  if (idx < 0) return null;
  const next = blocks.map((b, i) => (i === idx ? { ...b, confirmed: true } : b));
  return next;
}

function checkOrientationComplete(state: AgentStateType, updates: Partial<AgentStateType>): boolean {
  const merged = {
    jobTitle: updates.jobTitle ?? state.jobTitle,
    industry: updates.industry ?? state.industry,
    yearsExperience: updates.yearsExperience ?? state.yearsExperience,
    educationLevel: updates.educationLevel ?? state.educationLevel,
    sessionGoal: updates.sessionGoal ?? state.sessionGoal,
  };
  return merged.jobTitle !== null &&
    merged.industry !== null &&
    merged.yearsExperience !== null &&
    merged.educationLevel !== null &&
    merged.sessionGoal !== null;
}

function determineTransition(
  state: AgentStateType,
  fieldUpdates: Partial<AgentStateType>,
  analyzerOutput: AgentStateType["analyzerOutput"]
): { nextPhase: string | null; transitionDecision: string } {
  const phase = state.currentPhase;
  const registry = config.phaseRegistry.phases[phase];

  logOrch("[ORCHESTRATOR_DECISION]", { event: "evaluate_transition", phase, required_complete: analyzerOutput?.required_complete ?? false });

  if (!registry || registry.allowed_targets.length === 0) {
    logOrch("[PHASE_DECISION]", { decision: "continue", phase, reason: "no_allowed_targets_in_registry" });
    return { nextPhase: null, transitionDecision: "continue" };
  }

  // Check analyzer suggestion
  // CONF-005: orientation gate — fire on required_complete OR when all 5 fields are
  // already present in merged state (handles multi-turn fresh-graduate persona where
  // the LLM never sees all 5 fields in a single message and never sets required_complete).
  if (phase === "orientation" && checkOrientationComplete(state, fieldUpdates)) {
    const goal = fieldUpdates.sessionGoal ?? state.sessionGoal;
    const target = goal === "explore_options" ? "exploration_career" : "exploration_role_targeting";
    logOrch("[PHASE_DECISION]", { decision: "transition", from: phase, to: target, reason: "orientation_complete_state_check", session_goal: goal });
    return { nextPhase: target, transitionDecision: "transition" };
  }

  if (analyzerOutput?.required_complete) {
    if (phase === "orientation" && checkOrientationComplete(state, fieldUpdates)) {
      const goal = fieldUpdates.sessionGoal ?? state.sessionGoal;
      const target = goal === "explore_options" ? "exploration_career" : "exploration_role_targeting";
      logOrch("[PHASE_DECISION]", { decision: "transition", from: phase, to: target, reason: "orientation_complete", session_goal: goal });
      return { nextPhase: target, transitionDecision: "transition" };
    }

    if (phase === "exploration_career") {
      logOrch("[PHASE_DECISION]", { decision: "transition", from: phase, to: "exploration_role_targeting", reason: "exploration_career_required_complete" });
      return { nextPhase: "exploration_role_targeting", transitionDecision: "transition" };
    }

    if (phase === "exploration_role_targeting") {
      // Check 100% skill assessment + post-assessment prerequisites
      const skills = fieldUpdates.skills ?? state.skills;
      const assessed = skills.filter((s) => s.user_rating !== null).length;
      const allAssessed = skills.length > 0 && assessed === skills.length;
      const learningDone = fieldUpdates.learningNeedsComplete ?? state.learningNeedsComplete;
      const evalConfirmed = fieldUpdates.userConfirmedEvaluation ?? state.userConfirmedEvaluation;
      // Change 4 (BR-9 §4E): if a role switch is in progress and the speaker
      // has not yet delivered the rehydration recap, hold the transition one
      // extra turn so the user sees the "I've moved your ratings over" recap
      // before being asked to confirm the plan.
      const switchCtx = fieldUpdates.roleSwitchContext ?? state.roleSwitchContext;
      const switchAcked = fieldUpdates.roleSwitchAcknowledged ?? state.roleSwitchAcknowledged;
      if (switchCtx && !switchAcked) {
        logOrch("[PHASE_DECISION]", { decision: "continue", phase, reason: "role_switch_rehydration_recap_pending" });
        return { nextPhase: null, transitionDecision: "continue" };
      }
      if (allAssessed && learningDone && evalConfirmed) {
        logOrch("[PHASE_DECISION]", { decision: "transition", from: phase, to: "planning", reason: "skills_100pct_learning_done_eval_confirmed", assessed, total: skills.length });
        return { nextPhase: "planning", transitionDecision: "transition" };
      }
      logOrch("[PHASE_DECISION]", { decision: "continue", phase, reason: "prerequisites_incomplete", assessed, total: skills.length, learningDone, evalConfirmed });
    }
  }

  // Mid-session track transition: exploration_career → exploration_role_targeting
  if (phase === "exploration_career" && analyzerOutput?.phase_suggestion === "exploration_role_targeting") {
    logOrch("[PHASE_DECISION]", { decision: "transition", from: phase, to: "exploration_role_targeting", reason: "mid_session_track_switch_via_phase_suggestion" });
    return { nextPhase: "exploration_role_targeting", transitionDecision: "transition" };
  }

  // Check max turns for phase
  if (state.phaseTurnNumber >= registry.max_turns) {
    // For exploration_role_targeting, block transition unless all prerequisites met
    if (phase === "exploration_role_targeting") {
      const skills = fieldUpdates.skills ?? state.skills;
      const ratedCount = skills.filter((s) => s.user_rating !== null).length;
      const allAssessed = skills.length > 0 && ratedCount === skills.length;
      const learningDone = state.learningNeedsComplete;
      const evalConfirmed = state.userConfirmedEvaluation;
      if (!allAssessed || !learningDone || !evalConfirmed) {
        logOrch("[PHASE_DECISION]", { decision: "continue", phase, reason: "max_turns_but_prerequisites_incomplete", rated: ratedCount, total: skills.length, learningDone, evalConfirmed });
        return { nextPhase: null, transitionDecision: "continue" };
      }
    }
    const target = registry.allowed_targets[0];
    logOrch("[PHASE_DECISION]", { decision: target ? "transition" : "continue", from: phase, to: target ?? null, reason: "max_turns_reached" });
    return { nextPhase: target ?? null, transitionDecision: target ? "transition" : "continue" };
  }

  logOrch("[PHASE_DECISION]", { decision: "continue", phase, reason: "no_transition_condition_met" });
  return { nextPhase: null, transitionDecision: "continue" };
}

function determineTurnType(
  state: AgentStateType,
  nextPhase: string | null,
  transitionDecision: string
): TurnType {
  if (state.turnType === "first_turn") return "first_turn";
  if (transitionDecision === "complete") return "termination";
  if (nextPhase && nextPhase !== state.currentPhase) return "phase_transition";

  // Check for entity transitions (skill assessment)
  if (state.currentPhase === "exploration_role_targeting") {
    const skills = state.skills;
    const lastAssessed = skills.findIndex((s) => s.user_rating === null);
    if (lastAssessed > 0) return "entity_transition";
  }

  // Check for clarification
  if (state.analyzerOutput && Object.keys(state.analyzerOutput.extracted_fields).length === 0) {
    return "clarification";
  }

  return "standard";
}

export async function stateUpdater(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const updates: Partial<AgentStateType> = {
    turnNumber: state.turnNumber + 1,
    phaseTurnNumber: state.phaseTurnNumber + 1,
  };

  // Check consecutive error threshold
  if (state.consecutiveErrors >= config.maxConsecutiveErrors) {
    return {
      ...updates,
      transitionDecision: "complete",
      turnType: "termination",
    };
  }

  // Check total turn limit
  if (state.turnNumber >= config.maxTotalTurns) {
    return {
      ...updates,
      transitionDecision: "complete",
      turnType: "termination",
    };
  }

  // Merge extracted fields if analyzer ran
  let fieldUpdates: Partial<AgentStateType> = {};
  if (state.analyzerOutput && state.turnType !== "first_turn") {
    const fields = state.analyzerOutput.extracted_fields;
    const phase = state.currentPhase;

    const ao = state.analyzerOutput as unknown as Record<string, unknown>;
    const isConfirmingCue = resolveUserConfirming(state.analyzerOutput, state.userMessage);
    const isCorrectionCue = isCorrection(state.analyzerOutput);
    const isSwitchCue = isRoleSwitchSignal(state.analyzerOutput);
    logOrch("[ORCHESTRATOR_DECISION]", {
      event: "dispatch_field_merge",
      phase,
      turn_function: ao.turn_function ?? null,
      user_intent: state.analyzerOutput?.user_intent ?? null,
      requires_gate: ao.requires_orchestrator_gate ?? null,
      is_confirming: isConfirmingCue,
      is_correction: isCorrectionCue,
      is_role_switch: isSwitchCue,
      field_count: Object.keys(fields ?? {}).length,
    });

    if (phase === "orientation") fieldUpdates = mergeOrientationFields(state, fields);
    else if (phase === "exploration_career") fieldUpdates = mergeExplorationFields(state, fields);
    else if (phase === "exploration_role_targeting") fieldUpdates = mergeRoleTargetingFields(state, fields);
    else if (phase === "planning") fieldUpdates = mergePlanningFields(state, fields);

    logOrch("[STATE_WRITE]", { event: "field_merge_complete", phase, fields_written: Object.keys(fieldUpdates) });
    Object.assign(updates, fieldUpdates);
  }

  // Determine phase transition
  const { nextPhase, transitionDecision } = determineTransition(state, fieldUpdates, state.analyzerOutput);

  if (nextPhase && nextPhase !== state.currentPhase) {
    updates.previousPhase = state.currentPhase;
    updates.currentPhase = nextPhase;
    updates.phaseTurnNumber = 0;
    updates.newPhase = null;

    // Set track field
    if (nextPhase === "exploration_career") {
      updates.track = "career_exploration";
    } else if (nextPhase === "exploration_role_targeting") {
      updates.track = "role_targeting";
    }
  }

  updates.transitionDecision = transitionDecision;

  // Populate planning fields deterministically when transitioning to planning
  if (nextPhase === "planning" && state.currentPhase !== "planning") {
    const effectiveTrack = updates.track ?? state.track;
    const skills = updates.skills ?? state.skills;
    const gaps = skills.filter((s) => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    const strengths = skills.filter((s) => s.gap_category === "strong");
    const targetRole = updates.targetRole ?? state.targetRole;
    const directions = updates.candidateDirections ?? state.candidateDirections;

    // --- EXPLORE TRACK: fetch O*NET skills for all candidate directions ---
    if (effectiveTrack === "career_exploration" && directions.length > 0) {
      try {
        const roleNames = directions.map(d => d.direction_title);
        const multiSkills = await retrieveSkillsForMultipleRoles(roleNames);
        updates.candidateSkills = multiSkills;
        console.log(`[StateUpdater] Fetched skills for ${roleNames.length} candidate directions`);
      } catch (e) {
        console.warn("[StateUpdater] Multi-role skill fetch failed:", (e as Error).message);
      }

      if (!state.recommendedPath) {
        const currentRole = state.jobTitle ?? "your current background";
        const dirList = directions.map((d, i) => `${i + 1}. ${d.direction_title}`).join("; ");
        updates.recommendedPath = `Based on your ${currentRole} background and interests, we identified ${directions.length} promising career directions: ${dirList}. Each of these paths aligns with your education and professional interests, and you may find it valuable to explore them further.`;
      }
    }

    // --- SPECIFIC ROLE TRACK ---
    if (effectiveTrack === "role_targeting" && targetRole) {
      // Ensure skill_type is stamped on existing skills
      updates.skills = skills.map(s => ({
        ...s,
        skill_type: s.skill_type ?? categorizeSkillType(s.skill_name),
      }));

      if (!state.recommendedPath) {
        const currentRole = state.jobTitle ?? "your current role";
        updates.recommendedPath = `Your target role: ${targetRole}. Transitioning from ${currentRole}, you could leverage your strengths in ${
          strengths.length > 0
            ? strengths.slice(0, 3).map((s) => s.skill_name).join(", ")
            : "your existing professional experience"
        } while developing ${
          gaps.length > 0
            ? gaps.slice(0, 3).map((s) => s.skill_name).join(", ")
            : "additional role-specific skills"
        }.`;
      }
    }

    // Skill development agenda (specific role track)
    if (state.skillDevelopmentAgenda.length === 0 && skills.length > 0) {
      const absent = skills.filter((s) => s.gap_category === "absent");
      const underdeveloped = skills.filter((s) => s.gap_category === "underdeveloped");
      const agenda: string[] = [];
      for (const s of [...absent, ...underdeveloped]) {
        const ratingLabel = s.user_rating === "beginner" ? "beginner" : s.user_rating === "intermediate" ? "intermediate" : s.user_rating ?? "unrated";
        agenda.push(`Develop ${s.skill_name} (currently: ${ratingLabel}, required: ${s.required_proficiency})`);
      }
      if (agenda.length > 0) updates.skillDevelopmentAgenda = agenda;
    }

    // Immediate next steps — soft recommendation language
    if (state.immediateNextSteps.length === 0) {
      const nextSteps: string[] = [];
      if (effectiveTrack === "career_exploration" && directions.length > 0) {
        nextSteps.push(`You might consider researching job postings for ${directions[0].direction_title} to understand current market expectations`);
        nextSteps.push(`It could be helpful to connect with professionals in these fields for informational conversations`);
        nextSteps.push(`You may find it valuable to start a focused session for your top-choice role to get a detailed skill gap analysis`);
      } else if (targetRole) {
        if (gaps.length > 0) {
          nextSteps.push(`You might consider exploring learning resources for ${gaps[0].skill_name}, which appears to be the most important skill to develop for ${targetRole}`);
        }
        nextSteps.push(`It could be helpful to review current job postings for ${targetRole} to understand what employers are looking for`);
        nextSteps.push(`You may find it valuable to connect with professionals working as ${targetRole} for informational conversations`);
      }
      if (nextSteps.length > 0) updates.immediateNextSteps = nextSteps;
    }

    // Plan rationale
    if (!state.planRationale) {
      if (effectiveTrack === "career_exploration") {
        updates.planRationale = `This plan is based on exploring ${directions.length} career direction${directions.length !== 1 ? "s" : ""} aligned with your background and interests. Skills data is sourced from O*NET occupational requirements.`;
      } else {
        updates.planRationale = `This plan is based on comparing your self-assessed skills against O*NET requirements for ${targetRole ?? "your target role"}. ${gaps.length} skill gap${gaps.length !== 1 ? "s" : ""} ${gaps.length !== 1 ? "were" : "was"} identified and ${strengths.length} strength${strengths.length !== 1 ? "s" : ""} confirmed.`;
      }
    }

    const mergedKept = updates.evidenceKept ?? state.evidenceKept ?? [];
    if (mergedKept.length === 0) {
      updates.evidenceKept = [
        {
          source: "O*NET",
          detail: targetRole
            ? `Retrieved required skills and knowledge for "${targetRole}"`
            : "Retrieved occupational skill profiles for recommended directions",
          reason: "Authoritative occupation-skill linkage for gap analysis",
        },
      ];
    }

    if (!state.progressItems?.length) {
      const ns = updates.immediateNextSteps ?? state.immediateNextSteps ?? [];
      const ag = updates.skillDevelopmentAgenda ?? state.skillDevelopmentAgenda ?? [];
      const items: ProgressItem[] = [
        ...ns.map((label, i) => ({ id: `ns-${i}`, label, done: false })),
        ...ag.slice(0, 8).map((label, i) => ({ id: `ag-${i}`, label, done: false })),
      ].slice(0, 16);
      if (items.length > 0) updates.progressItems = items;
    }

    // Change 5 P0 (Apr 14 2026): seed the 5 canonical plan blocks on planning
    // entry if they aren't already populated. Previously the analyzer was
    // responsible for emitting `plan_blocks`, but its skill prompt never
    // defined that schema — so blocks were never seeded and the speaker looped
    // on "Plan Presentation Strategy" without ever advancing. See Apr 12
    // transcript. `parsePlanBlocks` (above) defines the valid id set.
    const existingBlocks = updates.planBlocks ?? state.planBlocks ?? [];
    if (existingBlocks.length === 0) {
      const seeded = seedPlanBlocks(state, updates);
      if (seeded.length > 0) updates.planBlocks = seeded;
    }
  }

  // Auto-fetch skills when in role targeting and targetRole is set but skills are empty
  const effectivePhase = updates.currentPhase ?? state.currentPhase;
  // CONF-002 (2026-05-04): when transitioning into exploration_role_targeting from
  // exploration_career, the confirmation turn ("Yes, that is the role I want to explore")
  // may not re-extract target_role (thin-reply rule), leaving state.targetRole null even
  // though the role was named in a prior turn. Fall back to the first candidateDirection
  // title if it's the only one present, as a narrowly-scoped recovery path.
  const firstCandidateRole =
    effectivePhase === "exploration_role_targeting" &&
    !updates.targetRole && !fieldUpdates.targetRole && !state.targetRole &&
    (updates.candidateDirections ?? state.candidateDirections ?? []).length === 1
      ? ((updates.candidateDirections ?? state.candidateDirections)[0]?.direction_title ?? null)
      : null;
  const effectiveRoleRaw =
    updates.targetRole ?? fieldUpdates.targetRole ?? state.targetRole ?? firstCandidateRole;
  // Change 5 P0 (Apr 14 2026): trim + require truthy before dispatching RAG.
  // A blank / whitespace role must NEVER trigger a silent cached-occupation
  // substitution (Apr 12 "Data Entry Keyer" regression).
  const effectiveRole =
    typeof effectiveRoleRaw === "string" && effectiveRoleRaw.trim()
      ? effectiveRoleRaw.trim()
      : null;
  const effectiveSkills = updates.skills ?? state.skills;

  // Raise `needsRoleConfirmation` when we are in role targeting with no
  // skills yet AND no confirmed role — the speaker reads this flag and
  // asks the user to name a role instead of fetching a random one.
  if (
    effectivePhase === "exploration_role_targeting" &&
    !effectiveRole &&
    effectiveSkills.length === 0
  ) {
    updates.needsRoleConfirmation = true;
    logOrch("[RETRIEVAL_GATE]", { decision: "blocked", reason: "no_confirmed_role", phase: effectivePhase });
  } else if (effectiveRole) {
    // Clear the flag once the user has provided a role.
    updates.needsRoleConfirmation = false;
  }

  if (
    effectivePhase === "exploration_role_targeting" &&
    effectiveRole &&
    effectiveSkills.length === 0
  ) {
    logOrch("[RETRIEVAL_GATE]", { decision: "allowed", reason: "confirmed_role_skills_empty", role: effectiveRole, phase: effectivePhase });
    // G4: dispatch via the explicit tool executor instead of inline RAG.
    // The orchestrator (this node) decides *whether* to call the tool;
    // `runTool` owns *how* it executes and surfaces Skill 8 error codes.
    const toolResult = await runTool({
      name: "retrieve_skills_for_role",
      args: { role: effectiveRole },
    });
    if (toolResult.ok && Array.isArray(toolResult.data) && toolResult.data.length > 0) {
      let freshSkills = toolResult.data as SkillAssessment[];

      // Change 4 (BR-9 §4C): if a role switch is in progress, rehydrate
      // prior ratings before persisting. Rating sources, in priority order:
      //   1. state.skills — the PRIOR role's live ratings (pivot just happened
      //      this turn; mergeRoleTargetingFields cleared `updates.skills = []`
      //      but the pre-merge snapshot still has them)
      //   2. state.candidateSkills[previousTargetRole] — any historical cache
      //      from exploration_career blend step
      // Normalization + gap recomputation is handled inside rehydrateSkillRatings.
      const switchCtx =
        updates.roleSwitchContext ?? state.roleSwitchContext ?? null;
      if (switchCtx) {
        const prevRole =
          updates.previousTargetRole ?? state.previousTargetRole ?? switchCtx.from_role;
        const ratingSources: SkillAssessment[] = [];
        if (Array.isArray(state.skills) && state.skills.length > 0) {
          ratingSources.push(...state.skills);
        }
        if (prevRole && state.candidateSkills && state.candidateSkills[prevRole]) {
          ratingSources.push(...state.candidateSkills[prevRole]);
        }
        if (ratingSources.length > 0) {
          const { skills: rehydrated, rehydrated: count, sharedNames } =
            rehydrateSkillRatings(freshSkills, ratingSources);
          freshSkills = rehydrated;
          updates.roleSwitchContext = {
            ...switchCtx,
            rehydrated_ratings: count,
            shared_skills: sharedNames,
          };
          if (count > 0) {
            console.log(
              `[StateUpdater] Rehydrated ${count} skill ratings from "${prevRole}" → "${effectiveRole}": ${sharedNames.slice(0, 5).join(", ")}${sharedNames.length > 5 ? "…" : ""}`,
            );
          }
        }
      }

      updates.skills = freshSkills;
      updates.skillsTargetRole = effectiveRole;
      console.log(`[StateUpdater] Pre-populated ${freshSkills.length} skills for "${effectiveRole}" via tool executor`);
    } else if (!toolResult.ok) {
      console.warn(`[StateUpdater] Tool ${toolResult.tool} failed: ${toolResult.errorCode ?? "unknown"} ${toolResult.detail ?? ""}`);
    }
  }

  // Update skillsAssessmentStatus
  const currentSkills = updates.skills ?? state.skills;
  const ratedSkills = currentSkills.filter((s) => s.user_rating !== null).length;
  const effectivePhaseForStatus = updates.currentPhase ?? state.currentPhase;
  if (effectivePhaseForStatus === "exploration_role_targeting" || effectivePhaseForStatus === "planning") {
    if (currentSkills.length === 0 || ratedSkills === 0) {
      updates.skillsAssessmentStatus = "not_started";
    } else if (currentSkills.length > 0 && ratedSkills === currentSkills.length) {
      updates.skillsAssessmentStatus = "complete";
    } else {
      updates.skillsAssessmentStatus = "in_progress";
    }
  }

  enforceStateInvariants(state, updates);

  // Planning phase is terminal — Change 6 (May 01 2026): guard with
  // reportGeneratedForRole so the completion signal only fires for the role
  // the report was actually generated for. If the pivot already cleared
  // updates.reportGeneratedForRole (role switch detected this same turn),
  // the role check fails and the pop-up is suppressed.
  const activeReportRole = updates.targetRole ?? state.targetRole;
  const reportComplete =
    state.currentPhase === "planning" &&
    state.reportGenerated &&
    state.reportGeneratedForRole &&
    state.reportGeneratedForRole === activeReportRole;
  logOrch("[REPORT_GATE]", {
    decision: reportComplete ? "complete" : "not_complete",
    phase: state.currentPhase,
    reportGenerated: state.reportGenerated ?? false,
    reportGeneratedForRole: state.reportGeneratedForRole ?? null,
    activeReportRole: activeReportRole ?? null,
  });
  if (reportComplete) {
    updates.transitionDecision = "complete";
  }

  // Determine turn type
  updates.turnType = determineTurnType(state, nextPhase, updates.transitionDecision ?? transitionDecision);

  // Clear error on successful processing
  if (!state.error) {
    updates.error = null;
  }

  // Slice S-F (Sr 12): safety strike tracking runs FIRST — offensive content
  // short-circuits everything else, including off-topic handling.
  if (isOffensive(state.userMessage)) {
    const next = (state.safetyStrikes ?? 0) + 1;
    updates.safetyStrikes = next;
    if (next >= MAX_SAFETY_STRIKES) {
      logAgentError(
        new AgentError("SAFETY_BLOCK", `strikes=${next}`),
        { sessionId: state.sessionId }
      );
      updates.error = "SAFETY_BLOCK";
      updates.transitionDecision = "complete"; // block further turns
    }
  }

  // Slice S-A (Sr 11 / 15B): off-topic strike tracking. Reset on any
  // productive analyzer signal; increment when the topic guard flags the
  // user's message. At the threshold, set `error = OFF_TOPIC_PERSISTENT`
  // so the Speaker can short-circuit to the catalog message. Skipped if
  // safety already fired.
  if (updates.error !== "SAFETY_BLOCK") {
    const analyzerHasSignal =
      !!state.analyzerOutput &&
      (Object.keys(state.analyzerOutput.extracted_fields ?? {}).length > 0 ||
        (state.analyzerOutput.confidence ?? 0) >= 0.5);
    if (analyzerHasSignal) {
      updates.offTopicStrikes = 0;
    } else if (isOffTopic(state.userMessage)) {
      const next = (state.offTopicStrikes ?? 0) + 1;
      updates.offTopicStrikes = next;
      if (next >= MAX_OFF_TOPIC_STRIKES) {
        logAgentError(
          new AgentError("OFF_TOPIC_PERSISTENT", `strikes=${next}`),
          { sessionId: state.sessionId }
        );
        updates.error = "OFF_TOPIC_PERSISTENT";
      }
    }
  }

  // Slice S-E (Sr 31, 32): block-by-block plan confirmation gate.
  // If plan_blocks exist and the user's last message is a confirmation,
  // advance the next unconfirmed block. The planning speaker skill is
  // responsible for surfacing only one unconfirmed block at a time.
  // Change 5 P0 (Apr 14 2026): uses `advanceNextPlanBlock` helper so the
  // same code path is reachable from mergePlanningFields tests.
  // OR-002 / CONF-001 (2026-05-03): resolveUserConfirming prefers turn_function
  // (requires referenced_prior_prompt=true for confirm), falls back to user_intent,
  // then isConfirmation() backstop. Prevents bare "ok" after a bridge statement
  // from advancing the plan block (AN-005 / Change 9 regression guard).
  const planBlockUserConfirming = resolveUserConfirming(state.analyzerOutput, state.userMessage);

  const existingBlocks = updates.planBlocks ?? state.planBlocks ?? [];
  if (state.currentPhase === "planning" && existingBlocks.length > 0) {
    const firstPending = existingBlocks.findIndex((b) => !b.confirmed);
    // CONF-004 (2026-05-04): add isConfirmation() backstop ONLY when
    // speaker-prompt-creator flagged that a block was just presented
    // (blockJustPresented=true). This prevents bare "ok" after a bridge
    // statement from advancing prematurely (AN-005 regression guard) while
    // still catching "yes"/"ok" after MANDATORY OVERRIDE block delivery when
    // Gemini misclassifies them as turn_function:"acknowledge".
    if (firstPending >= 0 && (planBlockUserConfirming || (isConfirmation(state.userMessage) && state.blockJustPresented))) {
      const advanced = advanceNextPlanBlock(existingBlocks);
      if (advanced) {
        updates.planBlocks = advanced;
        // Only let reportGenerated flip once EVERY block is confirmed.
        const allConfirmed = advanced.every((b) => b.confirmed);
        if (!allConfirmed && updates.reportGenerated) {
          updates.reportGenerated = false;
        }
      }
    } else if (firstPending >= 0 && updates.reportGenerated) {
      // Orchestrator guarantee: cannot complete plan until all blocks confirmed.
      updates.reportGenerated = false;
    }
  }

  // G5: orchestrator-approved profile / episodic hooks.
  // Guarded by `userId`; no-op (and silent) when SQLite isn't available.
  // These mirror what server.ts already does post-turn, but bring the
  // contract inside the orchestrator so any caller of the graph (smoke
  // tests, future API surfaces) gets the same behavior automatically.
  if (state.userId) {
    const finalDecision = updates.transitionDecision ?? state.transitionDecision;
    saveProfileHook({
      userId: state.userId,
      sessionId: state.sessionId,
      targetRole: updates.targetRole ?? state.targetRole,
      jobTitle: (updates as Record<string, unknown>).jobTitle as string | null | undefined ?? state.jobTitle,
      conversationSummary: state.conversationSummary || undefined,
    });
    if (finalDecision === "complete" && state.conversationSummary?.trim()) {
      appendEpisodicHook(state.userId, state.sessionId, state.conversationSummary);
    }
  }

  return updates;
}

function enforceStateInvariants(
  state: AgentStateType,
  updates: Partial<AgentStateType>,
): void {
  const activeRole = updates.targetRole ?? state.targetRole;
  const activeSkills = updates.skills ?? state.skills ?? [];
  const skillsRole = updates.skillsTargetRole ?? state.skillsTargetRole;

  if (activeSkills.length > 0 && activeRole && skillsRole && activeRole.trim().toLowerCase() !== skillsRole.trim().toLowerCase()) {
    updates.skills = [];
    updates.skillsTargetRole = null;
    updates.skillsAssessmentStatus = "not_started";
    updates.learningNeeds = [];
    updates.learningNeedsComplete = false;
    updates.skillsEvaluationSummary = null;
    updates.userConfirmedEvaluation = false;
    updates.planBlocks = [];
    updates.reportGenerated = false;
    logOrch("[STATE_WRITE]", {
      event: "state_invariant_repaired",
      invariant: "active_target_role_matches_skill_assessment",
      targetRole: activeRole,
      skillsTargetRole: skillsRole,
      action: "cleared_stale_skill_state",
    });
  }

  const phase = updates.currentPhase ?? state.currentPhase;
  const finalSkills = updates.skills ?? state.skills ?? [];
  if (phase === "planning") {
    const allRated = finalSkills.length > 0 && finalSkills.every((s) => s.user_rating !== null);
    if (!allRated) {
      updates.reportGenerated = false;
      if (!updates.currentPhase) updates.currentPhase = "exploration_role_targeting";
      updates.transitionDecision = "continue";
      logOrch("[STATE_WRITE]", {
        event: "state_invariant_repaired",
        invariant: "plan_requires_complete_skill_ratings",
        action: "blocked_report_and_reverted_phase",
      });
    }
  }
}
