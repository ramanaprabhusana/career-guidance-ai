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
    },
    planning: {
      recommended_path: state.recommendedPath,
      timeline: state.timeline,
      skill_development_agenda: state.skillDevelopmentAgenda,
      immediate_next_steps: state.immediateNextSteps,
      plan_rationale: state.planRationale,
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
    return {
      speakerPrompt: "",
      speakerOutput: config.fallbackMessages.first_turn,
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

  const prompt = populateTemplate(template, {
    active_phase_name: state.currentPhase,
    active_phase_speaker_md: speakerSkill,
    phase_collected_data: formatCollectedData(collectedData),
    phase_missing_required: missing_required,
    phase_missing_optional: missing_optional,
    cross_phase_context: getCrossPhaseContext(state),
    turn_type: state.turnType,
    turn_type_instructions: getTurnTypeInstructions(state.turnType),
    last_user_message: state.userMessage || "(no message)",
    clarification_needed: clarificationNeeded,
    conversation_summary: getConversationSummary(state.conversationSummary),
    recent_turns: getRecentTurns(state.conversationHistory),
  });

  return { speakerPrompt: prompt };
}
