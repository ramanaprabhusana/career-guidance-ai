import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import type { SkillAssessment, SkillType } from "../state.js";

// --- Soft skill classification (O*NET taxonomy) ---
const SOFT_SKILLS = new Set([
  "critical thinking", "active learning", "complex problem solving",
  "judgment and decision making", "communication", "active listening",
  "social perceptiveness", "coordination", "negotiation", "persuasion",
  "time management", "monitoring", "service orientation", "leadership",
  "instructing", "management of personnel resources", "speaking",
  "writing", "reading comprehension", "learning strategies",
]);

export function categorizeSkillType(skillName: string): SkillType {
  return SOFT_SKILLS.has(skillName.toLowerCase().trim()) ? "soft" : "technical";
}

/**
 * Limit skills to top N per category (technical + soft), sorted by required proficiency.
 * Ensures assessment stays manageable (max 2*maxPerCategory skills total).
 */
function limitSkillsPerCategory(skills: SkillAssessment[], maxPerCategory: number = 4): SkillAssessment[] {
  const profOrder: Record<string, number> = { Advanced: 3, Intermediate: 2, Basic: 1 };
  const sortByProf = (a: SkillAssessment, b: SkillAssessment) =>
    (profOrder[b.required_proficiency] ?? 0) - (profOrder[a.required_proficiency] ?? 0);

  const technical = skills.filter(s => s.skill_type === "technical").sort(sortByProf);
  const soft = skills.filter(s => s.skill_type === "soft").sort(sortByProf);

  return [...technical.slice(0, maxPerCategory), ...soft.slice(0, maxPerCategory)];
}
import { getSkillsForRole as liveOnetSkills } from "../services/onet.js";
// C4: BLS wage data + USAJOBS counts are now routed through the Skill 6 tool
// dispatcher so error classification and recovery stay consistent. The service
// helpers are imported by `tool-executor.ts` directly; `enrichRoleContext`
// below dispatches via `runTool` instead of calling them inline.
import { runTool } from "../nodes/tool-executor.js";

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

// P7: tiny LRU for query embeddings. Same query string (e.g. a target role
// repeated across retrieval calls in one turn) reuses the vector instead of
// re-issuing a ~500 ms HTTP round-trip to the embedding service.
const EMBED_CACHE_MAX = 50;
const embedCache = new Map<string, number[]>();

/**
 * P6: warm caches at boot so the first role-targeting turn doesn't pay the
 * 759 KB `data/embeddings.json` parse cost inside the request path.
 */
export function warmup(): void {
  try {
    loadData();
  } catch (e) {
    console.warn("[RAG] warmup failed:", (e as Error).message);
  }
}

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
  // P7: LRU hit path. Normalize whitespace so minor formatting differences
  // still collide.
  const key = query.trim().toLowerCase();
  const hit = embedCache.get(key);
  if (hit) {
    // Re-insert to mark as most recently used (Map preserves insertion order).
    embedCache.delete(key);
    embedCache.set(key, hit);
    return hit;
  }

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
  embedCache.set(key, data.embedding);
  if (embedCache.size > EMBED_CACHE_MAX) {
    // Evict oldest (first inserted) entry.
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
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

  let queryEmb: number[];
  try {
    queryEmb = await embedQuery(query);
  } catch (e) {
    console.warn("[RAG] Embedding unavailable (e.g. Ollama not reachable):", (e as Error).message);
    return [];
  }

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

// Change 4: per-role memoization so same-session role switches don't re-hit
// O*NET. The cache stores the capped 4-tech + 4-soft result, meaning the
// rehydration path in state-updater sees the same shape regardless of whether
// the fetch was live or cached.
const skillsByRoleCache = new Map<string, SkillAssessment[]>();
const SKILL_CACHE_MAX = 30;
function skillCacheKey(role: string): string {
  return role.trim().toLowerCase();
}

/**
 * Retrieve skills for a target role.
 * Strategy: try live O*NET API first, fall back to local cached data.
 * Change 4: memoizes per normalized role name; evicts oldest when over cap.
 */
export async function retrieveSkillsForRole(targetRole: string): Promise<SkillAssessment[]> {
  const key = skillCacheKey(targetRole);
  const cached = skillsByRoleCache.get(key);
  if (cached) {
    // Return a defensive copy so callers can't mutate the cached entry.
    return cached.map((s) => ({ ...s }));
  }

  let result: SkillAssessment[] = [];
  // Try live O*NET API first (v2: API key in ONET_USERNAME; see services/onet.ts)
  if (process.env.ONET_USERNAME) {
    try {
      const liveResult = await liveOnetSkills(targetRole);
      if (liveResult && liveResult.skills.length > 0) {
        console.log(`[RAG] Live O*NET hit: ${liveResult.title} (${liveResult.socCode})`);
        const allSkills = liveResult.skills.map((skill) => ({
          skill_name: skill.name,
          onet_source: `${liveResult.socCode} - ${liveResult.title} (O*NET Live)`,
          required_proficiency: skill.score && parseFloat(skill.score.value) >= 4 ? "Advanced"
            : skill.score && parseFloat(skill.score.value) >= 3 ? "Intermediate" : "Basic",
          user_rating: null,
          gap_category: null,
          skill_type: categorizeSkillType(skill.name),
        }));
        result = limitSkillsPerCategory(allSkills);
      }
    } catch (e) {
      console.warn("[RAG] Live O*NET failed, falling back to local data:", (e as Error).message);
    }
  }

  // Fall back to local cached data if live returned nothing.
  if (result.length === 0) {
    result = retrieveSkillsFromLocal(targetRole);
  }

  // Evict oldest entry when over cap (Map preserves insertion order).
  if (skillsByRoleCache.size >= SKILL_CACHE_MAX) {
    const oldestKey = skillsByRoleCache.keys().next().value;
    if (oldestKey !== undefined) skillsByRoleCache.delete(oldestKey);
  }
  skillsByRoleCache.set(key, result.map((s) => ({ ...s })));
  return result.map((s) => ({ ...s }));
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

  const allSkills = bestMatch.skills.map((skill) => ({
    skill_name: skill.name,
    onet_source: `${bestMatch!.soc_code} - ${bestMatch!.title}`,
    required_proficiency: skill.importance >= 80 ? "Advanced" : skill.importance >= 60 ? "Intermediate" : "Basic",
    user_rating: null,
    gap_category: null,
    skill_type: categorizeSkillType(skill.name),
  }));
  return limitSkillsPerCategory(allSkills);
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

    // C4: dispatch BLS wage + USAJOBS counts through the Skill 6 tool executor
    // instead of calling the service helpers inline. The dispatcher handles
    // missing env vars and error classification uniformly.
    // P2: the two calls are independent after the O*NET SOC lookup, so run
    // them in parallel. Saves ~1–2 s on role-targeting turns.
    const [wageResult, jobsResult] = await Promise.all([
      runTool({ name: "get_wage_data", args: { socCode: onetResult.socCode } }),
      runTool({ name: "get_job_counts", args: { keyword: targetRole } }),
    ]);
    if (wageResult.ok && wageResult.data) {
      const wageData = wageResult.data as { medianWage: string | null; employment: string | null };
      if (wageData.medianWage) result.median_wage = `$${Number(wageData.medianWage).toLocaleString()}/yr`;
      if (wageData.employment) result.employment = `${Number(wageData.employment).toLocaleString()} employed`;
    }
    if (jobsResult.ok && jobsResult.data) {
      const jobData = jobsResult.data as { count: number };
      result.usajobs_count = jobData.count;
    }

    console.log(`[RAG] Live market data for ${onetResult.title}: wage=${result.median_wage}`);
    return result;
  } catch {
    return null;
  }
}

/**
 * Fetch O*NET skills for multiple roles in parallel.
 */
export async function retrieveSkillsForMultipleRoles(
  roleNames: string[]
): Promise<Record<string, SkillAssessment[]>> {
  const results: Record<string, SkillAssessment[]> = {};
  await Promise.all(
    roleNames.map(async (role) => {
      try {
        results[role] = await retrieveSkillsForRole(role);
      } catch {
        results[role] = [];
      }
    })
  );
  return results;
}

/**
 * Change 4 (BR-10): compare two roles side-by-side.
 * Returns shared skills + skills unique to each. Reuses the capped
 * retrieveSkillsForMultipleRoles result (4 tech + 4 soft per role) so
 * the comparison is bounded and doesn't need extra rate limiting.
 */
export async function compareTwoRoles(
  roleA: string,
  roleB: string,
): Promise<{
  shared: SkillAssessment[];
  uniqueA: SkillAssessment[];
  uniqueB: SkillAssessment[];
}> {
  const both = await retrieveSkillsForMultipleRoles([roleA, roleB]);
  const aSkills = both[roleA] ?? [];
  const bSkills = both[roleB] ?? [];
  const aNames = new Set(aSkills.map((s) => s.skill_name.toLowerCase().trim()));
  const bNames = new Set(bSkills.map((s) => s.skill_name.toLowerCase().trim()));
  return {
    shared: aSkills.filter((s) => bNames.has(s.skill_name.toLowerCase().trim())),
    uniqueA: aSkills.filter((s) => !bNames.has(s.skill_name.toLowerCase().trim())),
    uniqueB: bSkills.filter((s) => !aNames.has(s.skill_name.toLowerCase().trim())),
  };
}

/**
 * Blend skills across multiple roles, ranked by frequency (how many roles need it).
 * Ensures a mix of technical and soft skills.
 */
export function blendSkillsAcrossRoles(
  candidateSkills: Record<string, SkillAssessment[]>,
  limit: number = 5
): SkillAssessment[] {
  const freq = new Map<string, { count: number; skill: SkillAssessment; roles: string[] }>();

  for (const [role, skills] of Object.entries(candidateSkills)) {
    for (const skill of skills) {
      const key = skill.skill_name.toLowerCase();
      const existing = freq.get(key);
      if (existing) {
        existing.count++;
        existing.roles.push(role);
      } else {
        freq.set(key, { count: 1, skill, roles: [role] });
      }
    }
  }

  const sorted = [...freq.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const profOrder: Record<string, number> = { Advanced: 3, Intermediate: 2, Basic: 1 };
    return (profOrder[b.skill.required_proficiency] ?? 0) - (profOrder[a.skill.required_proficiency] ?? 0);
  });

  // Ensure at least 1 tech and 1 soft in the blend
  const result: SkillAssessment[] = [];
  let hasTech = false, hasSoft = false;

  for (const entry of sorted) {
    if (result.length >= limit) break;
    result.push(entry.skill);
    if (entry.skill.skill_type === "technical") hasTech = true;
    if (entry.skill.skill_type === "soft") hasSoft = true;
  }

  // If missing a category, swap the last item with the first available of that category
  if (!hasTech && result.length > 0) {
    const techEntry = sorted.find(e => e.skill.skill_type === "technical" && !result.includes(e.skill));
    if (techEntry) result[result.length - 1] = techEntry.skill;
  }
  if (!hasSoft && result.length > 0) {
    const softEntry = sorted.find(e => e.skill.skill_type === "soft" && !result.includes(e.skill));
    if (softEntry) result[result.length - 1] = softEntry.skill;
  }

  return result;
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
