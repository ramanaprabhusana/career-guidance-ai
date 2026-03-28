/**
 * O*NET Web Services API v2 connector
 * Docs: https://services.onetcenter.org/reference/
 * Auth: X-API-Key header (not Basic Auth)
 * Base: https://api-v2.onetcenter.org
 */

const ONET_BASE = "https://api-v2.onetcenter.org";

function getApiKey(): string {
  // In v2, ONET_USERNAME holds the API key (kept for .env backwards compatibility)
  const key = process.env.ONET_USERNAME;
  if (!key) throw new Error("ONET_USERNAME (API key) required in .env");
  return key;
}

async function onetFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${ONET_BASE}${path}`, {
    headers: {
      "X-API-Key": getApiKey(),
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`O*NET API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface OnetOccupation {
  code: string;
  title: string;
  description?: string;
  tags?: Record<string, boolean>;
}

export interface OnetSkill {
  id?: string;
  name: string;
  description?: string;
  score?: { value: string; scale_name: string };
}

export interface OnetKnowledge {
  id?: string;
  name: string;
  description?: string;
  score?: { value: string; scale_name: string };
}

export interface OnetTask {
  id?: string;
  name?: string;
  statement?: string;
  score?: { value: string };
}

/** Search occupations by keyword */
export async function searchOccupations(keyword: string): Promise<OnetOccupation[]> {
  const data = await onetFetch<{ occupation?: OnetOccupation[] }>(
    `/online/search?keyword=${encodeURIComponent(keyword)}&end=10`
  );
  return data.occupation ?? [];
}

/** Get skills for an occupation by SOC code */
export async function getOccupationSkills(socCode: string): Promise<OnetSkill[]> {
  const data = await onetFetch<{ element?: OnetSkill[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/skills`
  );
  return data.element ?? [];
}

/** Get knowledge areas for an occupation */
export async function getOccupationKnowledge(socCode: string): Promise<OnetKnowledge[]> {
  const data = await onetFetch<{ element?: OnetKnowledge[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/knowledge`
  );
  return data.element ?? [];
}

/** Get tasks for an occupation */
export async function getOccupationTasks(socCode: string): Promise<OnetTask[]> {
  const data = await onetFetch<{ element?: OnetTask[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/tasks`
  );
  return data.element ?? [];
}

/** Get full occupation details */
export async function getOccupationDetails(socCode: string): Promise<{
  code: string;
  title: string;
  description: string;
}> {
  return onetFetch(`/online/occupations/${encodeURIComponent(socCode)}`);
}

/** Get technology skills (v2-specific) */
export async function getOccupationTechSkills(socCode: string): Promise<
  { title: string; examples: string[] }[]
> {
  const data = await onetFetch<{
    category?: { title: string; example?: { title: string; hot_technology?: boolean }[] }[];
  }>(`/online/occupations/${encodeURIComponent(socCode)}/summary/technology_skills`);

  return (data.category ?? []).map((cat) => ({
    title: cat.title,
    examples: (cat.example ?? []).map((ex) => ex.title),
  }));
}

/** Search + get skills for a role name (convenience) */
export async function getSkillsForRole(roleName: string): Promise<{
  socCode: string;
  title: string;
  skills: OnetSkill[];
  knowledge: OnetKnowledge[];
} | null> {
  try {
    const occupations = await searchOccupations(roleName);
    if (occupations.length === 0) return null;

    const best = occupations[0];
    const [skills, knowledge] = await Promise.all([
      getOccupationSkills(best.code),
      getOccupationKnowledge(best.code),
    ]);

    return { socCode: best.code, title: best.title, skills, knowledge };
  } catch (e) {
    console.warn(`O*NET lookup failed for "${roleName}":`, (e as Error).message);
    return null;
  }
}
