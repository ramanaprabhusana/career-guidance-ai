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

function mergeOrientationFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};
  if (fields.job_title !== undefined) updates.jobTitle = fields.job_title as string;
  if (fields.industry !== undefined) updates.industry = fields.industry as string;
  if (fields.years_experience !== undefined) updates.yearsExperience = fields.years_experience as number;
  if (fields.education_level !== undefined) updates.educationLevel = fields.education_level as AgentStateType["educationLevel"];
  if (fields.session_goal !== undefined) updates.sessionGoal = fields.session_goal as AgentStateType["sessionGoal"];
  if (fields.location !== undefined) updates.location = fields.location as string;
  if (fields.preferred_timeline !== undefined) updates.preferredTimeline = fields.preferred_timeline as string;
  // Also capture target_role if mentioned during orientation
  if (fields.target_role !== undefined) updates.targetRole = fields.target_role as string;
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
  // Capture target_role when user picks a specific role during exploration
  if (fields.target_role !== undefined) updates.targetRole = fields.target_role as string;
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

  updates.targetRole = incomingRole;

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
    };
    updates.priorPlan = snapshot;
  }

  // Deprioritize the prior role in history.
  const historyEntry: RoleHistoryEntry = {
    role_name: currentRole!,
    status: "deprioritized",
    first_seen_at: Date.now(),
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
  }
}

function mergeRoleTargetingFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};

  if (fields.target_role !== undefined) {
    applyRoleSwitchPivot(state, updates, fields.target_role as string, false);
  }

  // Merge skill ratings
  if (fields.skills) {
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
  if (fields.learning_needs !== undefined && Array.isArray(fields.learning_needs)) {
    updates.learningNeeds = fields.learning_needs as string[];
  }
  if (fields.learning_needs_complete === true) {
    updates.learningNeedsComplete = true;
  }
  if (fields.skills_evaluation_summary !== undefined) {
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
  if (
    updates.learningNeedsComplete !== true &&
    !state.learningNeedsComplete &&
    learningNeedsCurrent.length > 0 &&
    (priorityFieldExtracted || state.learningNeeds.length > 0) &&
    isConfirmation(state.userMessage)
  ) {
    updates.learningNeedsComplete = true;
  }
  // Same fallback for userConfirmedEvaluation: if the summary was presented
  // last turn and the user just said "yes / looks right / accurate", flip it.
  if (
    updates.userConfirmedEvaluation !== true &&
    !state.userConfirmedEvaluation &&
    state.skillsEvaluationSummary &&
    isConfirmation(state.userMessage)
  ) {
    updates.userConfirmedEvaluation = true;
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
  if (fields.target_role !== undefined) {
    applyRoleSwitchPivot(state, updates, fields.target_role as string, true);
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

  if (!registry || registry.allowed_targets.length === 0) {
    return { nextPhase: null, transitionDecision: "continue" };
  }

  // Check analyzer suggestion
  if (analyzerOutput?.required_complete) {
    if (phase === "orientation" && checkOrientationComplete(state, fieldUpdates)) {
      const goal = fieldUpdates.sessionGoal ?? state.sessionGoal;
      const target = goal === "explore_options" ? "exploration_career" : "exploration_role_targeting";
      return { nextPhase: target, transitionDecision: "transition" };
    }

    if (phase === "exploration_career") {
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
        return { nextPhase: null, transitionDecision: "continue" };
      }
      if (allAssessed && learningDone && evalConfirmed) {
        return { nextPhase: "planning", transitionDecision: "transition" };
      }
    }
  }

  // Mid-session track transition: exploration_career → exploration_role_targeting
  if (phase === "exploration_career" && analyzerOutput?.phase_suggestion === "exploration_role_targeting") {
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
        return { nextPhase: null, transitionDecision: "continue" };
      }
    }
    const target = registry.allowed_targets[0];
    return { nextPhase: target ?? null, transitionDecision: target ? "transition" : "continue" };
  }

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

    if (phase === "orientation") fieldUpdates = mergeOrientationFields(state, fields);
    else if (phase === "exploration_career") fieldUpdates = mergeExplorationFields(state, fields);
    else if (phase === "exploration_role_targeting") fieldUpdates = mergeRoleTargetingFields(state, fields);
    else if (phase === "planning") fieldUpdates = mergePlanningFields(state, fields);

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
  }

  // Auto-fetch skills when in role targeting and targetRole is set but skills are empty
  const effectivePhase = updates.currentPhase ?? state.currentPhase;
  const effectiveRole = updates.targetRole ?? fieldUpdates.targetRole ?? state.targetRole;
  const effectiveSkills = updates.skills ?? state.skills;
  if (
    effectivePhase === "exploration_role_targeting" &&
    effectiveRole &&
    effectiveSkills.length === 0
  ) {
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

  // Planning phase is terminal
  if (state.currentPhase === "planning" && state.reportGenerated) {
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
  // mark the first unconfirmed block as confirmed. The planning speaker
  // skill is responsible for surfacing only one unconfirmed block at a time.
  const existingBlocks = updates.planBlocks ?? state.planBlocks ?? [];
  if (state.currentPhase === "planning" && existingBlocks.length > 0) {
    const firstPending = existingBlocks.findIndex((b) => !b.confirmed);
    if (firstPending >= 0 && isConfirmation(state.userMessage)) {
      const next = existingBlocks.map((b, i) =>
        i === firstPending ? { ...b, confirmed: true } : b
      );
      updates.planBlocks = next;
      // Only let reportGenerated flip once EVERY block is confirmed.
      const allConfirmed = next.every((b) => b.confirmed);
      if (!allConfirmed && updates.reportGenerated) {
        updates.reportGenerated = false;
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
