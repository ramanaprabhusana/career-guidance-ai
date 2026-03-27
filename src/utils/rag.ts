import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import type { SkillAssessment } from "../state.js";

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
 * Retrieve skills for a target role from O*NET occupation data.
 * Returns pre-populated SkillAssessment array with user_rating = null.
 */
export async function retrieveSkillsForRole(targetRole: string): Promise<SkillAssessment[]> {
  loadData();

  if (!cachedOccupations || cachedOccupations.length === 0) {
    return [];
  }

  // Find best matching occupation
  const normalizedTarget = targetRole.toLowerCase();
  let bestMatch: OccupationProfile | null = null;
  let bestScore = 0;

  for (const occ of cachedOccupations) {
    const title = occ.title.toLowerCase();
    // Simple matching: exact substring, word overlap
    if (title.includes(normalizedTarget) || normalizedTarget.includes(title)) {
      bestMatch = occ;
      bestScore = 1;
      break;
    }

    // Word overlap score
    const targetWords = normalizedTarget.split(/\s+/);
    const titleWords = title.split(/\s+/);
    const overlap = targetWords.filter((w) => titleWords.some((tw) => tw.includes(w) || w.includes(tw))).length;
    const score = overlap / Math.max(targetWords.length, titleWords.length);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = occ;
    }
  }

  if (!bestMatch || bestScore < 0.2) {
    // Fallback: use embeddings to find closest occupation
    try {
      const results = await retrieveChunks(`skills for ${targetRole}`, 1);
      if (results.length > 0) {
        // Try to find occupation from chunk content
        for (const occ of cachedOccupations) {
          if (results[0].content.includes(occ.title)) {
            bestMatch = occ;
            break;
          }
        }
      }
    } catch {
      // Embedding service unavailable
    }
  }

  if (!bestMatch) return [];

  // Convert to SkillAssessment array
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
 */
export function getLaborMarketData(targetRole: string): {
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
