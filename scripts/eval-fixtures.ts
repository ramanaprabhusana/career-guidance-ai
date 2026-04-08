/**
 * Synthetic profile checks: evidence pack builder + schema_version.
 * Run: npm run eval-fixtures
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildEvidencePack } from "../src/report/evidence-pack.js";
import type { AgentStateType } from "../src/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES_PATH = join(ROOT, "fixtures", "eval-profiles.json");

function minimalState(overrides: Partial<AgentStateType> & { sessionId: string }): AgentStateType {
  const base = {
    sessionId: overrides.sessionId,
    userId: overrides.userId ?? null,
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
    skillsAssessmentStatus: "not_started" as const,
    candidateSkills: {},
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
    turnType: "first_turn" as const,
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
  };
  return { ...base, ...overrides } as AgentStateType;
}

const roles = ["Data Analyst", "Nurse", "Teacher", "Software Developer", "Project Manager"];
const industries = ["Technology", "Healthcare", "Education", "Finance", "Manufacturing"];

function syntheticFixtures(): AgentStateType[] {
  const out: AgentStateType[] = [];
  for (let i = 0; i < 30; i++) {
    const explore = i % 3 === 0;
    out.push(
      minimalState({
        sessionId: `eval-syn-${String(i + 1).padStart(2, "0")}`,
        userId: i % 5 === 0 ? `user-${i}` : null,
        currentPhase: i % 4 === 0 ? "planning" : "exploration_role_targeting",
        sessionGoal: explore ? "explore_options" : "pursue_specific_role",
        jobTitle: "Professional",
        industry: industries[i % industries.length] ?? "Technology",
        yearsExperience: (i % 10) + 1,
        educationLevel: "bachelor",
        targetRole: explore ? null : roles[i % roles.length] ?? "Data Analyst",
        timeline: "6-12 months",
        candidateDirections: explore
          ? [
              { direction_title: "Analytics", rationale: "Fit for numbers" },
              { direction_title: "Operations", rationale: "Process focus" },
            ]
          : [],
        skills: [
          {
            skill_name: "Communication",
            onet_source: "2.A.1.a",
            required_proficiency: "high",
            user_rating: i % 2 === 0 ? "working_knowledge" : "strong_proficiency",
            gap_category: i % 2 === 0 ? "underdeveloped" : "strong",
            skill_type: "soft",
          },
        ],
        learningResources:
          i % 7 === 0
            ? [{ title: "Coursera", url: "https://www.coursera.org/", note: "General" }]
            : [],
        evidenceKept:
          i % 6 === 0
            ? [{ source: "O*NET", detail: "Skills for role", reason: "Benchmark" }]
            : [],
        evidenceDiscarded: [],
        progressItems:
          i % 5 === 0
            ? [
                { id: "a", label: "Review postings", done: false },
                { id: "b", label: "Update resume", done: true },
              ]
            : [],
        immediateNextSteps: ["Step one", "Step two"],
        skillDevelopmentAgenda: ["Learn X"],
        recommendedPath: "Sample path",
        planRationale: "Sample rationale",
        reportGenerated: i % 8 === 0,
      }),
    );
  }
  return out;
}

async function main() {
  let fixtures: AgentStateType[] = [];
  if (existsSync(FIXTURES_PATH)) {
    const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8")) as Partial<AgentStateType>[];
    fixtures = raw.map((r, i) => minimalState({ ...r, sessionId: r.sessionId ?? `eval-file-${i}` }));
  }
  fixtures = [...fixtures, ...syntheticFixtures()];

  let ok = 0;
  const failures: string[] = [];
  const perFixture: Array<{ sessionId: string; passed: boolean; reason?: string }> = [];
  const t0 = Date.now();

  for (const state of fixtures) {
    try {
      const pack = buildEvidencePack(state);
      if (pack.schema_version !== "1.0") throw new Error("schema_version");
      if (pack.session_id !== state.sessionId) throw new Error("session_id mismatch");
      if (!Array.isArray(pack.assumptions) || pack.assumptions.length === 0) throw new Error("assumptions");
      ok++;
      perFixture.push({ sessionId: state.sessionId, passed: true });
    } catch (e) {
      const reason = (e as Error).message;
      failures.push(`${state.sessionId}: ${reason}`);
      perFixture.push({ sessionId: state.sessionId, passed: false, reason });
    }
  }

  const elapsed = Date.now() - t0;
  const report = {
    generated_at: new Date().toISOString(),
    total: fixtures.length,
    passed: ok,
    failed: failures.length,
    pass_rate: fixtures.length > 0 ? +(ok / fixtures.length).toFixed(4) : 0,
    ms: elapsed,
    failures: failures.slice(0, 10),
    per_fixture: perFixture,
  };
  console.log(JSON.stringify({ ...report, per_fixture: undefined }, null, 2));

  // G6: persist a metrics report so CI / reviewers can diff it.
  const exportsDir = join(ROOT, "exports");
  mkdirSync(exportsDir, { recursive: true });
  const reportPath = join(exportsDir, "eval-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);

  process.exit(failures.length ? 1 : 0);
}

main();
