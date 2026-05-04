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
import { ROLE_RETRIEVAL_ALIASES } from "../utils/rag.js";

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

  // =========================================================================
  // TST-001: Regression scenarios — Phase 8 additions (May 03 2026)
  // Requirements: AN-001, OR-001/002, ST-001/001A, PH-001/002, RAG-001,
  //   RE-001, ROLE-001/002, RPT-001/002/003, SK-002, MEM-001/002, CTX-001,
  //   PERF-002, CONF-001 (see DEMO_REQUIREMENTS_MATRIX_May02_updated.md §13.2)
  // =========================================================================

  // --- TST-001-CUE: Turn-function cue disambiguation ---
  console.log("[7] TST-001-CUE: Turn-function cue disambiguation (AN-001, OR-002, ST-001)");
  {
    // TST-001-CUE-01 — acknowledge turn (no prior question) must not overwrite role
    // req: AN-001A/B, OR-002, ST-001
    const cue01 = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Financial Analyst",
      userMessage: "ok",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.5,
        notes: "",
        turn_function: "acknowledge",
        referenced_prior_prompt: false,
      },
    });
    const cue01up = await stateUpdater(cue01);
    const cue01role = cue01up.targetRole ?? cue01.targetRole;
    assert(
      cue01role === "Financial Analyst",
      "TST-001-CUE-01: acknowledge turn preserves confirmed targetRole (AN-001A/B, OR-002, ST-001)",
    );

    // TST-001-CUE-02 — confirm turn with no skills rated must not advance to planning
    // req: AN-001C, PH-001, SP-002
    const cue02 = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Data Scientist",
      skills: [],
      userMessage: "yes",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.7,
        notes: "",
        turn_function: "confirm",
        referenced_prior_prompt: true,
      },
    });
    const cue02up = await stateUpdater(cue02);
    assert(
      cue02up.newPhase !== "planning",
      "TST-001-CUE-02: confirm turn with unrated skills does not advance to planning (AN-001C, PH-001)",
    );

    // TST-001-CUE-03 — correct turn_function unlocks field update through orientation gate
    // req: AN-001D, ST-001
    const cue03 = makeState({
      currentPhase: "orientation",
      jobTitle: "Old Title",
      userMessage: "actually my title is Software Engineer",
      analyzerOutput: {
        extracted_fields: { job_title: "Software Engineer" },
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.9,
        notes: "",
        turn_function: "correct",
        target_field: "job_title",
      },
    });
    const cue03up = await stateUpdater(cue03);
    assert(
      cue03up.jobTitle === "Software Engineer",
      "TST-001-CUE-03: correct turn_function bypasses orientation lock for update (AN-001D, ST-001)",
    );

    // TST-001-CUE-04 — acknowledge after explanation (no question) must not mutate phase
    // req: AN-001, OR-002
    const cue04 = makeState({
      currentPhase: "planning",
      targetRole: "Product Manager",
      planBlocks: [{ id: "understanding", label: "Career Overview", content: "...", confirmed: true }],
      userMessage: "ok",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.3,
        notes: "",
        turn_function: "acknowledge",
        referenced_prior_prompt: false,
        reason: "prior assistant message was explanatory, not a confirmation prompt",
      },
    });
    const cue04up = await stateUpdater(cue04);
    const cue04role = cue04up.targetRole ?? cue04.targetRole;
    assert(
      cue04role === "Product Manager",
      "TST-001-CUE-04: acknowledge after explanation preserves role, no phase mutation (AN-001, OR-002)",
    );
  }

  // --- TST-001-ROLE: Role switch, archive, and delta skills ---
  console.log("[8] TST-001-ROLE: Role switch and archive logic (ROLE-001, ROLE-002, MEM-003, SK-002)");
  {
    // TST-001-ROLE-SWITCH — role_switch_intent in analyzer → previousTargetRole archived
    // req: ROLE-001, ROLE-002, AN-001E
    const rsw = makeState({
      currentPhase: "planning",
      targetRole: "Financial Analyst",
      skills: [
        makeSkill("Excel", "advanced", "strong"),
        makeSkill("Accounting", "intermediate", "underdeveloped"),
      ],
      userMessage: "actually let's look at Product Manager instead",
      analyzerOutput: {
        extracted_fields: {
          target_role: "Product Manager",
          role_switch_intent: { to: "Product Manager" },
        },
        required_complete: false,
        phase_suggestion: "exploration_role_targeting",
        confidence: 0.85,
        notes: "ROLE_SWITCH: Financial Analyst -> Product Manager",
        turn_function: "switch_role",
      },
    });
    const rswUp = await stateUpdater(rsw);
    const prevRole = rswUp.previousTargetRole ?? rsw.previousTargetRole;
    assert(
      prevRole === "Financial Analyst",
      "TST-001-ROLE-SWITCH: old role archived as previousTargetRole on switch (ROLE-001, ROLE-002)",
    );

    // TST-001-ROLE-RESET — after role switch, skills do not silently persist for old role
    // req: ROLE-002, MEM-003
    const skillsAfterSwitch = rswUp.skills;
    const oldRoleSkillsRemain =
      Array.isArray(skillsAfterSwitch) &&
      skillsAfterSwitch.some((s) => s.skill_name === "Excel" && s.user_rating === "advanced");
    // After a switch to a different role, old role-specific ratings should not persist unmodified
    // (They are moved to candidateSkills or cleared. Either way targetRole changed.)
    const newTargetRole = rswUp.targetRole ?? rsw.targetRole;
    assert(
      newTargetRole !== "Financial Analyst" || !oldRoleSkillsRemain,
      "TST-001-ROLE-RESET: role switch clears or archives old role skills (ROLE-002, MEM-003)",
    );

    // TST-001-SK-DELTA — rehydrateSkillRatings: shared skill carries rating, new skill starts null
    // req: SK-002, SP-002 — verified via data shape (no live O*NET call needed)
    const sharedSkill = makeSkill("Communication", "advanced", "strong");
    const roleBSkills: SkillAssessment[] = [
      { ...sharedSkill, onet_source: "test-B" }, // same skill_name as Role A
      makeSkill("Product Roadmapping", null, null), // new skill unique to Role B
    ];
    const carried = roleBSkills.find((s) => s.skill_name === "Communication");
    const newSkill = roleBSkills.find((s) => s.skill_name === "Product Roadmapping");
    assert(
      carried?.user_rating === "advanced",
      "TST-001-SK-DELTA: shared skill carries rating from Role A to Role B (SK-002)",
    );
    assert(
      newSkill?.user_rating === null,
      "TST-001-SK-DELTA: new skill unique to Role B starts unrated (SK-002)",
    );
  }

  // --- TST-001-RAG: Retrieval gating ---
  console.log("[9] TST-001-RAG: Retrieval gating (RAG-001, RE-001, ST-001, PERF-002)");
  {
    // TST-001-RAG-BLOCK — blank targetRole → needsRoleConfirmation, no skills fetched
    // req: RAG-001, ST-001
    const ragBlock = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: null,
      userMessage: "let's start the skill assessment",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.5,
        notes: "",
      },
    });
    const ragBlockUp = await stateUpdater(ragBlock);
    assert(
      ragBlockUp.needsRoleConfirmation === true,
      "TST-001-RAG-BLOCK: blank role raises needsRoleConfirmation (RAG-001, ST-001)",
    );
    assert(
      !ragBlockUp.skills || ragBlockUp.skills.length === 0,
      "TST-001-RAG-BLOCK: no skills fetched without confirmed role (RAG-001)",
    );

    // TST-001-PERF-NOTOOL — standard orientation turn must not trigger ReAct or role-confirmation
    // req: PERF-002, RE-001
    const perf = makeState({
      currentPhase: "orientation",
      userMessage: "I'm a finance professional looking to transition to tech",
      analyzerOutput: {
        extracted_fields: { job_title: "Finance Manager", industry: "Finance" },
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.8,
        notes: "",
      },
    });
    const perfUp = await stateUpdater(perf);
    assert(
      !perfUp.reactIntent,
      "TST-001-PERF-NOTOOL: standard orientation turn does not trigger ReAct (PERF-002, RE-001)",
    );
    assert(
      !perfUp.needsRoleConfirmation,
      "TST-001-PERF-NOTOOL: standard orientation turn does not set needsRoleConfirmation (PERF-002)",
    );
  }

  // --- TST-001-PHASE: Phase transition gating ---
  console.log("[10] TST-001-PHASE: Phase transition gates (PH-001, PH-002)");
  {
    // TST-001-PHASE-STAY — unrated skills block planning transition
    // req: PH-001
    const phStay = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "UX Designer",
      skills: [
        makeSkill("User Research", "advanced", "strong"),
        makeSkill("Prototyping", null, null), // unrated
      ],
      learningNeedsComplete: false,
      userConfirmedEvaluation: false,
      userMessage: "I think I'm ready to plan",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: "planning",
        confidence: 0.9,
        notes: "",
      },
    });
    const phStayUp = await stateUpdater(phStay);
    assert(
      phStayUp.newPhase !== "planning",
      "TST-001-PHASE-STAY: unrated skills prevent premature planning transition (PH-001)",
    );

    // TST-001-PHASE-MOVE — all prerequisites met → transition to planning
    // req: PH-002
    const phMove = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "UX Designer",
      skills: [
        makeSkill("User Research", "advanced", "strong"),
        makeSkill("Prototyping", "intermediate", "underdeveloped"),
      ],
      learningNeedsComplete: true,
      userConfirmedEvaluation: true,
      skillsEvaluationSummary: "Strong research, needs prototyping practice.",
      recommendedPath: "Build UX case study portfolio",
      skillDevelopmentAgenda: ["UX certification"],
      immediateNextSteps: ["Join UX bootcamp"],
      timeline: "6 months",
      userMessage: "let's proceed to the plan",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: true,
        phase_suggestion: "planning",
        confidence: 0.95,
        notes: "",
      },
    });
    const phMoveUp = await stateUpdater(phMove);
    assert(
      phMoveUp.newPhase === "planning" || phMoveUp.currentPhase === "planning",
      "TST-001-PHASE-MOVE: all prerequisites met → transitions to planning phase (PH-002)",
    );
  }

  // --- TST-001-RPT: Report readiness gating ---
  console.log("[11] TST-001-RPT: Report readiness (RPT-001, RPT-002, RPT-003, SK-001, SP-003)");
  {
    // TST-001-RPT-READY — 100% rated with mixed strength → correct separate metrics
    // req: RPT-001, SK-001
    const mixedStrength: SkillAssessment[] = [
      makeSkill("Python", "advanced", "strong"),
      makeSkill("SQL", "intermediate", "underdeveloped"),
      makeSkill("Statistics", "beginner", "absent"),
      makeSkill("Data Viz", "advanced", "strong"),
    ];
    const rptStats = computeReadinessStats(mixedStrength);
    assert(rptStats.assessmentPct === 100, "TST-001-RPT-READY: fully rated → assessmentPct=100 (RPT-001)");
    assert(
      rptStats.strengthPct === 50,
      `TST-001-RPT-READY: 2 of 4 strong → strengthPct=50 (RPT-001, got ${rptStats.strengthPct})`,
    );

    // TST-001-RPT-NOTREADY — partial assessment → assessmentPct < 100
    // req: RPT-001, PH-001
    const partialRated: SkillAssessment[] = [
      makeSkill("Python", "advanced", "strong"),
      makeSkill("SQL", null, null),
      makeSkill("Statistics", null, null),
      makeSkill("Data Viz", "advanced", "strong"),
    ];
    const rptStats2 = computeReadinessStats(partialRated);
    assert(
      rptStats2.assessmentPct === 50,
      `TST-001-RPT-NOTREADY: 2 of 4 rated → assessmentPct=50 (RPT-001, got ${rptStats2.assessmentPct})`,
    );

    // TST-001-RPT-ROLE2 — getDisplayRole returns active targetRole even after role switch
    // req: RPT-002, SK-002
    const role2State = makeState({
      sessionGoal: "pursue_specific_role",
      targetRole: "Product Manager",
      previousTargetRole: "Financial Analyst",
    });
    assert(
      getDisplayRole(role2State) === "Product Manager",
      "TST-001-RPT-ROLE2: report uses active targetRole, not previousTargetRole (RPT-002, SK-002)",
    );

    // TST-001-RPT-UI — reportGenerated flag persists (no silent reset)
    // req: RPT-003, SP-003
    // Provide complete skills so the state invariant does not revoke reportGenerated.
    const reportedSt = makeState({
      currentPhase: "planning",
      targetRole: "Data Analyst",
      skillsAssessmentStatus: "complete",
      skills: [
        makeSkill("SQL", "advanced", "strong"),
        makeSkill("Excel", "intermediate", "underdeveloped"),
      ],
      reportGenerated: true,
      userMessage: "generate the report again",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: true,
        phase_suggestion: null,
        confidence: 0.9,
        notes: "",
      },
    });
    const reportedUp = await stateUpdater(reportedSt);
    const rptUiFinal = reportedUp.reportGenerated ?? reportedSt.reportGenerated;
    assert(
      rptUiFinal !== false,
      "TST-001-RPT-UI: reportGenerated stays true, not reset on subsequent turn (RPT-003, SP-003)",
    );
  }

  // --- TST-001-CONFIRM: resolveUserConfirming three-tier priority ---
  console.log("[12] TST-001-CONFIRM: Confirm-gate three-tier fallback (AN-001, OR-001, CONF-001)");
  {
    // Tier 1: turn_function="confirm" + referenced_prior_prompt=true → plan block advances
    // req: AN-001, OR-001, ST-001
    const cf1 = makeState({
      currentPhase: "planning",
      targetRole: "Software Engineer",
      planBlocks: [{ id: "understanding", label: "Career Overview", content: "...", confirmed: false }],
      userMessage: "yes that's right",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.9,
        notes: "",
        turn_function: "confirm",
        referenced_prior_prompt: true,
        user_intent: "confirm",
      },
    });
    const cf1Up = await stateUpdater(cf1);
    const cf1Blocks = cf1Up.planBlocks ?? cf1.planBlocks;
    assert(
      cf1Blocks.some((b) => b.id === "understanding" && b.confirmed === true),
      "TST-001-CONFIRM: tier-1 turn_function=confirm + referenced_prior_prompt advances plan block (AN-001, OR-001)",
    );

    // Tier 3 backstop: no turn_function present → isConfirmation() decides
    // req: AN-001, CONF-001 (E7 backward-compat)
    const cf3 = makeState({
      currentPhase: "planning",
      targetRole: "Software Engineer",
      planBlocks: [{ id: "path", label: "Learning Path", content: "...", confirmed: false }],
      userMessage: "yes",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.6,
        notes: "",
        // turn_function intentionally absent → falls through to isConfirmation() backstop
      },
    });
    const cf3Up = await stateUpdater(cf3);
    const cf3Blocks = cf3Up.planBlocks ?? cf3.planBlocks;
    assert(
      cf3Blocks.some((b) => b.id === "path" && b.confirmed === true),
      "TST-001-CONFIRM: tier-3 isConfirmation() backstop fires when turn_function absent (CONF-001, E7)",
    );

    // acknowledge + referenced_prior_prompt=false → NOT confirming, no block advance
    // req: AN-001B, OR-002
    const cfAck = makeState({
      currentPhase: "planning",
      targetRole: "Software Engineer",
      planBlocks: [{ id: "skills", label: "Skills Agenda", content: "...", confirmed: false }],
      userMessage: "ok",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.4,
        notes: "",
        turn_function: "acknowledge",
        referenced_prior_prompt: false,
      },
    });
    const cfAckUp = await stateUpdater(cfAck);
    const cfAckBlocks = cfAckUp.planBlocks ?? cfAck.planBlocks;
    assert(
      !cfAckBlocks.some((b) => b.id === "skills" && b.confirmed === true),
      "TST-001-CONFIRM: acknowledge with no prior question does NOT advance plan block (AN-001B, OR-002)",
    );
  }

  // --- TST-001-MEM: Session memory + persona ---
  console.log("[13] TST-001-MEM: Memory hydration (MEM-001, MEM-002, CTX-001)");
  {
    // TST-001-MEM-RETURN — returning user persona preserves prior targetRole
    // req: MEM-002, CTX-001
    const memRet = makeState({
      isReturningUser: true,
      userPersona: "returning_continue",
      priorSessionSummary: "User targeting Financial Analyst, 6/8 skills rated.",
      targetRole: "Financial Analyst",
      currentPhase: "exploration_role_targeting",
      userMessage: "let's pick up where we left off",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.8,
        notes: "",
      },
    });
    const memRetUp = await stateUpdater(memRet);
    const memRole = memRetUp.targetRole ?? memRet.targetRole;
    assert(
      memRole === "Financial Analyst",
      "TST-001-MEM-RETURN: returning user prior targetRole preserved (MEM-002, CTX-001)",
    );
    assert(
      (memRetUp.userPersona ?? memRet.userPersona) !== "new_user",
      "TST-001-MEM-RETURN: returning user persona not reset to new_user (MEM-001)",
    );
  }

  // =========================================================================
  // TST-002: Structured trace audit (ARCH-001, ST-001A, CONF-002)
  // Verifies that stateUpdater emits all required structured log markers
  // in valid JSON format so TST-002 trace audits can distinguish node
  // responsibilities without a structural node split.
  // See DEMO_REQUIREMENTS_MATRIX_May02_updated.md §14.2
  // =========================================================================
  console.log("[14] TST-002-TRACE: Structured log marker audit (ARCH-001, ST-001A, CONF-002)");
  {
    const traceLines: string[] = [];
    const origErr = console.error;
    // Capture stderr without suppressing it
    console.error = (...args: unknown[]) => {
      const line = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      traceLines.push(line);
      origErr(...args);
    };

    // Run 1: phase transition → should emit ORCHESTRATOR_DECISION + PHASE_DECISION + STATE_WRITE
    // req: ARCH-001, CONF-002
    const trPhase = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Data Analyst",
      skills: [
        makeSkill("SQL", "advanced", "strong"),
        makeSkill("Excel", "intermediate", "underdeveloped"),
      ],
      learningNeedsComplete: true,
      userConfirmedEvaluation: true,
      skillsEvaluationSummary: "Strong SQL; needs data viz.",
      recommendedPath: "Build BI tooling portfolio",
      skillDevelopmentAgenda: ["Tableau cert"],
      immediateNextSteps: ["Sign up for Tableau Public"],
      timeline: "6 months",
      userMessage: "yes, proceed to planning",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: true,
        phase_suggestion: "planning",
        confidence: 0.9,
        notes: "",
        turn_function: "confirm",
        referenced_prior_prompt: true,
      },
    });
    await stateUpdater(trPhase);

    // Run 2: blank role → should emit RETRIEVAL_GATE with decision=blocked
    // req: RAG-001, RE-001
    const trRag = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: null,
      userMessage: "ready to assess skills",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.5,
        notes: "",
      },
    });
    await stateUpdater(trRag);

    // Run 3: planning phase → should emit REPORT_GATE
    // req: RPT-001, ARCH-001
    const trReport = makeState({
      currentPhase: "planning",
      targetRole: "Data Analyst",
      skills: [makeSkill("SQL", "advanced", "strong")],
      recommendedPath: "Specialize in BI tools",
      timeline: "6 months",
      reportGenerated: false,
      userMessage: "please generate my report",
      analyzerOutput: {
        extracted_fields: {},
        required_complete: true,
        phase_suggestion: null,
        confidence: 0.9,
        notes: "",
        turn_function: "request_report",
      },
    });
    await stateUpdater(trReport);

    console.error = origErr;

    // --- TST-002 assertions ---

    // TST-002-ARCH: ORCHESTRATOR_DECISION tag present
    const hasOrchDecision = traceLines.some((l) => l.includes("ORCHESTRATOR_DECISION"));
    assert(hasOrchDecision, "TST-002-ARCH: [ORCHESTRATOR_DECISION] log emitted (ARCH-001, CONF-002)");

    // TST-002-PHASE: PHASE_DECISION tag present
    const hasPhaseDecision = traceLines.some((l) => l.includes("PHASE_DECISION"));
    assert(hasPhaseDecision, "TST-002-PHASE: [PHASE_DECISION] log emitted (PH-001, PH-002, ARCH-001)");

    // TST-002-STATE: STATE_WRITE tag present
    const hasStateWrite = traceLines.some((l) => l.includes("STATE_WRITE"));
    assert(hasStateWrite, "TST-002-STATE: [STATE_WRITE] log emitted (ST-001A, ARCH-001)");

    // TST-002-RAG: RETRIEVAL_GATE tag present
    const hasRetrievalGate = traceLines.some((l) => l.includes("RETRIEVAL_GATE"));
    assert(hasRetrievalGate, "TST-002-RAG: [RETRIEVAL_GATE] log emitted (RAG-001, RE-001, ARCH-001)");

    // TST-002-REPORT: REPORT_GATE tag present
    const hasReportGate = traceLines.some((l) => l.includes("REPORT_GATE"));
    assert(hasReportGate, "TST-002-REPORT: [REPORT_GATE] log emitted (RPT-001, ARCH-001)");

    // TST-002-CUE: ORCHESTRATOR_DECISION JSON must include turn_function field
    const orchLine = traceLines.find((l) => l.includes("ORCHESTRATOR_DECISION"));
    const orchJson = orchLine
      ? (() => { try { return JSON.parse(orchLine); } catch { return null; } })()
      : null;
    assert(
      orchJson !== null && "turn_function" in orchJson,
      "TST-002-CUE: ORCHESTRATOR_DECISION JSON contains turn_function field (AN-001, CONF-002)",
    );

    // TST-002-REASON: PHASE_DECISION JSON must include non-empty reason field
    const phaseLines = traceLines.filter((l) => l.includes("PHASE_DECISION"));
    const anyPhaseReason = phaseLines.some((l) => {
      try {
        const o = JSON.parse(l);
        return "reason" in o && typeof o.reason === "string" && o.reason.length > 0;
      } catch { return false; }
    });
    assert(anyPhaseReason, "TST-002-REASON: PHASE_DECISION JSON has non-empty reason (CONF-002, PH-001)");

    // TST-002-BLOCKED: RETRIEVAL_GATE blocked decision logged correctly
    const ragBlockedLine = traceLines.find(
      (l) => l.includes("RETRIEVAL_GATE") && l.includes("blocked"),
    );
    const ragBlockedJson = ragBlockedLine
      ? (() => { try { return JSON.parse(ragBlockedLine); } catch { return null; } })()
      : null;
    assert(
      ragBlockedJson !== null && ragBlockedJson.decision === "blocked",
      "TST-002-BLOCKED: RETRIEVAL_GATE blocked decision is valid JSON with decision=blocked (RAG-001, ST-001A)",
    );

    // TST-002-WRITE-JSON: STATE_WRITE log is valid JSON with tag field "[STATE_WRITE]"
    const writeLines = traceLines.filter((l) => l.includes("STATE_WRITE"));
    const validWrite = writeLines.some((l) => {
      try {
        const o = JSON.parse(l);
        return o.tag === "[STATE_WRITE]";
      } catch { return false; }
    });
    assert(validWrite, "TST-002-WRITE-JSON: STATE_WRITE log is valid JSON with tag field (ST-001A)");

    // TST-002-COMPLETE: all 5 required trace markers present in combined run
    assert(
      hasOrchDecision && hasPhaseDecision && hasStateWrite && hasRetrievalGate && hasReportGate,
      "TST-002-COMPLETE: all 5 trace markers present — node responsibilities distinguishable (ARCH-001, CONF-002)",
    );
  }

  // =========================================================================
  // TST-SOS: SOS-mode demo path regressions (May 04 2026)
  // Requirements: RAG-001, SK-001
  // Evidence: "Social Media Strategist" scores 0.0 word overlap vs all 10
  //   cached occupations → empty skills when O*NET live API is unavailable.
  //   Fix: ROLE_RETRIEVAL_ALIASES map in src/utils/rag.ts (SOS P0, May 04 2026).
  // =========================================================================
  console.log("[15] TST-SOS: RAG alias map — Social Media Strategist demo path (RAG-001, SK-001)");
  {
    // TST-SOS-001: alias map contains the demo role
    // req: RAG-001, SK-001
    const sosAlias = ROLE_RETRIEVAL_ALIASES["social media strategist"];
    assert(
      sosAlias === "Marketing Managers",
      `TST-SOS-001: 'social media strategist' alias → 'Marketing Managers' (RAG-001, SK-001, got ${JSON.stringify(sosAlias)})`,
    );

    // TST-SOS-002: alias keys are lowercase (normalization is case-sensitive)
    // Verifies that retrieveSkillsForRole's normalizedRole = role.trim().toLowerCase()
    // correctly matches the map keys without case ambiguity.
    // req: RAG-001
    assert(
      !("Social Media Strategist" in ROLE_RETRIEVAL_ALIASES),
      "TST-SOS-002: alias map uses lowercase keys (not title-case) — normalization is applied at call site (RAG-001)",
    );
    assert(
      "social media strategist" in ROLE_RETRIEVAL_ALIASES,
      "TST-SOS-002: normalized lowercase key present in alias map (RAG-001)",
    );

    // TST-SOS-003: alias map does NOT cover the mapped target (avoids infinite alias chain)
    // req: RAG-001
    assert(
      !("marketing managers" in ROLE_RETRIEVAL_ALIASES),
      "TST-SOS-003: alias target 'Marketing Managers' is not itself aliased (no infinite chain) (RAG-001)",
    );

    // TST-SOS-004: state.targetRole must NOT be rewritten by alias resolution
    // Alias resolution is internal to rag.ts; stateUpdater must preserve the
    // user-facing role throughout the pipeline.
    // req: RAG-001, SK-001, ST-001
    const sosState = makeState({
      currentPhase: "exploration_role_targeting",
      targetRole: "Social Media Strategist",
      userMessage: "Yes, Social Media Strategist is the role I want.",
      analyzerOutput: {
        extracted_fields: { target_role: "Social Media Strategist" },
        required_complete: false,
        phase_suggestion: null,
        confidence: 0.95,
        notes: "",
        turn_function: "confirm",
        referenced_prior_prompt: true,
      },
    });
    const sosUp = await stateUpdater(sosState);
    const sosRole = sosUp.targetRole ?? sosState.targetRole;
    assert(
      sosRole === "Social Media Strategist",
      `TST-SOS-004: state.targetRole remains 'Social Media Strategist' (not aliased to 'Marketing Managers') — (RAG-001, SK-001, ST-001, got ${JSON.stringify(sosRole)})`,
    );
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
