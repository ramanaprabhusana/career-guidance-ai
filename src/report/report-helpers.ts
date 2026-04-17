import type { AgentStateType, SkillAssessment } from "../state.js";

/**
 * Change 5 P0 (Apr 14 2026): single source of truth for the role label shown
 * in report titles and badges. Prevents the Apr 12 drift where the PDF title
 * and the header badge disagreed on explore-track reports.
 *
 * - pursue track (`session_goal === "pursue_specific_role"`): always
 *   `state.targetRole`. Falls back to candidate direction only if targetRole
 *   is blank, which in a pursue-track session should not happen once Step 1
 *   guards are in place.
 * - explore track: prefer the top candidate direction; if none, fall back
 *   to targetRole (in case the user pivoted mid-session).
 */
export function getDisplayRole(state: AgentStateType): string | null {
  const target = typeof state.targetRole === "string" && state.targetRole.trim()
    ? state.targetRole.trim()
    : null;
  const isExplore = state.sessionGoal === "explore_options";
  if (isExplore) {
    const top = (state.candidateDirections ?? [])[0]?.direction_title;
    return (top && top.trim()) || target;
  }
  return target;
}

export interface ReadinessStats {
  totalSkills: number;
  assessedSkills: number;
  strongSkills: number;
  gapSkills: number;
  /** Percent of skills with any user_rating set — the "100%" users expect to see after assessment. */
  assessmentPct: number;
  /** Percent of skills currently rated strong — NOT the same as "tech ready". */
  strengthPct: number;
}

export interface ProximityStats {
  /** Average progress-toward-required across technical skills (0–100). */
  techProgressPct: number;
  /** Average progress-toward-required across soft skills (0–100). */
  softProgressPct: number;
  /** Average across all skills. */
  overallProgressPct: number;
}

const LEVEL_TO_ORDINAL: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
  // legacy 3-level values (Change 3 pre-cutover sessions)
  not_yet_familiar: 1,
  working_knowledge: 2,
  strong_proficiency: 3,
};

function toOrdinal(level: string | null | undefined): number {
  if (!level) return 0;
  return LEVEL_TO_ORDINAL[level.toLowerCase()] ?? 0;
}

/**
 * Progress-toward-required score. For each skill: min(userLevel / requiredLevel, 1).
 * A fresh graduate rated beginner(1) against advanced(3) scores 33% rather than
 * 0%, which prevents the "0% TECH STRENGTH" headline that reads as "you have no
 * competence" for users who are still learning. See Apr 17 2026 transcript.
 *
 * Skills with no user_rating contribute 0; skills with no required_proficiency
 * fall back to advanced(3) as the conservative expected bar.
 */
export function computeProximityStats(skills: SkillAssessment[]): ProximityStats {
  const pct = (subset: SkillAssessment[]): number => {
    if (subset.length === 0) return 0;
    let sum = 0;
    for (const s of subset) {
      const user = toOrdinal(s.user_rating);
      const req = toOrdinal(s.required_proficiency) || 3;
      const ratio = req > 0 ? Math.min(user / req, 1) : 0;
      sum += ratio;
    }
    return Math.round((sum / subset.length) * 100);
  };
  const tech = skills.filter((s) => s.skill_type === "technical");
  const soft = skills.filter((s) => s.skill_type === "soft");
  return {
    techProgressPct: pct(tech),
    softProgressPct: pct(soft),
    overallProgressPct: pct(skills),
  };
}

/**
 * Change 5 P0 (Apr 14 2026): compute assessment-completion vs current-strength
 * separately. The previous implementation called `strong / total` "Tech Ready",
 * which yielded 0% whenever the user was still learning — even after assessing
 * 100% of the list. See Apr 12 transcript.
 *
 * Callers render BOTH metrics; they are not substitutes for each other.
 */
export function computeReadinessStats(skills: SkillAssessment[]): ReadinessStats {
  const totalSkills = skills.length;
  const assessedSkills = skills.filter((s) => s.user_rating !== null).length;
  const strongSkills = skills.filter((s) => s.gap_category === "strong").length;
  const gapSkills = skills.filter(
    (s) => s.gap_category === "absent" || s.gap_category === "underdeveloped",
  ).length;
  const assessmentPct = totalSkills > 0 ? Math.round((assessedSkills / totalSkills) * 100) : 0;
  const strengthPct = totalSkills > 0 ? Math.round((strongSkills / totalSkills) * 100) : 0;
  return {
    totalSkills,
    assessedSkills,
    strongSkills,
    gapSkills,
    assessmentPct,
    strengthPct,
  };
}
