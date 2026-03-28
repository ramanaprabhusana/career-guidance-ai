/**
 * O*NET Web Services API connector
 * Docs: https://services.onetcenter.org/reference/
 */

const ONET_BASE = "https://services.onetcenter.org/ws";

function getAuth(): string {
  const user = process.env.ONET_USERNAME;
  const pass = process.env.ONET_PASSWORD;
  if (!user || !pass) throw new Error("ONET_USERNAME and ONET_PASSWORD required in .env");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function onetFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${ONET_BASE}${path}`, {
    headers: {
      Authorization: getAuth(),
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`O*NET API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface OnetOccupation {
  code: string;
  title: string;
  description: string;
  tags?: { tag: string }[];
}

export interface OnetSkill {
  id: string;
  name: string;
  description: string;
  score: { value: string; scale_name: string };
}

export interface OnetKnowledge {
  id: string;
  name: string;
  description: string;
  score: { value: string; scale_name: string };
}

export interface OnetTask {
  id: string;
  statement: string;
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
    `/online/occupations/${encodeURIComponent(socCode)}/summary/skills`
  );
  return data.element ?? [];
}

/** Get knowledge areas for an occupation */
export async function getOccupationKnowledge(socCode: string): Promise<OnetKnowledge[]> {
  const data = await onetFetch<{ element?: OnetKnowledge[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/summary/knowledge`
  );
  return data.element ?? [];
}

/** Get tasks for an occupation */
export async function getOccupationTasks(socCode: string): Promise<OnetTask[]> {
  const data = await onetFetch<{ task?: OnetTask[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/summary/tasks`
  );
  return data.task ?? [];
}

/** Get full occupation details */
export async function getOccupationDetails(socCode: string): Promise<{
  code: string;
  title: string;
  description: string;
}> {
  return onetFetch(`/online/occupations/${encodeURIComponent(socCode)}`);
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
