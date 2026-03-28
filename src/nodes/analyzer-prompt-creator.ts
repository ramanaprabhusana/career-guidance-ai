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
  });

  return { analyzerPrompt: prompt };
}
