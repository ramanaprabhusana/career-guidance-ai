import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadJSON(relativePath: string): unknown {
  const fullPath = join(ROOT, relativePath);
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

// --- Config Types ---

export interface PhaseConfig {
  display_name: string;
  purpose: string;
  allowed_targets: string[];
  conditions: Record<string, string>;
  max_turns: number;
  auto_advance: boolean;
  order: number;
}

export interface PhaseRegistry {
  version: string;
  default_phase: string;
  phases: Record<string, PhaseConfig>;
}

export interface StateSchema {
  version: string;
  phases: Record<string, Record<string, unknown>>;
}

export interface AppConfig {
  provider: "google";
  analyzerModel: string;
  speakerModel: string;
  analyzerTemperature: number;
  speakerTemperature: number;
  maxRetries: number;
  maxConsecutiveErrors: number;
  maxTotalTurns: number;
  phaseRegistry: PhaseRegistry;
  stateSchema: StateSchema;
  fallbackMessages: Record<string, string>;
  paths: {
    root: string;
    agentConfig: string;
    prompts: string;
    skills: string;
    data: string;
    db: string;
  };
}

// --- Load Config ---

export function loadConfig(): AppConfig {
  const phaseRegistry = loadJSON("agent_config/phase_registry.json") as PhaseRegistry;
  const stateSchema = loadJSON("agent_config/state_schema.json") as StateSchema;

  return {
    provider: "google",
    analyzerModel: "gemini-2.5-pro",
    speakerModel: "gemini-2.5-pro",
    analyzerTemperature: 0,
    speakerTemperature: 0.7,
    maxRetries: 2,
    maxConsecutiveErrors: 3,
    maxTotalTurns: 50,
    phaseRegistry,
    stateSchema,
    fallbackMessages: {
      first_turn: "Welcome! I'm your Career Guidance Assistant. I'm here to help you explore career paths, identify skill gaps, and build a personalized action plan. Let's start by learning a bit about your professional background. What is your current or most recent job title?",
      standard: "I want to make sure I understand you correctly. Could you tell me a bit more about that?",
      phase_transition: "Great progress! Now let's move on to the next step in building your career plan.",
      clarification: "I want to capture that accurately. Could you clarify what you mean?",
      entity_transition: "Thanks for that assessment. Let's look at the next skill.",
      termination: "Thank you for this conversation. I've saved your progress, and you can return anytime to continue where we left off.",
    },
    paths: {
      root: ROOT,
      agentConfig: join(ROOT, "agent_config"),
      prompts: join(ROOT, "agent_config", "prompts"),
      skills: join(ROOT, "agent_config", "skills"),
      data: join(ROOT, "data"),
      db: join(ROOT, "db"),
    },
  };
}

// --- Model Factory ---

export function createChatModel(
  purpose: "analyzer" | "speaker",
  config: AppConfig
): ChatGoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY environment variable is required");
  }

  return new ChatGoogleGenerativeAI({
    model: purpose === "analyzer" ? config.analyzerModel : config.speakerModel,
    temperature: purpose === "analyzer" ? config.analyzerTemperature : config.speakerTemperature,
    apiKey,
  });
}

export const config = loadConfig();
