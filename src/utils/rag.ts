import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import type { SkillAssessment } from "../state.js";
import { getSkillsForRole as liveOnetSkills } from "../services/onet.js";
import { getWageData } from "../services/bls.js";
import { searchJobs } from "../services/usajobs.js";

interface OccupationProfile {
  soc_code: string;
  title: string;
  description: string;
  skills: { name: string; level: number; importance: number }[];
  knowledge: { name: string; level: number; importance: number }[];
  tasks: string[];
  median_wage: string;
  employment: string;
  growth_rate: string;
}

let cachedChunks: string[] | null = null;
let cachedEmbeddings: number[][] | null = null;
let cachedOccupations: OccupationProfile[] | null = null;

function loadData(): void {
  if (cachedChunks) return;

  const dataDir = config.paths.data;
  const chunksPath = join(dataDir, "chunks.json");
  const embeddingsPath = join(dataDir, "embeddings.json");
  const occupationsPath = join(dataDir, "occupations.json");

  if (!existsSync(chunksPath) || !existsSync(embeddingsPath)) {
    console.warn("RAG data not found. Run: npx tsx scripts/build-index.ts");
    cachedChunks = [];
    cachedEmbeddings = [];
    cachedOccupations = [];
    return;
  }

  cachedChunks = JSON.parse(readFileSync(chunksPath, "utf-8"));
  cachedEmbeddings = JSON.parse(readFileSync(embeddingsPath, "utf-8"));
  cachedOccupations = existsSync(occupationsPath)
    ? JSON.parse(readFileSync(occupationsPath, "utf-8"))
    : [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedQuery(query: string): Promise<number[]> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const response = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: query }),
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.statusText}`);
  }

  const data = (await response.json()) as { embedding: number[] };
  return data.embedding;
}

export interface RetrievalResult {
  content: string;
  score: number;
}

/**
 * Retrieve top-k relevant chunks for a query.
 */
export async function retrieveChunks(query: string, topK: number = 5): Promise<RetrievalResult[]> {
  loadData();

  if (!cachedChunks || cachedChunks.length === 0 || !cachedEmbeddings) {
    return [];
  }

  const queryEmb = await embedQuery(query);

  const scored = cachedEmbeddings.map((emb, idx) => ({
    idx,
    score: cosineSimilarity(emb, queryEmb),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ idx, score }) => ({
    content: cachedChunks![idx],
    score,
  }));
}

/**
 * Retrieve skills for a target role.
 * Strategy: try live O*NET API first, fall back to local cached data.
 */
export async function retrieveSkillsForRole(targetRole: string): Promise<SkillAssessment[]> {
  // Try live O*NET API first
  if (process.env.ONET_USERNAME && process.env.ONET_PASSWORD) {
    try {
      const result = await liveOnetSkills(targetRole);
      if (result && result.skills.length > 0) {
        console.log(`[RAG] Live O*NET hit: ${result.title} (${result.socCode})`);
        return result.skills.map((skill) => ({
          skill_name: skill.name,
          onet_source: `${result.socCode} - ${result.title} (O*NET Live)`,
          required_proficiency: parseFloat(skill.score.value) >= 4 ? "Advanced"
            : parseFloat(skill.score.value) >= 3 ? "Intermediate" : "Basic",
          user_rating: null,
          gap_category: null,
        }));
      }
    } catch (e) {
      console.warn("[RAG] Live O*NET failed, falling back to local data:", (e as Error).message);
    }
  }

  // Fall back to local cached data
  return retrieveSkillsFromLocal(targetRole);
}

function retrieveSkillsFromLocal(targetRole: string): SkillAssessment[] {
  loadData();

  if (!cachedOccupations || cachedOccupations.length === 0) {
    return [];
  }

  const normalizedTarget = targetRole.toLowerCase();
  let bestMatch: OccupationProfile | null = null;
  let bestScore = 0;

  for (const occ of cachedOccupations) {
    const title = occ.title.toLowerCase();
    if (title.includes(normalizedTarget) || normalizedTarget.includes(title)) {
      bestMatch = occ;
      bestScore = 1;
      break;
    }

    const targetWords = normalizedTarget.split(/\s+/);
    const titleWords = title.split(/\s+/);
    const overlap = targetWords.filter((w) => titleWords.some((tw) => tw.includes(w) || w.includes(tw))).length;
    const score = overlap / Math.max(targetWords.length, titleWords.length);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = occ;
    }
  }

  if (!bestMatch || bestScore < 0.2) return [];

  return bestMatch.skills.map((skill) => ({
    skill_name: skill.name,
    onet_source: `${bestMatch!.soc_code} - ${bestMatch!.title}`,
    required_proficiency: skill.importance >= 80 ? "Advanced" : skill.importance >= 60 ? "Intermediate" : "Basic",
    user_rating: null,
    gap_category: null,
  }));
}

/**
 * Get labor market data for a role.
 * Strategy: try live BLS API first, fall back to local cached data.
 */
export async function getLaborMarketData(targetRole: string): Promise<{
  median_wage: string;
  employment: string;
  growth_rate: string;
  usajobs_count?: number;
} | null> {
  // Try live APIs
  const liveData = await getLiveMarketData(targetRole);
  if (liveData) return liveData;

  // Fall back to local data
  return getLocalMarketData(targetRole);
}

async function getLiveMarketData(targetRole: string): Promise<{
  median_wage: string;
  employment: string;
  growth_rate: string;
  usajobs_count?: number;
} | null> {
  // Need O*NET to get SOC code first
  if (!process.env.ONET_USERNAME) return null;

  try {
    const onetResult = await liveOnetSkills(targetRole);
    if (!onetResult) return null;

    const result: { median_wage: string; employment: string; growth_rate: string; usajobs_count?: number } = {
      median_wage: "N/A",
      employment: "N/A",
      growth_rate: "N/A",
    };

    // Try BLS wage data
    if (process.env.BLS_API_KEY) {
      try {
        const wageData = await getWageData(onetResult.socCode);
        if (wageData.medianWage) result.median_wage = `$${Number(wageData.medianWage).toLocaleString()}/yr`;
        if (wageData.employment) result.employment = `${Number(wageData.employment).toLocaleString()} employed`;
      } catch { /* BLS unavailable */ }
    }

    // Try USAJOBS count
    if (process.env.USAJOBS_API_KEY) {
      try {
        const jobs = await searchJobs(targetRole, 1);
        result.usajobs_count = jobs.length > 0 ? jobs.length : 0;
      } catch { /* USAJOBS unavailable */ }
    }

    console.log(`[RAG] Live market data for ${onetResult.title}: wage=${result.median_wage}`);
    return result;
  } catch {
    return null;
  }
}

function getLocalMarketData(targetRole: string): {
  median_wage: string;
  employment: string;
  growth_rate: string;
} | null {
  loadData();

  if (!cachedOccupations) return null;

  const normalizedTarget = targetRole.toLowerCase();
  for (const occ of cachedOccupations) {
    if (occ.title.toLowerCase().includes(normalizedTarget) || normalizedTarget.includes(occ.title.toLowerCase())) {
      return {
        median_wage: occ.median_wage,
        employment: occ.employment,
        growth_rate: occ.growth_rate,
      };
    }
  }

  return null;
}
