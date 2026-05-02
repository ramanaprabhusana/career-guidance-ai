import type { AgentStateType } from "../state.js";
import { config } from "../config.js";
import { loadSkillFile, loadPromptTemplate, populateTemplate } from "../utils/prompt-loader.js";
import { getRecentTurns, getConversationSummary } from "../utils/history-manager.js";

let cachedRegistrySummary: string | null = null;

function getPhaseRegistrySummary(): string {
  if (cachedRegistrySummary) return cachedRegistrySummary;

  const phases = config.phaseRegistry.phases;
  const lines: string[] = [];
  for (const [name, phase] of Object.entries(phases)) {
    lines.push(`- ${name} (${phase.display_name}): ${phase.purpose} → [${phase.allowed_targets.join(", ")}]`);
  }
  cachedRegistrySummary = lines.join("\n");
  return cachedRegistrySummary;
}

function getPhaseStateJSON(state: AgentStateType): string {
  const phase = state.currentPhase;
  const fieldMap: Record<string, Record<string, unknown>> = {
    orientation: {
      job_title: state.jobTitle,
      industry: state.industry,
      years_experience: state.yearsExperience,
      education_level: state.educationLevel,
      session_goal: state.sessionGoal,
      target_role: state.targetRole,
    },
    exploration_career: {
      track: state.track,
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
      report_generated: state.reportGenerated,
    },
  };

  return JSON.stringify(fieldMap[phase] ?? {}, null, 2);
}

// Change 7 (May 01 2026): build the confirmed-fields block injected into the
// analyzer template so the LLM knows which fields are already locked and
// should not be re-extracted (unless the user is explicitly correcting them).
function getConfirmedFieldsBlock(state: AgentStateType): string {
  const lines: string[] = [];
  if (state.jobTitle)        lines.push(`- job_title: "${state.jobTitle}"`);
  if (state.industry)        lines.push(`- industry: "${state.industry}"`);
  if (state.yearsExperience != null) lines.push(`- years_experience: ${state.yearsExperience}`);
  if (state.educationLevel)  lines.push(`- education_level: "${state.educationLevel}"`);
  if (state.sessionGoal)     lines.push(`- session_goal: "${state.sessionGoal}"`);
  if (state.targetRole)      lines.push(`- target_role: "${state.targetRole}" (CONFIRMED — do not re-extract unless user says a different role)`);
  if (state.location)        lines.push(`- location: "${state.location}"`);
  if (state.preferredTimeline) lines.push(`- preferred_timeline: "${state.preferredTimeline}"`);
  if (state.userConfirmedEvaluation && state.skillsAssessmentStatus === "complete") {
    lines.push(`- skills: ALL ${state.skills.length} skills rated and evaluation confirmed — do not re-extract individual ratings`);
  }
  if (!lines.length) return "(no fields confirmed yet — extract freely)";
  return lines.join("\n");
}

export function analyzerPromptCreator(state: AgentStateType): Partial<AgentStateType> {
  // Skip analyzer on first turn
  if (state.turnType === "first_turn") {
    return {
      analyzerPrompt: "",
      analyzerOutput: null,
    };
  }

  const template = loadPromptTemplate("analyzer_template.md");
  const analyzerSkill = loadSkillFile(state.currentPhase, "analyzer.md");

  const prompt = populateTemplate(template, {
    active_phase_name: state.currentPhase,
    active_phase_state_json: getPhaseStateJSON(state),
    active_phase_analyzer_md: analyzerSkill,
    phase_registry_summary: getPhaseRegistrySummary(),
    user_message: state.userMessage,
    conversation_summary: getConversationSummary(state.conversationSummary),
    recent_turns: getRecentTurns(state.conversationHistory),
    confirmed_fields: getConfirmedFieldsBlock(state),
  });

  return { analyzerPrompt: prompt };
}
