import type { AgentStateType, TurnType, SkillAssessment, GapCategory, UserRating } from "../state.js";
import { config } from "../config.js";
import { retrieveSkillsForRole } from "../utils/rag.js";

function deriveGapCategory(userRating: UserRating | null, requiredProficiency: string): GapCategory | null {
  if (!userRating) return null;
  if (userRating === "not_yet_familiar") return "absent";
  if (userRating === "working_knowledge") {
    // If high proficiency required, it's underdeveloped
    const highRequired = ["expert", "advanced", "high", "extensive"].some(
      (w) => requiredProficiency.toLowerCase().includes(w)
    );
    return highRequired ? "underdeveloped" : "strong";
  }
  return "strong"; // strong_proficiency
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
    updates.candidateDirections = [
      ...state.candidateDirections,
      ...(fields.candidate_directions as AgentStateType["candidateDirections"]),
    ];
  }
  return updates;
}

function mergeRoleTargetingFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};
  if (fields.target_role !== undefined) updates.targetRole = fields.target_role as string;

  // Merge skill ratings
  if (fields.skills) {
    const incomingSkills = fields.skills as Record<string, unknown>[];
    const updatedSkills = [...state.skills];

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

  return updates;
}

function mergePlanningFields(
  state: AgentStateType,
  fields: Record<string, unknown>
): Partial<AgentStateType> {
  const updates: Partial<AgentStateType> = {};
  if (fields.timeline !== undefined) updates.timeline = fields.timeline as string;
  if (fields.recommended_path !== undefined) updates.recommendedPath = fields.recommended_path as string;
  if (fields.skill_development_agenda !== undefined) updates.skillDevelopmentAgenda = fields.skill_development_agenda as string[];
  if (fields.immediate_next_steps !== undefined) updates.immediateNextSteps = fields.immediate_next_steps as string[];
  if (fields.plan_rationale !== undefined) updates.planRationale = fields.plan_rationale as string;
  if (fields.report_generated !== undefined) updates.reportGenerated = fields.report_generated as boolean;
  return updates;
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
      return { nextPhase: "planning", transitionDecision: "transition" };
    }

    if (phase === "exploration_role_targeting") {
      // Check 60% skill assessment threshold
      const skills = fieldUpdates.skills ?? state.skills;
      const assessed = skills.filter((s) => s.user_rating !== null).length;
      if (skills.length > 0 && assessed / skills.length >= 0.6) {
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

  // Auto-fetch skills when in role targeting and targetRole is set but skills are empty
  const effectivePhase = updates.currentPhase ?? state.currentPhase;
  const effectiveRole = updates.targetRole ?? fieldUpdates.targetRole ?? state.targetRole;
  const effectiveSkills = updates.skills ?? state.skills;
  if (
    effectivePhase === "exploration_role_targeting" &&
    effectiveRole &&
    effectiveSkills.length === 0
  ) {
    try {
      const skills = await retrieveSkillsForRole(effectiveRole);
      if (skills.length > 0) {
        updates.skills = skills;
        console.log(`[StateUpdater] Pre-populated ${skills.length} skills for "${effectiveRole}"`);
      }
    } catch (e) {
      console.warn("[StateUpdater] Skill retrieval failed:", (e as Error).message);
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

  return updates;
}
