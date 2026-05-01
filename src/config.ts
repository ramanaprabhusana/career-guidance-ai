import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
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
  provider: "google" | "groq";
  analyzerModel: string;
  speakerModel: string;
  groqAnalyzerModel: string;
  groqSpeakerModel: string;
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
    analyzerModel: "gemini-2.5-flash-lite",
    speakerModel: "gemini-2.5-flash",
    groqAnalyzerModel: "llama-3.1-8b-instant",
    groqSpeakerModel: "llama-3.1-8b-instant",
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

type LlmProvider = "google" | "groq";
type ChatModelLike = {
  invoke(input: BaseMessage[]): Promise<{ content: unknown }>;
};

// Cached model instances — created once at startup, reused every turn.
const _modelCache = new Map<string, ChatModelLike>();

function normalizeProvider(value: string | undefined): LlmProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "google" || normalized === "gemini") return "google";
  if (normalized === "groq") return "groq";
  return null;
}

export function getProviderSequence(): LlmProvider[] {
  const sequence = process.env.LLM_PROVIDER_SEQUENCE
    ?.split(",")
    .map((provider) => normalizeProvider(provider))
    .filter((provider): provider is LlmProvider => provider !== null);
  if (sequence?.length) return sequence;

  const forced = normalizeProvider(process.env.LLM_PROVIDER);
  return forced ? [forced] : ["google"];
}

export function hasConfiguredLLMProvider(): boolean {
  return getProviderSequence().some((provider) => {
    if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
    return Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  });
}

function createProviderModel(
  provider: LlmProvider,
  purpose: "analyzer" | "speaker",
  config: AppConfig,
): ChatModelLike {
  const temperature = purpose === "analyzer"
    ? config.analyzerTemperature
    : config.speakerTemperature;

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY environment variable is required for Groq");
    return new ChatOpenAI({
      model: purpose === "analyzer"
        ? (process.env.GROQ_ANALYZER_MODEL || process.env.GROQ_MODEL || config.groqAnalyzerModel)
        : (process.env.GROQ_SPEAKER_MODEL || process.env.GROQ_MODEL || config.groqSpeakerModel),
      temperature,
      apiKey,
      configuration: {
        baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      },
    });
  }

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required for Google");
  return new ChatGoogleGenerativeAI({
    model: purpose === "analyzer"
      ? (process.env.GEMINI_ANALYZER_MODEL || process.env.GEMINI_MODEL || config.analyzerModel)
      : (process.env.GEMINI_SPEAKER_MODEL || process.env.GEMINI_MODEL || config.speakerModel),
    temperature,
    apiKey,
  });
}

function createFailoverModel(
  purpose: "analyzer" | "speaker",
  config: AppConfig,
): ChatModelLike {
  const providers = getProviderSequence();
  const models = providers.map((provider) => ({
    provider,
    model: createProviderModel(provider, purpose, config),
  }));

  if (!models.length) {
    throw new Error("No valid LLM providers configured");
  }

  return {
    async invoke(input: BaseMessage[]) {
      let lastError: unknown = null;
      for (const { provider, model } of models) {
        try {
          return await model.invoke(input);
        } catch (error) {
          lastError = error;
          console.warn(`LLM provider ${provider} failed for ${purpose}; trying next provider if configured:`, (error as Error).message);
        }
      }
      throw lastError instanceof Error ? lastError : new Error("All configured LLM providers failed");
    },
  };
}

export function createChatModel(
  purpose: "analyzer" | "speaker",
  config: AppConfig
): ChatModelLike {
  const key = `${purpose}:${getProviderSequence().join(">")}`;
  if (!_modelCache.has(key)) {
    _modelCache.set(key, createFailoverModel(purpose, config));
  }
  return _modelCache.get(key)!;
}

export const config = loadConfig();
