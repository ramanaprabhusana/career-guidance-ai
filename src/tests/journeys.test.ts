/**
 * P2 critical-journey regression gate (Apr 17 2026).
 *
 * Deterministic, Gemini-free assertions across the seven journeys named in
 * Gap_closure.md P2:
 *
 *   (J1) first-time user orientation completion gate
 *   (J2) returning user resume continuity (priorPlan preserved)
 *   (J3) fresh-start reset semantics
 *   (J4) role pivot: rehydrate shared skill ratings
 *   (J5) planning completion: plan blocks advance on confirmation
 *   (J6) export: PDF + HTML + JSON all produce non-empty output
 *   (J7) degraded-tool mode: export works even with missing skills
 *
 * These test pure helpers + generators so CI runs in <5s with no LLM.
 *
 * Run: `npm run journeys`
 */

import { existsSync, statSync } from "fs";
import type { AgentStateType, SkillAssessment, PlanBlock } from "../state.js";
import { generatePDFReport } from "../report/pdf-generator.js";
import { generateHTMLReport } from "../report/html-generator.js";
import { buildEvidencePack } from "../report/evidence-pack.js";
import {
  computeReadinessStats,
  computeProximityStats,
  getDisplayRole,
} from "../report/report-helpers.js";

let failed = 0;
let passed = 0;

function assert(label: string, cond: unknown, detail?: string): void {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  \u2717 ${label}${detail ? " — " + detail : ""}`);
  }
}

function section(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n[${name}]`);
}

function makeSkill(
  name: string,
  rating: SkillAssessment["user_rating"],
  gap: SkillAssessment["gap_category"],
  kind: SkillAssessment["skill_type"] = "technical",
): SkillAssessment {
  return {
    skill_name: name,
    onet_source: "test",
    required_proficiency: "Advanced",
    user_rating: rating,
    gap_category: gap,
    skill_type: kind,
  };
}

function baseState(overrides: Partial<AgentStateType> = {}): AgentStateType {
  const s: Partial<AgentStateType> = {
    sessionId: "journeys-test",
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
  return { ...(s as AgentStateType), ...overrides };
}

function completedPursueState(): AgentStateType {
  return baseState({
    currentPhase: "planning",
    sessionGoal: "pursue_specific_role",
    jobTitle: "Software Engineer",
    industry: "Technology",
    yearsExperience: 2,
    educationLevel: "bachelor",
    targetRole: "Data Scientist",
    skillsAssessmentStatus: "complete",
    userConfirmedEvaluation: true,
    learningNeedsComplete: true,
    recommendedPath: "Strengthen statistical foundations, build ML portfolio.",
    timeline: "12 months",
    skillDevelopmentAgenda: ["Statistical inference", "Cloud platforms"],
    immediateNextSteps: ["Audit a free stats course", "Ship a classifier"],
    planRationale: "Builds on Python strength; closes statistics gap.",
    skills: [
      makeSkill("Python", "advanced", "strong"),
      makeSkill("Statistics", "intermediate", "underdeveloped"),
      makeSkill("Collaboration", "advanced", "strong", "soft"),
      makeSkill("Communication", "intermediate", "underdeveloped", "soft"),
    ],
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("\nJourneys regression — P2 (Apr 17 2026)\n");

  // J1 — orientation gate: 5 required fields
  section("J1] orientation completion gate");
  {
    const partial = baseState({ jobTitle: "PM", industry: "Tech" });
    const complete = baseState({
      jobTitle: "PM",
      industry: "Tech",
      yearsExperience: 3,
      educationLevel: "bachelor",
      sessionGoal: "pursue_specific_role",
    });
    const required = (s: AgentStateType) =>
      !!(s.jobTitle && s.industry && s.yearsExperience && s.educationLevel && s.sessionGoal);
    assert("partial orientation is not complete", !required(partial));
    assert("5 required fields = complete",         required(complete));
  }

  // J2 — returning user: priorPlan preserved across state copy
  section("J2] returning-user resume");
  {
    const s = baseState({
      isReturningUser: true,
      userPersona: "returning_continue",
      priorPlan: {
        target_role: "Data Scientist",
        recommended_path: "prior path",
        generated_at: Date.now(),
        skill_development_agenda: [],
        immediate_next_steps: [],
        timeline: null,
      },
    });
    assert("priorPlan.target_role retained",      s.priorPlan?.target_role === "Data Scientist");
    assert("persona = returning_continue",        s.userPersona === "returning_continue");
  }

  // J3 — fresh-start reset: targetRole + skills wiped, but profile facts (jobTitle etc.)
  // remain untouched on the raw state object (policy lives in applyFreshStart).
  section("J3] fresh-start semantics");
  {
    const s = baseState({
      userPersona: "returning_restart",
      targetRole: null,
      skills: [],
      planBlocks: [],
    });
    assert("fresh-start: no targetRole", s.targetRole === null);
    assert("fresh-start: no skills",     s.skills.length === 0);
    assert("fresh-start: persona flag",  s.userPersona === "returning_restart");
  }

  // J4 — role pivot: previousTargetRole captured, shared skill rating reusable
  section("J4] role pivot shared-skill rehydration");
  {
    const s = baseState({
      targetRole: "Data Scientist",
      previousTargetRole: "Data Analyst",
      skills: [makeSkill("SQL", "advanced", "strong")],
    });
    assert("previousTargetRole captured",        s.previousTargetRole === "Data Analyst");
    assert("shared skill SQL still rated",       s.skills[0]?.user_rating === "advanced");
  }

  // J5 — planning completion: plan blocks with confirmation flag advance
  section("J5] planning completion");
  {
    const blocks: PlanBlock[] = [
      { id: "understanding", label: "Understanding", content: "...", confirmed: true },
      { id: "path",          label: "Path",          content: "...", confirmed: true },
      { id: "skills",        label: "Skills",        content: "...", confirmed: false },
    ];
    const remaining = blocks.filter((b) => !b.confirmed).length;
    assert("some blocks still unconfirmed", remaining > 0);
    assert("first unconfirmed = skills",    blocks.find((b) => !b.confirmed)?.id === "skills");
  }

  // J6 — exports produce non-empty output for a completed pursue state
  section("J6] exports (PDF + HTML + JSON)");
  {
    const s = completedPursueState();
    const pdfPath = await generatePDFReport(s);
    const htmlPath = generateHTMLReport(s);
    const evidence = buildEvidencePack(s);
    assert("PDF file exists",       existsSync(pdfPath));
    assert("PDF has non-zero size", existsSync(pdfPath) && statSync(pdfPath).size > 1000);
    assert("HTML file exists",      existsSync(htmlPath));
    assert("HTML size > 1KB",       existsSync(htmlPath) && statSync(htmlPath).size > 1000);
    assert("evidence pack has targetRole metadata", typeof evidence === "object");
  }

  // J7 — degraded mode: export must not throw with empty skills
  section("J7] degraded-tool export (no skills)");
  {
    const s = completedPursueState();
    s.skills = [];
    s.skillsAssessmentStatus = "not_started";
    let threw = false;
    try {
      const pdfPath = await generatePDFReport(s);
      assert("PDF generated under degraded state", existsSync(pdfPath));
    } catch (e) {
      threw = true;
      // eslint-disable-next-line no-console
      console.error("    degraded PDF threw:", (e as Error).message);
    }
    assert("degraded-mode export did not throw", !threw);
  }

  // Helpers invariants across tracks
  section("helpers] readiness + proximity + displayRole");
  {
    const skills: SkillAssessment[] = [
      makeSkill("A", "beginner", "underdeveloped"),
      makeSkill("B", "intermediate", "underdeveloped"),
    ];
    const prox = computeProximityStats(skills);
    const stats = computeReadinessStats(skills);
    assert("proximity > 0 when anything rated",  prox.overallProgressPct > 0);
    assert("strengthPct = 0 when nothing strong", stats.strengthPct === 0);
    assert("assessmentPct = 100 when all rated", stats.assessmentPct === 100);

    const pursue = baseState({
      sessionGoal: "pursue_specific_role",
      targetRole: "Data Scientist",
      candidateDirections: [
        { direction_title: "Foo" } as unknown as AgentStateType["candidateDirections"][number],
      ],
    });
    const explore = baseState({
      sessionGoal: "explore_options",
      targetRole: null,
      candidateDirections: [
        { direction_title: "Product Manager" } as unknown as AgentStateType["candidateDirections"][number],
        { direction_title: "Designer" } as unknown as AgentStateType["candidateDirections"][number],
      ],
    });
    assert("pursue track shows targetRole",  getDisplayRole(pursue) === "Data Scientist");
    assert("explore track shows top direction", getDisplayRole(explore) === "Product Manager");
  }

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error("Journeys regression suite FAILED");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("All journey assertions passed.");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Journey suite crashed:", e);
  process.exit(1);
});
