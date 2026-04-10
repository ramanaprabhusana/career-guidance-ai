import type { AgentStateType } from "../state.js";
import { config } from "../config.js";
import { loadSkillFile, loadPromptTemplate, populateTemplate } from "../utils/prompt-loader.js";
import { getRecentTurns, getConversationSummary, formatCollectedData, formatMissingFields } from "../utils/history-manager.js";

function getPhaseCollectedData(state: AgentStateType): Record<string, unknown> {
  const phase = state.currentPhase;

  const fieldMap: Record<string, Record<string, unknown>> = {
    orientation: {
      job_title: state.jobTitle,
      industry: state.industry,
      years_experience: state.yearsExperience,
      education_level: state.educationLevel,
      session_goal: state.sessionGoal,
    },
    exploration_career: {
      interests: state.interests,
      constraints: state.constraints,
      candidate_directions: state.candidateDirections,
    },
    exploration_role_targeting: {
      target_role: state.targetRole,
      skills: state.skills,
      learning_needs: state.learningNeeds,
      learning_needs_complete: state.learningNeedsComplete,
      skills_evaluation_summary: state.skillsEvaluationSummary,
      user_confirmed_evaluation: state.userConfirmedEvaluation,
    },
    planning: {
      recommended_path: state.recommendedPath,
      timeline: state.timeline,
      skill_development_agenda: state.skillDevelopmentAgenda,
      immediate_next_steps: state.immediateNextSteps,
      plan_rationale: state.planRationale,
      shift_intent: state.shiftIntent,
      plan_blocks: state.planBlocks,
    },
  };

  return fieldMap[phase] ?? {};
}

function getCrossPhaseContext(state: AgentStateType): string {
  const lines: string[] = [];

  if (state.currentPhase !== "orientation") {
    if (state.jobTitle) lines.push(`Job title: ${state.jobTitle}`);
    if (state.industry) lines.push(`Industry: ${state.industry}`);
    if (state.yearsExperience !== null) lines.push(`Experience: ${state.yearsExperience} years`);
    if (state.educationLevel) lines.push(`Education: ${state.educationLevel}`);
  }

  if (state.currentPhase === "exploration_role_targeting" || state.currentPhase === "planning") {
    if (state.interests.length > 0) lines.push(`Interests: ${state.interests.join(", ")}`);
    if (state.constraints.length > 0) lines.push(`Constraints: ${state.constraints.join(", ")}`);
  }

  if (state.currentPhase === "planning") {
    if (state.targetRole) lines.push(`Target role: ${state.targetRole}`);
    const gaps = state.skills.filter((s) => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    if (gaps.length > 0) {
      lines.push(`Skills to develop: ${gaps.map((s) => `${s.skill_name} (${s.gap_category})`).join(", ")}`);
    }
    const strengths = state.skills.filter((s) => s.gap_category === "strong");
    if (strengths.length > 0) {
      lines.push(`Strong skills: ${strengths.map((s) => s.skill_name).join(", ")}`);
    }
    // Change 3: prerequisite status for planning phase
    const totalSkills = state.skills.length;
    const ratedSkills = state.skills.filter(s => s.user_rating !== null).length;
    lines.push(`Skills assessment: ${ratedSkills}/${totalSkills} rated`);
    lines.push(`Evaluation confirmed: ${state.userConfirmedEvaluation ? "yes" : "no"}`);
    lines.push(`Learning needs discussed: ${state.learningNeedsComplete ? "yes" : "no"}`);
    if (state.learningNeeds.length > 0) {
      lines.push(`Priority learning areas: ${state.learningNeeds.join(", ")}`);
    }
    // C2: surface shift_intent and the next unconfirmed plan block so the
    // planning speaker can actually branch on them (previously the orchestrator
    // tracked both but the speaker never saw them).
    if (state.shiftIntent) {
      lines.push(
        "Career shift variant: ACTIVE — lead with an honest financial/emotional caveat, then re-evaluate which prior experience transfers, THEN present the standard plan blocks."
      );
    }
    if (Array.isArray(state.planBlocks) && state.planBlocks.length > 0) {
      const nextBlock = state.planBlocks.find((b) => !b.confirmed) ?? null;
      const totalConfirmed = state.planBlocks.filter((b) => b.confirmed).length;
      lines.push(`Plan block progress: ${totalConfirmed}/${state.planBlocks.length} confirmed`);
      if (nextBlock) {
        lines.push(
          `Next plan block to present: [${nextBlock.id}] ${nextBlock.label} — ${nextBlock.content}`
        );
        lines.push(
          "Present ONLY this block this turn. End by asking the user to confirm or adjust it before moving on."
        );
      } else {
        lines.push(
          "All plan blocks confirmed — offer the export / PDF report as the final step."
        );
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(no cross-phase context)";
}

function getTurnTypeInstructions(turnType: string): string {
  const instructions: Record<string, string> = {
    first_turn: "This is the very first turn. Deliver the opening message for this phase.",
    standard: "Continue the conversation naturally. Acknowledge new information and ask the next question.",
    phase_transition: "The conversation is moving to a new phase. Smoothly transition without naming phases.",
    clarification: "The last response was unclear or off-topic. Ask for clarification naturally.",
    entity_transition: "Moving to the next skill for assessment. Acknowledge the previous rating and present the next skill.",
    termination: "The conversation is ending. Provide a warm closing with key takeaways.",
  };
  return instructions[turnType] ?? instructions.standard;
}

export function speakerPromptCreator(state: AgentStateType): Partial<AgentStateType> {
  // Use fallback for first turn
  if (state.turnType === "first_turn") {
    // Slice S-B (Sr 17, 20): if a returning user is detected (profile hook
    // loaded data during session init), prepend a "Welcome back" line and a
    // 1-2 sentence summary of the last session before the standard opener.
    const opener = config.fallbackMessages.first_turn;
    if (state.isReturningUser) {
      const priorSummary = (state.priorSessionSummary ?? "").trim();
      const roleNote = state.targetRole ? ` We last discussed your interest in ${state.targetRole}.` : "";
      // C3: if we have multi-session episodic memory, lead with the most
      // recent episodic summary (short) and note how many earlier sessions
      // we also have on file. Fall back to the single priorSessionSummary.
      const episodic = (state.priorEpisodicSummaries ?? []).filter((s) => s && s.trim().length > 0);
      let summaryLine = "";
      if (episodic.length > 0) {
        const mostRecent = episodic[0].trim();
        const extra = episodic.length > 1 ? ` (plus ${episodic.length - 1} earlier session${episodic.length - 1 === 1 ? "" : "s"} on file)` : "";
        summaryLine = ` Here's a quick recap of our most recent session${extra}:\n${mostRecent}\n`;
      } else if (priorSummary) {
        summaryLine = ` Here's a quick recap of where we left off:\n${priorSummary}\n`;
      }
      const resumePrompt = " Would you like to resume from that point, or start a fresh conversation?";
      const welcome = `Welcome back!${roleNote}${summaryLine}${resumePrompt}`;
      return {
        speakerPrompt: "",
        speakerOutput: welcome,
      };
    }
    return {
      speakerPrompt: "",
      speakerOutput: opener,
    };
  }

  const template = loadPromptTemplate("speaker_template.md");
  const speakerSkill = loadSkillFile(state.currentPhase, "speaker.md");
  const collectedData = getPhaseCollectedData(state);
  const schemaFields = config.stateSchema.phases[state.currentPhase] ?? {};
  const { missing_required, missing_optional } = formatMissingFields(
    schemaFields as Record<string, { required?: boolean }>,
    collectedData
  );

  const clarificationNeeded = state.analyzerOutput?.notes &&
    Object.keys(state.analyzerOutput.extracted_fields).length === 0
    ? state.analyzerOutput.notes
    : "(none)";

  // Add urgency context when approaching max turns with incomplete skills
  let additionalContext = "";
  if (state.currentPhase === "exploration_role_targeting") {
    const maxTurns = config.phaseRegistry.phases["exploration_role_targeting"]?.max_turns ?? 20;
    if (state.phaseTurnNumber >= maxTurns - 2) {
      const skills = state.skills;
      const rated = skills.filter((s) => s.user_rating !== null).length;
      if (skills.length === 0) {
        additionalContext = "\nIMPORTANT: The skills assessment has not started because no target role has been set. Guide the user to name a specific role so skills can be loaded.";
      } else if (rated === 0) {
        additionalContext = "\nIMPORTANT: Skills have been loaded but none have been rated yet. Focus on getting the user to rate at least a few skills before we can build their career plan.";
      } else if (rated < skills.length) {
        additionalContext = `\nIMPORTANT: Only ${rated} of ${skills.length} skills have been assessed (need 100%). Encourage the user to assess the remaining skills so we can build an accurate plan.`;
      }
    }
  }

  const prompt = populateTemplate(template, {
    active_phase_name: state.currentPhase,
    active_phase_speaker_md: speakerSkill,
    phase_collected_data: formatCollectedData(collectedData),
    phase_missing_required: missing_required,
    phase_missing_optional: missing_optional,
    cross_phase_context: getCrossPhaseContext(state) + additionalContext,
    turn_type: state.turnType,
    turn_type_instructions: getTurnTypeInstructions(state.turnType),
    last_user_message: state.userMessage || "(no message)",
    clarification_needed: clarificationNeeded,
    conversation_summary: getConversationSummary(state.conversationSummary),
    recent_turns: getRecentTurns(state.conversationHistory),
  });

  return { speakerPrompt: prompt };
}
