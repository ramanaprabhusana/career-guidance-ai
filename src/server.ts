import express from "express";
import cors from "cors";
import compression from "compression";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { buildGraph } from "./graph.js";
import { config } from "./config.js";
import { generatePDFReport } from "./report/pdf-generator.js";
import { generateHTMLReport } from "./report/html-generator.js";
import { searchOccupations } from "./services/onet.js";
import type { AgentStateType } from "./state.js";
import { categorizeSkillType } from "./utils/rag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function saveSession(id: string, state: AgentStateType): void {
  sessions.set(id, state);
  try {
    writeFileSync(join(SESSION_DIR, `${id}.json`), JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist session:", (e as Error).message);
  }
}

function migrateSession(state: any): AgentStateType {
  // Derive skillsAssessmentStatus for sessions created before this field existed
  if (state.skillsAssessmentStatus === undefined) {
    const skills = state.skills ?? [];
    const rated = skills.filter((s: any) => s.user_rating !== null).length;
    if (skills.length === 0 || rated === 0) {
      state.skillsAssessmentStatus = "not_started";
    } else if (rated / skills.length >= 0.6) {
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

  return state as AgentStateType;
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
  // Check memory first
  const mem = sessions.get(id);
  if (mem) return migrateSession(mem);

  // Try disk
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
app.post("/api/session", async (_req, res) => {
  const sessionId = uuidv4();

  try {
    const state = await graph.invoke({
      sessionId,
      startedAt: Date.now(),
      userMessage: "",
      turnType: "first_turn",
    }, {
      runName: "career-guidance-session-start",
      tags: ["first_turn", "session_init"],
      metadata: { sessionId },
    });

    saveSession(sessionId, state);

    res.json({
      sessionId,
      message: state.speakerOutput,
      phase: state.currentPhase,
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

  const state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found. Please start a new session." });
    return;
  }

  try {
    const newState = await graph.invoke({
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

    saveSession(sessionId, newState);

    res.json({
      message: newState.speakerOutput,
      phase: newState.currentPhase,
      phaseDisplay: config.phaseRegistry.phases[newState.currentPhase]?.display_name ?? newState.currentPhase,
      isComplete: newState.transitionDecision === "complete",
      profile: {
        jobTitle: newState.jobTitle,
        industry: newState.industry,
        yearsExperience: newState.yearsExperience,
        educationLevel: newState.educationLevel,
        targetRole: newState.targetRole,
      },
      skillsMeta: buildSkillsMeta(newState),
    });
  } catch (e) {
    console.error("Chat error:", (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Export report
app.post("/api/export", async (req, res) => {
  const { sessionId } = req.body;

  const state = loadSession(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  try {
    const pdfPath = await generatePDFReport(state);
    const htmlPath = generateHTMLReport(state);

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

// Serve exported files
app.use("/exports", express.static(join(ROOT, "exports")));

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

// Data source status
app.get("/api/data-sources", (_req, res) => {
  res.json({
    onet: { connected: !!(process.env.ONET_USERNAME && process.env.ONET_PASSWORD), label: "O*NET" },
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
