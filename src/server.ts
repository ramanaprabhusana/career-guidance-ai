import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { buildGraph } from "./graph.js";
import { config } from "./config.js";
import { generatePDFReport } from "./report/pdf-generator.js";
import { generateHTMLReport } from "./report/html-generator.js";
import type { AgentStateType } from "./state.js";

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

function loadSession(id: string): AgentStateType | null {
  // Check memory first
  const mem = sessions.get(id);
  if (mem) return mem;

  // Try disk
  const path = join(SESSION_DIR, `${id}.json`);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      sessions.set(id, data);
      return data;
    } catch {
      return null;
    }
  }
  return null;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(ROOT, "public")));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Career Guidance Assistant`);
  console.log(`  ========================`);
  console.log(`  Open in browser: http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api`);
  console.log(`  Press Ctrl+C to stop\n`);
});
