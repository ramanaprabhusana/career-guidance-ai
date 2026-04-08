/**
 * Course finder (Slice S-G, Sr 27).
 *
 * Reads `data/curated-resources.json` and returns up to N matches scored by
 * skill / role overlap. This is the offline-safe path; the orchestrator can
 * later layer a `web_search` connector on top via `tool-executor.ts`.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface CourseHit {
  title: string;
  url: string;
  type: "free" | "paid";
  provider?: string;
  skills?: string[];
  domains?: string[];
  note?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

let cache: CourseHit[] | null = null;
function load(): CourseHit[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(join(ROOT, "data", "curated-resources.json"), "utf-8"));
  } catch {
    cache = [];
  }
  return cache!;
}

export interface FindCoursesArgs {
  role?: string;
  skills?: string[];
  limit?: number;
}

export function findCourses(args: FindCoursesArgs): CourseHit[] {
  const all = load();
  const role = (args.role ?? "").toLowerCase();
  const wanted = (args.skills ?? []).map((s) => s.toLowerCase());
  const limit = Math.max(1, Math.min(20, args.limit ?? 5));

  const scored = all.map((r) => {
    let score = 0;
    const rs = (r.skills ?? []).map((s) => s.toLowerCase());
    const rd = (r.domains ?? []).map((d) => d.toLowerCase());
    for (const w of wanted) {
      if (rs.some((x) => x.includes(w) || w.includes(x))) score += 2;
    }
    if (role) {
      if (rd.some((d) => role.includes(d) || d.includes(role))) score += 1;
      if (r.title.toLowerCase().includes(role)) score += 1;
    }
    return { r, score };
  });

  scored.sort((a, b) => {
    if (a.r.type !== b.r.type) return a.r.type === "free" ? -1 : 1;
    return b.score - a.score;
  });

  return scored.slice(0, limit).map(({ r }) => r);
}
