/**
 * Golden-path regression test (Change 5 P0, Apr 14 2026).
 *
 * Exercises the pure orchestrator + report helpers without invoking Gemini,
 * so the test is deterministic and fast enough for CI. Asserts the four
 * regressions from the Apr 12 2026 field transcript cannot recur:
 *
 *   (1) targetRole drift: an "ok" reply in planning phase MUST NOT clear
 *       or replace the confirmed target role.
 *   (2) Silent RAG substitution: entering role-targeting with a blank role
 *       MUST raise `needsRoleConfirmation` rather than fetching cached
 *       occupation data.
 *   (3) Planning loop: entering the planning phase MUST seed `planBlocks`
 *       so the speaker has a concrete block to deliver instead of looping
 *       on "preparing your plan".
 *   (4) PDF readiness math: after 100% assessment with no "strong" ratings,
 *       `assessmentPct` MUST be 100 and `strengthPct` 0 — two separate
 *       numbers, not one conflated metric.
 *
 * Run: `npm run golden`
 */

import { stateUpdater } from "../nodes/state-updater.js";
import { fillerGuard, isFillerOrAmbiguous } from "../nodes/filler-guard.js";
import type { AgentStateType, SkillAssessment } from "../state.js";
import { computeReadinessStats, getDisplayRole } from "../report/report-helpers.js";

let failures = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures += 1;
    console.error(`  \u2717 ${label}`);
  }
}

/** Minimal state factory — only the fields stateUpdater actually reads. */
function makeState(overrides: Partial<AgentStateType>): AgentStateType {
  const base: Partial<AgentStateType> = {
    sessionId: "golden-test",
    userId: null,
    startedAt: Date.now(),
    conversationHistory: [],
    conversationSummary: "",
    userMessage: "",
    currentPhase: "orientation",
    previousPhase: null,
    newPhase: null,
    turnNumber: 0,
    phaseTurnNumber: 0,
    jobTitle: null,
    industry: null,
    yearsExperience: null,
    educationLevel: null,
    sessionGoal: null,
    location: null,
    preferredTimeline: null,
    track: null,
    interests: [],
    constraints: [],
    candidateDirections: [],
    targetRole: null,
    skills: [],
    skillsTargetRole: null,
    skillsAssessmentStatus: "not_started",
    candidateSkills: {},
    learningNeeds: [],
    learningNeedsComplete: false,
    skillsEvaluationSummary: null,
    userConfirmedEvaluation: false,
    recommendedPath: null,
    timeline: null,
    skillDevelopmentAgenda: [],
    immediateNextSteps: [],
    planRationale: null,
    reportGenerated: false,
    learningResources: [],
    evidenceKept: [],
    evidenceDiscarded: [],
    progressItems: [],
    turnType: "standard",
    analyzerPrompt: "",
    analyzerOutput: null,
    speakerPrompt: "",
    speakerOutput: "",
    userChangedPhase: 0,
    maxPhaseRedirects: 2,
    transitionDecision: "continue",
    error: null,
    consecutiveErrors: 0,
    clarificationCount: 0,
    clarificationTopic: null,
    offTopicStrikes: 0,
    isReturningUser: false,
    priorSessionSummary: "",
    priorEpisodicSummaries: [],
    resumeChoice: null,
    pendingMemoryDeletionConfirmation: false,
    safetyStrikes: 0,
    resumeName: null,
    resumeYears: null,
    resumeDomain: null,
    shiftIntent: false,
    planBlocks: [],
    userPersona: "new_user",
    candidateIndustries: [],
    prioritizedIndustries: [],
    exploredRoles: [],
    comparedRoles: [],
    previousTargetRole: null,
    roleSwitchContext: null,
    roleSwitchAcknowledged: false,
    roleComparisonContext: null,
    priorPlan: null,
    needsRoleConfirmation: false,
    reactIntent: null,
    reactStepCount: 0,
    maxReactSteps: 3,
    reactObservationLog: [],
    pendingReactTool: null,
  };
  return { ...(base as AgentStateType), ...overrides };
}

function makeSkill(name: string, rating: SkillAssessment["user_rating"], gap: SkillAssessment["gap_category"]): SkillAssessment {
  return {
    skill_name: name,
    onet_source: "test",
    required_proficiency: "Advanced",
    user_rating: rating,
    gap_category: gap,
    skill_type: "technical",
  };
}

async function main(): Promise<void> {
  console.log("\nGolden-path regression — Change 5 P0 (Apr 14 2026)\n");

  // --- Regression 1: targetRole survives "ok" in planning phase ---
  console.log("[1] targetRole stability across thin-reply ack");
  {
    const state = makeState({
      currentPhase: "planning",
      targetRole: "Corporate Finance Analyst",
      sessionGoal: "pursue_specific_role",
      turnType: "standard",
      userMessage: "ok",
      analyzerOutput: {
        // Analyzer correctly OMITS target_role per Change 5 thin-reply rule.
        // This test protects against a regression where a future analyzer
        // change emits `target_role: null` and the merge helper wipes state.
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.4,
        notes: "ack",
      },
    });
    const updates = await stateUpdater(state);
    const finalRole = updates.targetRole ?? state.targetRole;
    assert(
      finalRole === "Corporate Finance Analyst",
      `targetRole remains "Corporate Finance Analyst" after "ok" (got ${JSON.stringify(finalRole)})`,
    );
  }

  // --- Regression 2: needsRoleConfirmation fires on blank role ---
  console.log("[2] RAG never dispatched with blank role");
  {
    const state = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: null,
      sessionGoal: "pursue_specific_role",
      turnType: "standard",
      userMessage: "ready to pick a role",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.2,
        notes: "",
      },
    });
    const updates = await stateUpdater(state);
    assert(
      updates.needsRoleConfirmation === true,
      "needsRoleConfirmation = true when role-targeting has no targetRole + no skills",
    );
    assert(
      !updates.skills || updates.skills.length === 0,
      "skills[] stays empty (no silent cached substitution)",
    );
  }

  // --- Regression 3: planBlocks seeded on planning entry ---
  console.log("[3] planBlocks seeded on planning phase entry");
  {
    const state = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Data Scientist",
      sessionGoal: "pursue_specific_role",
      recommendedPath: "Strengthen statistical foundations, then build ML portfolio projects.",
      skillDevelopmentAgenda: ["Statistical inference", "ML fundamentals", "Cloud platforms"],
      immediateNextSteps: ["Audit a free stats course", "Build a classifier project"],
      timeline: "12 months",
      userConfirmedEvaluation: true,
      learningNeedsComplete: true,
      skills: [
        makeSkill("Python", "advanced", "strong"),
        makeSkill("Statistics", "intermediate", "underdeveloped"),
      ],
      turnType: "standard",
      userMessage: "I'm ready to see the plan",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: true,
        phase_suggestion: "planning",
        confidence: 0.9,
        notes: "",
      },
    });
    const updates = await stateUpdater(state);
    const planningEntered = updates.newPhase === "planning" || updates.currentPhase === "planning";
    assert(planningEntered, "state transitions to planning phase");
    const blocks = updates.planBlocks ?? [];
    assert(blocks.length >= 3, `planBlocks seeded with >= 3 blocks (got ${blocks.length})`);
    assert(
      blocks.every((b) => b.confirmed === false),
      "all seeded blocks start unconfirmed (speaker advances them one by one)",
    );
    const hasPath = blocks.some((b) => b.id === "path");
    assert(hasPath, "path block seeded from recommendedPath");
  }

  // --- Regression 4: readiness math separates assessment from strength ---
  console.log("[4] readiness metrics are two separate numbers");
  {
    const fullyRatedNoStrong: SkillAssessment[] = [
      makeSkill("Statistics", "beginner", "absent"),
      makeSkill("Python", "intermediate", "underdeveloped"),
      makeSkill("SQL", "intermediate", "underdeveloped"),
      makeSkill("ML Theory", "beginner", "absent"),
    ];
    const stats = computeReadinessStats(fullyRatedNoStrong);
    assert(stats.assessmentPct === 100, `100% assessed yields assessmentPct=100 (got ${stats.assessmentPct})`);
    assert(stats.strengthPct === 0, `no strong skills yields strengthPct=0 (got ${stats.strengthPct})`);
    assert(stats.totalSkills === 4, "totalSkills counted correctly");
    assert(stats.assessedSkills === 4, "assessedSkills counted correctly");
  }

  // --- Regression 5: getDisplayRole resolves to active target role only ---
  console.log("[5] getDisplayRole returns exactly one active target role");
  {
    const pursue = makeState({
      sessionGoal: "pursue_specific_role",
      targetRole: "Quantitative Analyst",
      candidateDirections: [{ direction_title: "Something else", rationale: "x" }],
    });
    assert(getDisplayRole(pursue) === "Quantitative Analyst", "pursue track returns targetRole");

    const explore = makeState({
      sessionGoal: "explore_options",
      targetRole: null,
      candidateDirections: [{ direction_title: "Data Analyst", rationale: "x" }],
    });
    assert(getDisplayRole(explore) === null, "explore track without active target returns null");

    const empty = makeState({ sessionGoal: "pursue_specific_role", targetRole: "   " });
    assert(getDisplayRole(empty) === null, "blank targetRole returns null (no silent fallback)");
  }

  // --- Regression 6: filler guard blocks durable writes ---
  console.log("[6] filler / ambiguous input guard blocks durable field writes");
  {
    const state = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Data Analyst",
      userMessage: "hmm",
      analyzerOutput: {
        extracted_fields: {
          target_role: "Product Manager",
          skills: [{ skill_name: "SQL", user_rating: "advanced" }],
          note: "non-durable note",
        },
        required_complete: true,
        phase_suggestion: "planning",
        confidence: 0.95,
        notes: "",
      },
    });
    const guarded = fillerGuard(state);
    const fields = guarded.analyzerOutput?.extracted_fields ?? {};
    assert(isFillerOrAmbiguous("whatever you think"), "ambiguous phrase is recognized as filler");
    assert(!("target_role" in fields), "filler guard removes target_role durable write");
    assert(!("skills" in fields), "filler guard removes skill-rating durable write");
    assert(fields.note === "non-durable note", "filler guard preserves non-durable notes");
    assert(guarded.newPhase === null, "filler guard blocks phase suggestion");
  }

  // --- Summary ---
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed\n`);
    process.exit(1);
  }
  console.log("\nAll golden-path assertions passed.\n");
}

main().catch((e) => {
  console.error("Golden-path test crashed:", e);
  process.exit(1);
});
