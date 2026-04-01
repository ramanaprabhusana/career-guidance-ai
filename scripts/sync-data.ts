/**
 * Data Sync Script
 * Downloads enriched occupation data from O*NET, BLS, and USAJOBS APIs
 * into a local cache file for offline/faster access.
 *
 * Usage: npx tsx scripts/sync-data.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env
try {
  const envContent = readFileSync(join(ROOT, ".env"), "utf-8");
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

// --- O*NET v2 API ---
const ONET_BASE = "https://api-v2.onetcenter.org";

async function onetFetch<T>(path: string): Promise<T> {
  const key = process.env.ONET_USERNAME;
  if (!key) throw new Error("ONET_USERNAME required in .env");
  const res = await fetch(`${ONET_BASE}${path}`, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`O*NET ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchOnetSkills(socCode: string) {
  const data = await onetFetch<{ element?: any[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/skills`
  );
  return (data.element ?? []).map((s: any) => ({
    name: s.name,
    description: s.description,
    score: s.score?.value ?? null,
  }));
}

async function fetchOnetKnowledge(socCode: string) {
  const data = await onetFetch<{ element?: any[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/knowledge`
  );
  return (data.element ?? []).map((k: any) => ({
    name: k.name,
    description: k.description,
    score: k.score?.value ?? null,
  }));
}

async function fetchOnetTasks(socCode: string) {
  const data = await onetFetch<{ element?: any[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/details/tasks`
  );
  return (data.element ?? []).map((t: any) => t.statement ?? t.name ?? "");
}

async function fetchOnetTechSkills(socCode: string) {
  const data = await onetFetch<{ category?: any[] }>(
    `/online/occupations/${encodeURIComponent(socCode)}/summary/technology_skills`
  );
  return (data.category ?? []).map((cat: any) => ({
    title: cat.title,
    examples: (cat.example ?? []).map((ex: any) => ex.title),
  }));
}

// --- BLS API ---
const BLS_BASE = "https://api.bls.gov/publicAPI/v2";

function buildOEWSSeriesId(socCode: string, dataType: "01" | "04" | "13", stateFips = "48"): string {
  const occ = socCode.replace("-", "").replace(".", "");
  return `OEUS${stateFips}00000000000${occ}${dataType}`;
}

async function fetchBlsWages(socCode: string) {
  const apiKey = process.env.BLS_API_KEY;
  if (!apiKey) return { employment: null, meanWage: null, medianWage: null, year: null };

  const seriesIds = [
    buildOEWSSeriesId(socCode, "01"),
    buildOEWSSeriesId(socCode, "04"),
    buildOEWSSeriesId(socCode, "13"),
  ];

  const currentYear = new Date().getFullYear();
  const res = await fetch(`${BLS_BASE}/timeseries/data/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid: seriesIds,
      startyear: String(currentYear - 3),
      endyear: String(currentYear),
      registrationkey: apiKey,
    }),
  });

  if (!res.ok) return { employment: null, meanWage: null, medianWage: null, year: null };

  const data = await res.json() as any;
  if (data.status !== "REQUEST_SUCCEEDED") return { employment: null, meanWage: null, medianWage: null, year: null };

  const result: any = { employment: null, meanWage: null, medianWage: null, year: null };
  for (const s of data.Results?.series ?? []) {
    const latest = s.data?.[0];
    if (!latest) continue;
    result.year = latest.year;
    if (s.seriesID.endsWith("01")) result.employment = latest.value;
    else if (s.seriesID.endsWith("04")) result.meanWage = latest.value;
    else if (s.seriesID.endsWith("13")) result.medianWage = latest.value;
  }
  return result;
}

// --- USAJOBS API ---
async function fetchUsajobsCount(keyword: string): Promise<number> {
  const apiKey = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;
  if (!apiKey || !email) return 0;

  const params = new URLSearchParams({ Keyword: keyword, ResultsPerPage: "1" });
  const res = await fetch(`https://data.usajobs.gov/api/Search?${params}`, {
    headers: {
      Host: "data.usajobs.gov",
      "User-Agent": email,
      "Authorization-Key": apiKey,
    } as any,
  });
  if (!res.ok) return 0;
  const data = await res.json() as any;
  return data.SearchResult?.SearchResultCountAll ?? 0;
}

// --- Rate limiting ---
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main sync ---
async function main() {
  console.log("=== Career Guidance AI - Data Sync ===\n");

  // Load occupations
  const occPath = join(ROOT, "data", "occupations.json");
  const occupations = JSON.parse(readFileSync(occPath, "utf-8")) as {
    soc_code: string;
    title: string;
    description: string;
  }[];

  console.log(`Found ${occupations.length} occupations to sync.\n`);

  const enriched: any[] = [];

  for (let i = 0; i < occupations.length; i++) {
    const occ = occupations[i];
    console.log(`[${i + 1}/${occupations.length}] ${occ.title} (${occ.soc_code})`);

    const entry: any = {
      soc_code: occ.soc_code,
      title: occ.title,
      description: occ.description,
      synced_at: new Date().toISOString(),
      onet: { skills: [], knowledge: [], tasks: [], tech_skills: [] },
      bls: { employment: null, meanWage: null, medianWage: null, year: null },
      usajobs: { openPositions: 0 },
    };

    // O*NET data
    try {
      console.log("  -> O*NET skills...");
      entry.onet.skills = await fetchOnetSkills(occ.soc_code);
      await delay(500);

      console.log("  -> O*NET knowledge...");
      entry.onet.knowledge = await fetchOnetKnowledge(occ.soc_code);
      await delay(500);

      console.log("  -> O*NET tasks...");
      entry.onet.tasks = await fetchOnetTasks(occ.soc_code);
      await delay(500);

      console.log("  -> O*NET tech skills...");
      entry.onet.tech_skills = await fetchOnetTechSkills(occ.soc_code);
      await delay(500);
    } catch (e) {
      console.log(`  [WARN] O*NET failed: ${(e as Error).message}`);
    }

    // BLS wages
    try {
      console.log("  -> BLS wages...");
      entry.bls = await fetchBlsWages(occ.soc_code);
      await delay(300);
    } catch (e) {
      console.log(`  [WARN] BLS failed: ${(e as Error).message}`);
    }

    // USAJOBS count
    try {
      console.log("  -> USAJOBS count...");
      entry.usajobs.openPositions = await fetchUsajobsCount(occ.title);
      await delay(300);
    } catch (e) {
      console.log(`  [WARN] USAJOBS failed: ${(e as Error).message}`);
    }

    enriched.push(entry);
    console.log(`  Done.\n`);
  }

  // Write output
  const outPath = join(ROOT, "data", "enriched-occupations.json");
  writeFileSync(outPath, JSON.stringify(enriched, null, 2));
  console.log(`\nSync complete! Wrote ${enriched.length} enriched occupations to:`);
  console.log(`  ${outPath}`);

  // Summary
  const withSkills = enriched.filter((e) => e.onet.skills.length > 0).length;
  const withWages = enriched.filter((e) => e.bls.meanWage !== null).length;
  const withJobs = enriched.filter((e) => e.usajobs.openPositions > 0).length;
  console.log(`\nSummary:`);
  console.log(`  O*NET skills: ${withSkills}/${enriched.length}`);
  console.log(`  BLS wages: ${withWages}/${enriched.length}`);
  console.log(`  USAJOBS listings: ${withJobs}/${enriched.length}`);
}

main().catch((e) => {
  console.error("Sync failed:", e);
  process.exit(1);
});
