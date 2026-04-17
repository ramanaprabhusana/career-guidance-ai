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
