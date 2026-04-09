/**
 * Normalized common schema for research-layer payloads (C5).
 *
 * The Jan 28 project plan calls for a "single interchange format" across
 * connectors (O*NET, BLS, USAJOBS, curated data). This file is the SSOT for
 * the shared field names so individual service modules can keep their own
 * wire-format interfaces while agreeing on one set of normalized keys
 * downstream of the tool executor.
 *
 * Rules:
 * - Use snake_case keys to match the plan's wording and the schema JSON.
 * - Keep every field nullable — connectors go down all the time; downstream
 *   code should treat missing fields as "unknown", not "zero".
 * - Do NOT put presentation strings here (e.g. "$95,000/yr"). Store raw
 *   numbers; formatting lives in the report layer.
 */

/** Stable identifier for an occupation across sources. Usually SOC code. */
export type OccupationId = string;

/** Stable identifier for a skill. Usually O*NET element id. */
export type SkillId = string;

export interface OccupationRecord {
  occupation_id: OccupationId;
  title: string;
  description: string | null;
  source: "onet_live" | "onet_cache" | "local";
}

export interface SkillRecord {
  skill_id: SkillId | null;
  skill_name: string;
  skill_type: "technical" | "soft" | "unknown";
  required_proficiency: string | null;
  onet_source: string | null;
}

export interface WageStats {
  occupation_id: OccupationId;
  median_wage_usd: number | null;
  mean_wage_usd: number | null;
  employment: number | null;
  year: string | null;
  source: "bls_oews" | "local_cache";
}

export interface JobCounts {
  keyword: string;
  count: number | null;
  sampled_at: string | null;
  source: "usajobs" | "local_cache";
}

/**
 * A single piece of research retained for the evidence pack. Mirrors the
 * `evidence_kept` / `evidence_discarded` shape in `state_schema.json` planning
 * phase, kept here so tool-executor results can be normalized before merge.
 */
export interface ResearchEvidence {
  source: string;
  detail: string;
  reason: string;
  kind: "kept" | "discarded";
}
