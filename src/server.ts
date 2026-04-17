import express from "express";
import cors from "cors";
import compression from "compression";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { buildGraph } from "./graph.js";
import { config } from "./config.js";
import { generatePDFReport } from "./report/pdf-generator.js";
import { generateHTMLReport } from "./report/html-generator.js";
import { buildEvidencePack, writeEvidencePackFile } from "./report/evidence-pack.js";
import { searchOccupations } from "./services/onet.js";
import type {
  AgentStateType,
  ProgressItem,
  UserPersona,
  RoleHistoryEntry,
  RoleSwitchContext,
  RoleComparisonContext,
  PriorPlanSnapshot,
} from "./state.js";
import { categorizeSkillType, warmup as warmupRag, retrieveSkillsForRole, compareTwoRoles } from "./utils/rag.js";
import {
  openProfileDb,
  getProfilePayload,
  upsertProfilePayload,
  appendEpisodicSummary,
  listRecentEpisodic,
  saveSessionState,
  loadSessionState,
  recordPriorPlan,
  recordSkillRatingsForRole,
} from "./db/profile-db.js";
import { parseResumeText } from "./services/resume-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Change 6 (Apr 16 2026): ensure exports dir exists at boot. Render's free-tier
// disk is ephemeral and may not carry the dir forward across deploys. Without
// this, generatePDFReport also mkdirs, but having it at boot makes the failure
// mode (missing dir) impossible between Render dyno restart and first export.
try {
  mkdirSync(join(ROOT, "exports"), { recursive: true });
} catch (e) {
  console.warn("exports dir bootstrap failed:", (e as Error).message);
}

// Load .env
try {
  const envPath = join(ROOT, ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
} catch { /* ignore */ }

if (!process.env.GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY not set. Add it to .env");
  process.exit(1);
}

// --- Session Persistence ---
const SESSION_DIR = join(ROOT, "sessions");
mkdirSync(SESSION_DIR, { recursive: true });

const sessions = new Map<string, AgentStateType>();

let profileDb: ReturnType<typeof openProfileDb> | null = null;
try {
  profileDb = openProfileDb(join(ROOT, "data", "profiles.db"));
} catch (e) {
  console.warn("SQLite profile store unavailable:", (e as Error).message);
}

function saveSession(id: string, state: AgentStateType): void {
  // Change 4 (Bug E8): SQLite is the source of truth — Render free-tier
  // dyno restarts wipe the ephemeral filesystem AND the in-memory Map, so
  // sessions/*.json alone was losing mid-flow conversations. In-memory Map
  // stays as an L1 cache (same-request reuse) and disk JSON writes remain
  // as a debugging artifact.
  sessions.set(id, state);
  if (profileDb) {
    try {
      saveSessionState(profileDb, id, state.userId ?? null, JSON.stringify(state));
    } catch (e) {
      console.warn("saveSessionState failed:", (e as Error).message);
    }
  }
  void writeFile(join(SESSION_DIR, `${id}.json`), JSON.stringify(state)).catch((e) => {
    console.warn("Failed to persist session:", (e as Error).message);
  });
}

function migrateSession(state: any): AgentStateType {
  // Derive skillsAssessmentStatus for sessions created before this field existed
  if (state.skillsAssessmentStatus === undefined) {
    const skills = state.skills ?? [];
    const rated = skills.filter((s: any) => s.user_rating !== null).length;
    if (skills.length === 0 || rated === 0) {
      state.skillsAssessmentStatus = "not_started";
    } else if (rated === skills.length) {
      state.skillsAssessmentStatus = "complete";
    } else {
      state.skillsAssessmentStatus = "in_progress";
    }
  }

  // Patch skill_type onto existing skills for backward compat
  if (Array.isArray(state.skills)) {
    for (const skill of state.skills) {
      if (!skill.skill_type) {
        skill.skill_type = categorizeSkillType(skill.skill_name);
      }
    }
  }

  // Initialize candidateSkills if missing
  if (state.candidateSkills === undefined) {
    state.candidateSkills = {};
  }

  if (state.location === undefined) state.location = null;
  if (state.preferredTimeline === undefined) state.preferredTimeline = null;
  if (!Array.isArray(state.learningResources)) state.learningResources = [];
  if (!Array.isArray(state.evidenceKept)) state.evidenceKept = [];
  if (!Array.isArray(state.evidenceDiscarded)) state.evidenceDiscarded = [];
  if (!Array.isArray(state.progressItems)) state.progressItems = [];

  // Change 3: migrate old 3-level ratings to new 4-level scale
  if (Array.isArray(state.skills)) {
    const ratingMigration: Record<string, string> = {
      not_yet_familiar: "beginner",
      working_knowledge: "intermediate",
      strong_proficiency: "advanced",
    };
    for (const skill of state.skills) {
      if (skill.user_rating && ratingMigration[skill.user_rating]) {
        skill.user_rating = ratingMigration[skill.user_rating];
      }
    }
  }

  // Change 3: default new post-assessment fields
  if (state.learningNeeds === undefined) state.learningNeeds = [];
  if (state.learningNeedsComplete === undefined) state.learningNeedsComplete = false;
  if (state.skillsEvaluationSummary === undefined) state.skillsEvaluationSummary = null;
  if (state.userConfirmedEvaluation === undefined) state.userConfirmedEvaluation = false;

  // Runtime fields that pre-Change-3 sessions may be missing. These are
  // consumed by speaker-prompt-creator and state-updater, so leaving them
  // undefined crashes older sessions on load.
  if (!Array.isArray(state.planBlocks)) state.planBlocks = [];
  if (state.shiftIntent === undefined) state.shiftIntent = false;
  if (state.safetyStrikes === undefined) state.safetyStrikes = 0;
  if (state.offTopicStrikes === undefined) state.offTopicStrikes = 0;
  if (state.resumeChoice === undefined) state.resumeChoice = null;

  // --- Change 4: defaults for structured role memory fields. All additive so
  // pre-Change-4 sessions load without crashing and get empty/null defaults.
  if (state.userPersona === undefined) state.userPersona = "new_user";
  if (!Array.isArray(state.candidateIndustries)) state.candidateIndustries = [];
  if (!Array.isArray(state.prioritizedIndustries)) state.prioritizedIndustries = [];
  if (!Array.isArray(state.exploredRoles)) state.exploredRoles = [];
  if (!Array.isArray(state.comparedRoles)) state.comparedRoles = [];
  if (state.previousTargetRole === undefined) state.previousTargetRole = null;
  if (state.roleSwitchContext === undefined) state.roleSwitchContext = null;
  if (state.roleSwitchAcknowledged === undefined) state.roleSwitchAcknowledged = false;
  if (state.roleComparisonContext === undefined) state.roleComparisonContext = null;
  if (state.priorPlan === undefined) state.priorPlan = null;

  return state as AgentStateType;
}

function persistUserProfile(state: AgentStateType, sessionId: string): void {
  if (!profileDb || !state.userId) return;
  // Change 4: persist the extended profile facts so returning users and
  // in-session role pivots can reuse them without re-asking.
  upsertProfilePayload(profileDb, state.userId, {
    last_session_id: sessionId,
    target_role: state.targetRole,
    job_title: state.jobTitle,
    conversation_summary: state.conversationSummary || undefined,
    industry: state.industry ?? null,
    education_level: state.educationLevel ?? null,
    years_experience: state.yearsExperience ?? null,
    location: state.location ?? null,
    preferred_timeline: state.preferredTimeline ?? null,
    explored_roles: (state.exploredRoles ?? []).map((e) => ({
      role_name: e.role_name,
      status: e.status,
      first_seen_at: e.first_seen_at,
    })),
  });

  // Persist skill ratings for the current target role so they can be
  // rehydrated on future pivots (same session OR new session).
  if (state.targetRole && Array.isArray(state.skills) && state.skills.length > 0) {
    try {
      recordSkillRatingsForRole(profileDb, state.userId, state.targetRole, state.skills);
    } catch (e) {
      console.warn("recordSkillRatingsForRole failed:", (e as Error).message);
    }
  }

  // Snapshot the most recent completed plan when the planning phase finishes.
  if (
    state.currentPhase === "planning" &&
    state.targetRole &&
    (state.recommendedPath || (state.skillDevelopmentAgenda ?? []).length > 0)
  ) {
    const snapshot: PriorPlanSnapshot = {
      target_role: state.targetRole,
      generated_at: Date.now(),
      recommended_path: state.recommendedPath ?? null,
      skill_development_agenda: state.skillDevelopmentAgenda ?? [],
      immediate_next_steps: state.immediateNextSteps ?? [],
      timeline: state.timeline ?? null,
    };
    try {
      recordPriorPlan(profileDb, state.userId, snapshot);
    } catch (e) {
      console.warn("recordPriorPlan failed:", (e as Error).message);
    }
  }

  if (state.transitionDecision === "complete" && state.conversationSummary?.trim()) {
    appendEpisodicSummary(profileDb, state.userId, sessionId, state.conversationSummary);
  }
}

// Detect the returning user's choice between resuming prior context and
// starting fresh. Runs ONLY on the first user turn of a returning-user
// session (before the graph sees the message), in response to the hardcoded
// "Would you like to resume or start fresh?" prompt in speaker-prompt-creator.
function detectResumeIntent(msg: string): "resume" | "fresh" | null {
  const t = (msg ?? "").toLowerCase().trim();
  if (!t) return null;
  const freshMarkers = ["fresh", "start over", "start new", "new conversation", "from scratch", "restart", "begin again", "reset"];
  const resumeMarkers = ["resume", "continue", "pick up", "carry on", "keep going", "where we left", "where i left"];
  if (freshMarkers.some((m) => t.includes(m))) return "fresh";
  if (resumeMarkers.some((m) => t.includes(m))) return "resume";
  return null;
}

// Change 4 — applyRestartPivot: "New direction, keep my profile".
// Per Revised Prompt §C: the chatbot should NOT erase useful profile memory
// just because the target role/path changed. This keeps jobTitle, industry,
// yearsExperience, educationLevel, location, preferredTimeline, exploredRoles,
// priorPlan; resets only path-specific state (track/targetRole/skills/plan).
// If we know the job title, we can skip orientation and jump to exploration.
function applyRestartPivot(state: AgentStateType): AgentStateType {
  const archivedTarget = state.targetRole;
  const exploredUpdate: RoleHistoryEntry[] = archivedTarget
    ? [
        ...state.exploredRoles,
        {
          role_name: archivedTarget,
          status: "deprioritized" as const,
          first_seen_at: Date.now(),
        },
      ]
    : state.exploredRoles;

  return {
    ...state,
    userPersona: "returning_restart",
    resumeChoice: "fresh",
    isReturningUser: false, // skip the welcome-back prompt; user already chose
    priorSessionSummary: "",
    priorEpisodicSummaries: [],
    // KEEP profile facts (jobTitle, industry, yearsExperience, educationLevel,
    //   sessionGoal, location, preferredTimeline, priorPlan).
    // RESET path-specific state:
    track: null,
    interests: [],
    constraints: [],
    candidateDirections: [],
    candidateIndustries: [],
    prioritizedIndustries: [],
    comparedRoles: [],
    targetRole: null,
    previousTargetRole: archivedTarget,
    exploredRoles: exploredUpdate,
    roleSwitchContext: null,
    roleSwitchAcknowledged: false,
    roleComparisonContext: null,
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
    planBlocks: [],
    shiftIntent: false,
    // If we already have orientation facts, skip straight to exploration.
    currentPhase: state.jobTitle ? "exploration_career" : "orientation",
    phaseTurnNumber: 0,
  };
}

// Full wipe (the explicit "Start completely fresh" UI button). Preserves
// identity (userId, sessionId) and audit trail only; resets everything else.
function applyFreshStart(state: AgentStateType): AgentStateType {
  return {
    ...state,
    userPersona: "new_user",
    resumeChoice: "fresh",
    isReturningUser: false,
    priorSessionSummary: "",
    priorEpisodicSummaries: [],
    conversationSummary: "",
    // Reset profile fields so orientation starts clean
    jobTitle: null,
    industry: null,
    yearsExperience: null,
    educationLevel: null,
    sessionGoal: null,
    location: null,
    preferredTimeline: null,
    // Reset exploration + role targeting
    track: null,
    interests: [],
    constraints: [],
    candidateDirections: [],
    candidateIndustries: [],
    prioritizedIndustries: [],
    comparedRoles: [],
    targetRole: null,
    previousTargetRole: null,
    exploredRoles: [],
    roleSwitchContext: null,
    roleSwitchAcknowledged: false,
    roleComparisonContext: null,
    skills: [],
    skillsAssessmentStatus: "not_started",
    candidateSkills: {},
    learningNeeds: [],
    learningNeedsComplete: false,
    skillsEvaluationSummary: null,
    userConfirmedEvaluation: false,
    // Reset planning
    recommendedPath: null,
    timeline: null,
    skillDevelopmentAgenda: [],
    immediateNextSteps: [],
    planRationale: null,
    reportGenerated: false,
    planBlocks: [],
    shiftIntent: false,
    priorPlan: null,
    currentPhase: "orientation",
    phaseTurnNumber: 0,
  };
}

function parseSuggestions(output: string): { message: string; suggestions: string[] } {
  const match = output.match(/\[SUGGESTIONS:\s*(.+?)\]\s*$/);
  if (!match) return { message: output, suggestions: [] };
  const message = output.slice(0, match.index).trimEnd();
  const suggestions = match[1].split("|").map((s) => s.trim()).filter(Boolean);
  return { message, suggestions };
}

function buildSkillsMeta(state: AgentStateType) {
  const skills = state.skills ?? [];
  const ratedCount = skills.filter((s: any) => s.user_rating !== null).length;
  return {
    totalSkills: skills.length,
    ratedCount,
    skillsAssessed: skills.length > 0 && ratedCount > 0,
    assessmentStatus: (state as any).skillsAssessmentStatus ?? "not_started",
  };
}

function loadSession(id: string): AgentStateType | null {
  // Change 4 (Bug E8): SQLite is the source of truth on Render free tier.
  // L1 cache (Map) → SQLite → disk JSON (legacy fallback).
  const mem = sessions.get(id);
  if (mem) return migrateSession(mem);

  if (profileDb) {
    try {
      const row = loadSessionState(profileDb, id);
      if (row) {
        const data = JSON.parse(row.state_json);
        const migrated = migrateSession(data);
        sessions.set(id, migrated);
        return migrated;
      }
    } catch (e) {
      console.warn("loadSessionState failed:", (e as Error).message);
    }
  }

  // Legacy fallback: sessions/*.json files from pre-Change-4 runs.
  const path = join(SESSION_DIR, `${id}.json`);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      const migrated = migrateSession(data);
      sessions.set(id, migrated);
      return migrated;
    } catch {
      return null;
    }
  }
  return null;
}

const app = express();
app.use(compression());
app.use(cors());
app.use(express.json());

// Static assets with long cache (fonts, CSS, JS) — cache 7 days
app.use("/fonts", express.static(join(ROOT, "public/fonts"), { maxAge: "7d", immutable: true }));
app.use("/css", express.static(join(ROOT, "public/css"), { maxAge: "1d" }));
app.use("/js", express.static(join(ROOT, "public/js"), { maxAge: "1d" }));

// HTML and other public files — no cache (always fresh)
app.use(express.static(join(ROOT, "public"), { maxAge: 0 }));

const graph = buildGraph();

// --- API Routes ---

// Create a new session
app.post("/api/session", async (req, res) => {
  const sessionId = uuidv4();
  const userId =
    typeof req.body?.userId === "string" && req.body.userId.trim().length > 0
      ? req.body.userId.trim().slice(0, 128)
      : null;
  // Change 4 (Step 12A): the frontend "New direction (keep my profile)" button
  // sends { userId, restart_pivot: true }. When set, we skip the welcome-back
  // prompt, archive the prior target, and reset path-specific state.
  const restartPivot = req.body?.restart_pivot === true;

  try {
    // Change 4: explicit persona detection replaces the old binary
    // isReturningUser flag. The speaker branches on persona for opener
    // wording and which known facts to acknowledge.
    let userPersona: UserPersona = "new_user";
    let isReturningUser = false;
    let priorSessionSummary = "";
    let priorEpisodicSummaries: string[] = [];
    let priorTargetRole: string | null = null;
    let priorJobTitle: string | null = null;
    // New: preload extended profile facts so the orientation speaker can
    // acknowledge them and skip re-asking (BR-12).
    let priorIndustry: string | null = null;
    let priorEducation: any = null;
    let priorYearsExperience: number | null = null;
    let priorLocation: string | null = null;
    let priorPreferredTimeline: string | null = null;
    let priorExploredRoles: RoleHistoryEntry[] = [];
    let priorPlan: PriorPlanSnapshot | null = null;

    if (userId && profileDb) {
      const prof = getProfilePayload(profileDb, userId);
      if (prof) {
        userPersona = "returning_continue";
        isReturningUser = true;
        priorSessionSummary = (prof.conversation_summary ?? "").trim();
        priorTargetRole = prof.target_role ?? null;
        priorJobTitle = prof.job_title ?? null;
        priorIndustry = prof.industry ?? null;
        priorEducation = prof.education_level ?? null;
        priorYearsExperience = prof.years_experience ?? null;
        priorLocation = prof.location ?? null;
        priorPreferredTimeline = prof.preferred_timeline ?? null;
        priorExploredRoles = (prof.explored_roles ?? []).map((e) => ({
          role_name: e.role_name,
          status: (e.status as RoleHistoryEntry["status"]) ?? "explored",
          first_seen_at: e.first_seen_at,
        }));
        priorPlan = prof.prior_plan ?? null;
      }
      // C3: pull up to 3 episodic summaries for multi-session recall.
      try {
        priorEpisodicSummaries = listRecentEpisodic(profileDb, userId, 3);
        if (priorEpisodicSummaries.length > 0) {
          isReturningUser = true;
          if (userPersona === "new_user") userPersona = "returning_continue";
        }
      } catch (e) {
        console.warn("listRecentEpisodic failed:", (e as Error).message);
      }
    }

    // restart_pivot flips persona to "returning_restart" — the server builds
    // the first-turn state as if the user already chose "New direction, keep
    // my profile". The speaker opener adjusts accordingly.
    if (restartPivot && userPersona !== "new_user") {
      userPersona = "returning_restart";
      isReturningUser = false; // suppress the welcome-back prompt
      priorSessionSummary = "";
      priorEpisodicSummaries = [];
    }

    let state = await graph.invoke({
      sessionId,
      userId,
      startedAt: Date.now(),
      userMessage: "",
      turnType: "first_turn",
      userPersona,
      isReturningUser,
      priorSessionSummary,
      priorEpisodicSummaries,
      conversationSummary: priorSessionSummary,
      // Preloaded profile facts (BR-12: no re-asking known info).
      targetRole: restartPivot ? null : priorTargetRole,
      previousTargetRole: restartPivot ? priorTargetRole : null,
      jobTitle: priorJobTitle,
      industry: priorIndustry,
      educationLevel: priorEducation,
      yearsExperience: priorYearsExperience,
      location: priorLocation,
      preferredTimeline: priorPreferredTimeline,
      exploredRoles: priorExploredRoles,
      priorPlan,
    }, {
      runName: "career-guidance-session-start",
      tags: ["first_turn", "session_init", userPersona],
      metadata: { sessionId, userId: userId ?? undefined, userPersona },
    });

    if (userId) state = { ...state, userId };

    saveSession(sessionId, state);

    const sessionParsed = parseSuggestions(state.speakerOutput ?? "");
    res.json({
      sessionId,
      message: sessionParsed.message,
      phase: state.currentPhase,
      userId: state.userId,
      suggestions: sessionParsed.suggestions,
      userPersona,
      // Profile recap payload so the frontend can render the recap card.
      profileRecap: isReturningUser || restartPivot
        ? {
            jobTitle: priorJobTitle,
            industry: priorIndustry,
            yearsExperience: priorYearsExperience,
            educationLevel: priorEducation,
            location: priorLocation,
            preferredTimeline: priorPreferredTimeline,
            previousTargetRole: priorTargetRole,
            priorPlanExists: priorPlan !== null,
          }
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Send a message
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    res.status(400).json({ error: "sessionId and message are required" });
    return;
  }

  let state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found. Please start a new session." });
    return;
  }

  // Returning-user resume/fresh intercept. Runs only on the very first user
  // turn of a returning session (before any graph invoke this session), in
  // response to the "resume or start fresh?" prompt emitted by the welcome-back
  // message in speaker-prompt-creator.ts.
  if (state.isReturningUser && state.resumeChoice === null && state.turnNumber === 0) {
    const intent = detectResumeIntent(message);
    if (intent === "fresh") {
      state = applyFreshStart(state);
      saveSession(sessionId, state);
    } else if (intent === "resume") {
      state = { ...state, resumeChoice: "resume" };
      saveSession(sessionId, state);
    }
    // If intent === null, let the graph clarify naturally.
  }

  try {
    let newState = await graph.invoke({
      ...state,
      userMessage: message,
      turnType: "standard",
      conversationHistory: [
        ...state.conversationHistory,
        { role: "user" as const, content: message, timestamp: Date.now() },
      ],
      analyzerPrompt: "",
      analyzerOutput: null,
      speakerPrompt: "",
      speakerOutput: "",
      newPhase: null,
      error: null,
    }, {
      runName: "career-guidance-chat-turn",
      tags: ["chat_turn", state.currentPhase],
      metadata: {
        sessionId,
        phase: state.currentPhase,
        turnNumber: state.turnNumber,
        targetRole: state.targetRole ?? undefined,
      },
    });

    // Summarization now runs inside the graph as the `summarizer` node (G2),
    // so server-side invocation is no longer needed.

    saveSession(sessionId, newState);
    persistUserProfile(newState, sessionId);

    const chatParsed = parseSuggestions(newState.speakerOutput ?? "");
    res.json({
      message: chatParsed.message,
      phase: newState.currentPhase,
      phaseDisplay: config.phaseRegistry.phases[newState.currentPhase]?.display_name ?? newState.currentPhase,
      isComplete: newState.transitionDecision === "complete",
      turnNumber: newState.turnNumber,
      profile: {
        jobTitle: newState.jobTitle,
        industry: newState.industry,
        yearsExperience: newState.yearsExperience,
        educationLevel: newState.educationLevel,
        targetRole: newState.targetRole,
      },
      skillsMeta: buildSkillsMeta(newState),
      progressItems: newState.progressItems ?? [],
      suggestions: chatParsed.suggestions,
    });
  } catch (e) {
    console.error("Chat error:", (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Slice S-C (Sr 19B, 24): resume upload — plain-text only, three fields.
app.post("/api/upload", (req, res) => {
  const { sessionId, text } = req.body ?? {};
  if (!sessionId || typeof text !== "string") {
    res.status(400).json({ error: "sessionId and text are required" });
    return;
  }
  const state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const extract = parseResumeText(text);
  const merged: AgentStateType = {
    ...state,
    resumeName: extract.name ?? state.resumeName ?? null,
    resumeYears: extract.years ?? state.resumeYears ?? null,
    resumeDomain: extract.domain ?? state.resumeDomain ?? null,
    yearsExperience: state.yearsExperience ?? extract.years ?? null,
    industry: state.industry ?? extract.domain ?? null,
  };
  saveSession(sessionId, merged);
  res.json({ ok: true, extract });
});

// Export report
app.post("/api/export", async (req, res) => {
  const { sessionId, format } = req.body;

  const state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // JSON evidence pack export
  if (format === "json") {
    try {
      const withReport = { ...state, reportGenerated: true };
      saveSession(sessionId, withReport);
      const evidencePack = buildEvidencePack(withReport);
      writeEvidencePackFile(ROOT, withReport);

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="evidence-pack-${sessionId}.json"`);
      res.send(JSON.stringify(evidencePack, null, 2));
      return;
    } catch (e) {
      console.error("JSON export error:", (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
      return;
    }
  }

  try {
    const pdfPath = await generatePDFReport(state);
    const htmlPath = generateHTMLReport(state);
    writeEvidencePackFile(ROOT, { ...state, reportGenerated: true });

    saveSession(sessionId, { ...state, reportGenerated: true });

    res.json({
      pdf: `/exports/career-plan-${sessionId}.pdf`,
      html: `/exports/career-plan-${sessionId}.html`,
    });
  } catch (e) {
    console.error("Export error:", (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Serve exported files (HTML "view in browser" path retained for backwards
// compatibility). PDF downloads should go through /api/report/:sessionId.pdf
// instead — see Change 6 note below.
app.use("/exports", express.static(join(ROOT, "exports")));

// Change 6 (Apr 16 2026): dedicated PDF download endpoint.
// Fixes user-reported "message says report ready but cannot download it" bug.
// Root causes addressed:
//   1) Frontend previously only opened the HTML in a new tab (pop-up blockers
//      could kill it). This endpoint returns a real file with
//      Content-Disposition: attachment so browsers show a save dialog.
//   2) Render free-tier disk is ephemeral — a file written on one request
//      can be wiped before the user clicks. We regenerate on every call so
//      the download is immune to disk wipes.
// Keeps /api/export unchanged so existing HTML-view flows keep working.
app.get("/api/report/:sessionId.pdf", async (req, res) => {
  const { sessionId } = req.params;
  const state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  try {
    const pdfPath = await generatePDFReport(state);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="career-plan-${sessionId}.pdf"`,
    );
    res.sendFile(pdfPath, (err) => {
      if (err) {
        console.error("PDF sendFile error:", (err as Error).message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream PDF" });
        }
      }
    });
  } catch (e) {
    console.error("PDF download error:", (e as Error).message);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// Get session info
app.get("/api/session/:sessionId", (req, res) => {
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({
    phase: state.currentPhase,
    phaseDisplay: config.phaseRegistry.phases[state.currentPhase]?.display_name ?? state.currentPhase,
    turnNumber: state.turnNumber,
    profile: {
      jobTitle: state.jobTitle,
      industry: state.industry,
      yearsExperience: state.yearsExperience,
      educationLevel: state.educationLevel,
      targetRole: state.targetRole,
    },
    skillsMeta: buildSkillsMeta(state),
  });
});

// Evidence pack (structured JSON view for UI)
app.get("/api/session/:sessionId/evidence", (req, res) => {
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(buildEvidencePack(state));
});

// User progress checklist (plan Week 6)
app.patch("/api/session/:sessionId/progress", (req, res) => {
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const raw = req.body?.items;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "items array required" });
    return;
  }
  const items: ProgressItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const label = typeof o.label === "string" ? o.label : "";
    const done = Boolean(o.done);
    if (!id || !label) continue;
    items.push({ id, label, done });
  }
  state.progressItems = items;
  saveSession(req.params.sessionId, state);
  res.json({ ok: true, progressItems: state.progressItems });
});

// Episodic summaries for a user (when userId was used)
app.get("/api/profile/:userId/episodic", (req, res) => {
  if (!profileDb) {
    res.json({ summaries: [] });
    return;
  }
  const uid = req.params.userId.slice(0, 128);
  res.json({ summaries: listRecentEpisodic(profileDb, uid, 8) });
});

// Get session history (for returning users)
app.get("/api/session/:sessionId/history", (req, res) => {
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({
    sessionId: req.params.sessionId,
    phase: state.currentPhase,
    phaseDisplay: config.phaseRegistry.phases[state.currentPhase]?.display_name ?? state.currentPhase,
    turnNumber: state.turnNumber,
    conversationHistory: state.conversationHistory ?? [],
    profile: {
      jobTitle: state.jobTitle,
      industry: state.industry,
      yearsExperience: state.yearsExperience,
      educationLevel: state.educationLevel,
      targetRole: state.targetRole,
    },
    isComplete: state.transitionDecision === "complete",
  });
});

// Health (for uptime checks and deploy verification)
app.get("/api/health", (_req, res) => {
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { version?: string };
    version = pkg.version ?? "unknown";
  } catch {
    /* ignore */
  }
  res.json({
    ok: true,
    service: "career-guidance-ai",
    version,
    time: new Date().toISOString(),
  });
});

// Data source status
app.get("/api/data-sources", (_req, res) => {
  res.json({
    // O*NET Web Services v2 uses X-API-Key from ONET_USERNAME only (see services/onet.ts)
    onet: { connected: !!process.env.ONET_USERNAME, label: "O*NET" },
    bls: { connected: !!process.env.BLS_API_KEY, label: "BLS" },
    usajobs: { connected: !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL), label: "USAJOBS" },
    localData: { connected: true, label: "Local O*NET Cache" },
  });
});

// --- Skills Dashboard: session summary ---
app.get("/api/session/:sessionId/summary", (req, res) => {
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Compute gap stats from skills array
  const skills = state.skills ?? [];
  const assessed = skills.filter((s: any) => s.user_rating !== null && s.user_rating !== undefined);
  const gaps = skills.filter((s: any) => s.gap_category === "absent" || s.gap_category === "underdeveloped");
  const topGaps = gaps.slice(0, 3).map((s: any) => ({
    skill: s.skill_name,
    gap: s.gap_category,
    required: s.required_proficiency,
  }));

  res.json({
    sessionId: req.params.sessionId,
    phase: state.currentPhase,
    phaseDisplay: config.phaseRegistry.phases[state.currentPhase]?.display_name ?? state.currentPhase,
    turnNumber: state.turnNumber,
    profile: {
      jobTitle: state.jobTitle,
      industry: state.industry,
      yearsExperience: state.yearsExperience,
      educationLevel: state.educationLevel,
      targetRole: state.targetRole,
    },
    skills: skills.map((s: any) => ({
      name: s.skill_name,
      onetSource: s.onet_source ?? null,
      requiredProficiency: s.required_proficiency ?? null,
      userRating: s.user_rating ?? null,
      gapCategory: s.gap_category ?? null,
    })),
    metrics: {
      totalSkills: skills.length,
      assessed: assessed.length,
      gaps: gaps.length,
      topGaps,
    },
    candidateDirections: state.candidateDirections ?? [],
    interests: state.interests ?? [],
    isComplete: state.transitionDecision === "complete",
    skillsAssessed: skills.length > 0 && skills.some((s: any) => s.user_rating !== null),
    assessmentStatus: (state as any).skillsAssessmentStatus ?? "not_started",
  });
});

// --- Explore Careers: search occupations ---
// Load local occupations cache for fallback
let localOccupations: any[] = [];
try {
  localOccupations = JSON.parse(readFileSync(join(ROOT, "data", "occupations.json"), "utf-8"));
} catch { /* ignore */ }

app.get("/api/careers/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) {
    // Return all local occupations when no query
    res.json({
      results: localOccupations.map((o: any) => ({
        code: o.soc_code,
        title: o.title,
        description: o.description,
        source: "local_cache",
        skillCount: o.skills?.length ?? 0,
      })),
      source: "local_cache",
    });
    return;
  }

  // Try live O*NET first
  if (process.env.ONET_USERNAME) {
    try {
      const results = await searchOccupations(q);
      if (results.length > 0) {
        res.json({
          results: results.map((o) => ({
            code: o.code,
            title: o.title,
            description: o.description ?? "",
            source: "onet_live",
          })),
          source: "onet_live",
        });
        return;
      }
    } catch (e) {
      console.warn("O*NET search failed, falling back to local:", (e as Error).message);
    }
  }

  // Fall back to local search
  const lower = q.toLowerCase();
  const matched = localOccupations.filter((o: any) =>
    o.title.toLowerCase().includes(lower) ||
    o.description.toLowerCase().includes(lower) ||
    o.soc_code.includes(q)
  );
  res.json({
    results: matched.map((o: any) => ({
      code: o.soc_code,
      title: o.title,
      description: o.description,
      source: "local_cache",
      skillCount: o.skills?.length ?? 0,
    })),
    source: "local_cache",
  });
});

// --- Explore Careers: set target role from shortlist ---
app.post("/api/session/:sessionId/target-role", (req, res) => {
  const { title, code } = req.body;
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  state.targetRole = title;
  saveSession(req.params.sessionId, state);
  res.json({ success: true, targetRole: title, code });
});

// --- Change 4: explicit role-switch endpoint (BR-9) ---
// Archives current targetRole → previousTargetRole, snapshots the current plan
// to priorPlan (if any), clears path state so the next chat turn auto-fetches
// skills for the new role, and sets roleSwitchContext so the speaker can
// deliver the rehydration recap before resuming assessment.
app.post("/api/session/:sessionId/role-switch", async (req, res) => {
  const { to_role } = req.body ?? {};
  if (typeof to_role !== "string" || !to_role.trim()) {
    res.status(400).json({ error: "to_role is required" });
    return;
  }
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const fromRole = state.targetRole ?? null;
  if (fromRole && fromRole.trim().toLowerCase() === to_role.trim().toLowerCase()) {
    res.json({ ok: true, noop: true, message: "Already targeting that role." });
    return;
  }

  // Snapshot the plan if the user already generated one for the prior role.
  const priorPlanSnapshot: PriorPlanSnapshot | null =
    fromRole && (state.recommendedPath || (state.skillDevelopmentAgenda ?? []).length > 0)
      ? {
          target_role: fromRole,
          generated_at: Date.now(),
          recommended_path: state.recommendedPath ?? null,
          skill_development_agenda: state.skillDevelopmentAgenda ?? [],
          immediate_next_steps: state.immediateNextSteps ?? [],
          timeline: state.timeline ?? null,
        }
      : state.priorPlan;

  // Fetch fresh skills for the new target role so we can rehydrate ratings.
  let newSkills: AgentStateType["skills"] = [];
  try {
    newSkills = await retrieveSkillsForRole(to_role.trim());
  } catch (e) {
    console.warn("retrieveSkillsForRole failed during role switch:", (e as Error).message);
  }

  // Rehydrate from the prior role's current ratings.
  const priorRatings = state.skills.filter((s) => s.user_rating !== null);
  const priorLut = new Map(
    priorRatings.map((s) => [s.skill_name.toLowerCase().trim(), s.user_rating])
  );
  let rehydratedCount = 0;
  const sharedSkills: string[] = [];
  const rehydratedSkills = newSkills.map((s) => {
    const match = priorLut.get(s.skill_name.toLowerCase().trim());
    if (match) {
      rehydratedCount += 1;
      sharedSkills.push(s.skill_name);
      return { ...s, user_rating: match };
    }
    return s;
  });

  const exploredUpdate: RoleHistoryEntry[] = fromRole
    ? [
        ...state.exploredRoles,
        {
          role_name: fromRole,
          status: "deprioritized" as const,
          first_seen_at: Date.now(),
        },
      ]
    : state.exploredRoles;

  const switchContext: RoleSwitchContext = {
    from_role: fromRole ?? "(unset)",
    to_role: to_role.trim(),
    shared_skills: sharedSkills,
    rehydrated_ratings: rehydratedCount,
    initiated_at: Date.now(),
  };

  const updated: AgentStateType = {
    ...state,
    targetRole: to_role.trim(),
    previousTargetRole: fromRole,
    priorPlan: priorPlanSnapshot,
    skills: rehydratedSkills,
    skillsAssessmentStatus: rehydratedSkills.length > 0 && rehydratedCount === rehydratedSkills.length ? "complete" : rehydratedSkills.length > 0 ? "in_progress" : "not_started",
    learningNeedsComplete: false,
    userConfirmedEvaluation: false,
    skillsEvaluationSummary: null,
    recommendedPath: null,
    timeline: null,
    skillDevelopmentAgenda: [],
    immediateNextSteps: [],
    planRationale: null,
    planBlocks: [],
    exploredRoles: exploredUpdate,
    roleSwitchContext: switchContext,
    roleSwitchAcknowledged: false,
    roleComparisonContext: null,
    currentPhase: "exploration_role_targeting",
  };
  saveSession(req.params.sessionId, updated);
  res.json({
    ok: true,
    from_role: fromRole,
    to_role: to_role.trim(),
    shared_skills_count: sharedSkills.length,
    rehydrated_count: rehydratedCount,
    prior_plan_saved: priorPlanSnapshot !== null,
  });
});

// --- Change 4: role comparison endpoint (BR-10) ---
// Hard cap of 2 roles. Populates roleComparisonContext with shared/unique
// skill splits so the speaker can present a structured comparison with a
// reasoned priority recommendation.
app.post("/api/session/:sessionId/role-compare", async (req, res) => {
  const { role_a, role_b } = req.body ?? {};
  if (typeof role_a !== "string" || typeof role_b !== "string" || !role_a.trim() || !role_b.trim()) {
    res.status(400).json({ error: "role_a and role_b are required" });
    return;
  }
  if (role_a.trim().toLowerCase() === role_b.trim().toLowerCase()) {
    res.status(400).json({ error: "Cannot compare a role with itself" });
    return;
  }
  const state = loadSession(req.params.sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  let compared;
  try {
    compared = await compareTwoRoles(role_a.trim(), role_b.trim());
  } catch (e) {
    res.status(502).json({ error: `compareTwoRoles failed: ${(e as Error).message}` });
    return;
  }

  const comparisonContext: RoleComparisonContext = {
    role_a: role_a.trim(),
    role_b: role_b.trim(),
    shared_skills: compared.shared.map((s) => s.skill_name),
    unique_a: compared.uniqueA.map((s) => s.skill_name),
    unique_b: compared.uniqueB.map((s) => s.skill_name),
    recommended_priority: null, // speaker fills this in based on background
    rationale: null,
  };

  const updated: AgentStateType = {
    ...state,
    comparedRoles: [role_a.trim(), role_b.trim()],
    roleComparisonContext: comparisonContext,
  };
  saveSession(req.params.sessionId, updated);
  res.json({
    ok: true,
    role_a: role_a.trim(),
    role_b: role_b.trim(),
    shared_skills: comparisonContext.shared_skills,
    unique_a: comparisonContext.unique_a,
    unique_b: comparisonContext.unique_b,
  });
});

// --- Resources: curated recommendations ---
let curatedResources: any[] = [];
try {
  curatedResources = JSON.parse(readFileSync(join(ROOT, "data", "curated-resources.json"), "utf-8"));
} catch { /* ignore */ }

app.get("/api/resources", (req, res) => {
  const role = (req.query.role as string || "").toLowerCase();
  const skillsParam = req.query.skills as string || "";
  const skillFilter = skillsParam ? skillsParam.split(",").map((s) => s.trim().toLowerCase()) : [];
  const typeFilter = req.query.type as string || ""; // "free" or "paid"

  let results = [...curatedResources];

  // Filter by type if specified
  if (typeFilter === "free" || typeFilter === "paid") {
    results = results.filter((r) => r.type === typeFilter);
  }

  // Score relevance based on skill/domain match
  results = results.map((r) => {
    let score = 0;
    const rSkills = (r.skills || []).map((s: string) => s.toLowerCase());
    const rDomains = (r.domains || []).map((d: string) => d.toLowerCase());

    for (const sk of skillFilter) {
      if (rSkills.some((rs: string) => rs.includes(sk) || sk.includes(rs))) score += 2;
    }
    if (role) {
      if (rDomains.some((d: string) => role.includes(d) || d.includes(role))) score += 1;
      if (r.title.toLowerCase().includes(role)) score += 1;
    }
    return { ...r, _score: score };
  });

  // Sort: free first, then by relevance score descending
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "free" ? -1 : 1;
    return b._score - a._score;
  });

  // Remove internal score
  const cleaned = results.map(({ _score, ...rest }) => rest);

  res.json({
    results: cleaned,
    total: cleaned.length,
    filters: { role: role || null, skills: skillFilter, type: typeFilter || null },
  });
});

// P6b: warm RAG synchronously BEFORE accepting traffic so the first /api/chat
// can't race the embeddings.json parse and bounce off Render's edge proxy.
try {
  warmupRag();
} catch (e) {
  console.warn("RAG warmup failed:", (e as Error).message);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const tracingEnabled = process.env.LANGCHAIN_TRACING_V2 === "true" && !!process.env.LANGCHAIN_API_KEY;
  const tracingProject = process.env.LANGCHAIN_PROJECT || "career-guidance-ai";

  console.log(`\n  Career Guidance Assistant`);
  console.log(`  ========================`);
  console.log(`  Open in browser: http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api`);
  console.log(`  LangSmith: ${tracingEnabled ? `ENABLED (project: ${tracingProject})` : "disabled"}`);
  console.log(`  O*NET API: ${process.env.ONET_USERNAME ? "configured" : "local fallback"}`);
  console.log(`  BLS API: ${process.env.BLS_API_KEY ? "configured" : "not set"}`);
  console.log(`  USAJOBS API: ${process.env.USAJOBS_API_KEY ? "configured" : "not set"}`);
  console.log(`  Press Ctrl+C to stop\n`);

});
