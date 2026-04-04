import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { AgentStateType } from "../state.js";
import { config } from "../config.js";

/** Versioned evidence pack for exports and compliance (JSON). */
export interface EvidencePackV1 {
  schema_version: "1.0";
  generated_at: string;
  session_id: string;
  user_id: string | null;
  assumptions: string[];
  profile: {
    job_title: string | null;
    industry: string | null;
    years_experience: number | null;
    education_level: string | null;
    location: string | null;
    preferred_timeline: string | null;
  };
  session_goal: string | null;
  target_role: string | null;
  candidate_directions: AgentStateType["candidateDirections"];
  skills_summary: {
    total: number;
    strong: number;
    gaps: number;
    items: Array<{
      skill_name: string;
      skill_type: string;
      gap_category: string | null;
      user_rating: string | null;
    }>;
  };
  recommended_path: string | null;
  plan_rationale: string | null;
  timeline: string | null;
  skill_development_agenda: string[];
  immediate_next_steps: string[];
  learning_resources: Array<{ title: string; url: string; note?: string }>;
  retrieval_log: {
    kept: Array<{ source: string; detail: string; reason: string }>;
    discarded: Array<{ source: string; detail: string; reason: string }>;
    notes: string[];
  };
  progress_items: Array<{ id: string; label: string; done: boolean }>;
  conversation_summary: string;
  data_sources: string[];
  phase: string;
  report_generated: boolean;
  phase_display: string;
}

export function buildEvidencePack(state: AgentStateType): EvidencePackV1 {
  const skills = state.skills ?? [];
  const strong = skills.filter((s) => s.gap_category === "strong").length;
  const gaps = skills.filter((s) => s.gap_category === "absent" || s.gap_category === "underdeveloped").length;

  const assumptions = [
    "Skill requirements are derived from O*NET occupational data and may not reflect every employer.",
    "Self-assessed ratings are subjective; use the report as one input among many.",
    "Wage and job counts depend on API availability and geographic coverage.",
  ];

  const notes: string[] = [
    "Retrieval uses embedding similarity over a local occupation index (FAISS) when enabled.",
    "BLS and USAJOBS enrichments are included when API keys are configured.",
  ];

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    session_id: state.sessionId,
    user_id: state.userId ?? null,
    assumptions,
    profile: {
      job_title: state.jobTitle,
      industry: state.industry,
      years_experience: state.yearsExperience,
      education_level: state.educationLevel,
      location: state.location ?? null,
      preferred_timeline: state.preferredTimeline ?? null,
    },
    session_goal: state.sessionGoal,
    target_role: state.targetRole,
    candidate_directions: state.candidateDirections ?? [],
    skills_summary: {
      total: skills.length,
      strong,
      gaps,
      items: skills.map((s) => ({
        skill_name: s.skill_name,
        skill_type: s.skill_type,
        gap_category: s.gap_category,
        user_rating: s.user_rating,
      })),
    },
    recommended_path: state.recommendedPath,
    plan_rationale: state.planRationale,
    timeline: state.timeline,
    skill_development_agenda: state.skillDevelopmentAgenda ?? [],
    immediate_next_steps: state.immediateNextSteps ?? [],
    learning_resources: (state.learningResources ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      note: r.note,
    })),
    retrieval_log: {
      kept: (state.evidenceKept ?? []).map((e) => ({
        source: e.source,
        detail: e.detail,
        reason: e.reason,
      })),
      discarded: (state.evidenceDiscarded ?? []).map((e) => ({
        source: e.source,
        detail: e.detail,
        reason: e.reason,
      })),
      notes,
    },
    progress_items: (state.progressItems ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      done: p.done,
    })),
    conversation_summary: state.conversationSummary ?? "",
    data_sources: ["O*NET", "BLS OEWS", "USAJOBS"],
    phase: state.currentPhase,
    report_generated: state.reportGenerated,
    phase_display: config.phaseRegistry.phases[state.currentPhase]?.display_name ?? state.currentPhase,
  };
}

export function writeEvidencePackFile(rootDir: string, state: AgentStateType): string {
  const exportsDir = join(rootDir, "exports");
  mkdirSync(exportsDir, { recursive: true });
  const pack = buildEvidencePack(state);
  const path = join(exportsDir, `evidence-pack-${state.sessionId}.json`);
  writeFileSync(path, JSON.stringify(pack, null, 2), "utf-8");
  return path;
}
