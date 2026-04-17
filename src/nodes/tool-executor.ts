/**
 * Tool executor (G4)
 *
 * Skills-architecture-aligned dispatch layer for "approved side effects"
 * (retrieval / connectors). The Orchestrator (`state-updater.ts`) decides
 * **whether** a tool should run; this module owns **how** it runs and what
 * it returns. Today only the role-skills retrieval call lives here, but the
 * shape generalizes to any future O*NET / BLS / USAJOBS / web-search call.
 *
 * Contract:
 * - Input: a `ToolCall` describing the tool name + minimal args.
 * - Output: a `ToolResult` with `ok`, `data`, and an optional `errorCode`
 *   from the Skill 8 catalog.
 * - This module never mutates state directly. The caller merges results.
 */

import { retrieveSkillsForRole } from "../utils/rag.js";
import type { SkillAssessment } from "../state.js";
import { AgentError, logAgentError, type ErrorCode } from "../utils/errors.js";
import { webSearch, type WebSearchResult } from "../services/web-search.js";
import { findCourses, type CourseHit, type FindCoursesArgs } from "../services/courses.js";
import { getWageData, type LaborMarketData } from "../services/bls.js";
import { searchJobs } from "../services/usajobs.js";

export type ToolName =
  | "retrieve_skills_for_role"
  | "web_search"
  | "find_courses"
  | "get_wage_data"
  | "get_job_counts";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: ToolName;
  data?: T;
  // Change 5 P0 (Apr 14 2026): widened to the full ErrorCode union so new
  // codes (RAG_BLANK_ROLE) flow through without per-tool type surgery.
  errorCode?: ErrorCode;
  detail?: string;
}

export async function runTool(call: ToolCall): Promise<ToolResult> {
  // Change 5 P0 (Apr 14 2026): structured tool-call logging so every side
  // effect lands in stderr / LangSmith with a stable shape. Crucial for the
  // golden-path regression test — we assert that RAG is only called with a
  // confirmed role, and silent side effects can't be asserted against.
  const startedAt = Date.now();
  let result: ToolResult;
  try {
    switch (call.name) {
      case "retrieve_skills_for_role":
        result = await retrieveSkillsTool(call.args);
        break;
      case "web_search":
        result = await webSearchTool(call.args);
        break;
      case "find_courses":
        result = findCoursesTool(call.args);
        break;
      case "get_wage_data":
        result = await getWageDataTool(call.args);
        break;
      case "get_job_counts":
        result = await getJobCountsTool(call.args);
        break;
      default: {
        const err = new AgentError("CONFIG_MISSING", `Unknown tool: ${call.name as string}`);
        logAgentError(err, { tool: call.name });
        result = { ok: false, tool: call.name, errorCode: "CONFIG_MISSING", detail: err.message };
      }
    }
  } catch (e) {
    // Defensive: any tool that throws through runTool should still emit a log
    // line so the caller can see the failure shape. Re-throw so caller sees it.
    logToolCall(call.name, false, Date.now() - startedAt, "CONFIG_MISSING");
    throw e;
  }
  logToolCall(call.name, result.ok, Date.now() - startedAt, result.errorCode);
  return result;
}

function logToolCall(
  tool: string,
  ok: boolean,
  latencyMs: number,
  errorCode?: string,
): void {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "info",
      event: "tool_call",
      tool,
      ok,
      latency_ms: latencyMs,
      ...(errorCode ? { error_code: errorCode } : {}),
    }),
  );
}

async function webSearchTool(args: Record<string, unknown>): Promise<ToolResult<WebSearchResult>> {
  const query = typeof args.query === "string" ? args.query : "";
  const result = await webSearch(query);
  if (!result.ok) {
    return { ok: false, tool: "web_search", data: result, errorCode: "RAG_RETRIEVAL_EMPTY", detail: result.detail };
  }
  return { ok: true, tool: "web_search", data: result };
}

function findCoursesTool(args: Record<string, unknown>): ToolResult<CourseHit[]> {
  const role = typeof args.role === "string" ? args.role : "";
  const skills = Array.isArray(args.skills) ? (args.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const limit = typeof args.limit === "number" ? args.limit : 5;
  const fcArgs: FindCoursesArgs = { role, skills, limit };
  const hits = findCourses(fcArgs);
  if (hits.length === 0) {
    return { ok: false, tool: "find_courses", data: [], errorCode: "RAG_RETRIEVAL_EMPTY" };
  }
  return { ok: true, tool: "find_courses", data: hits };
}

// C4: BLS wage data routed through the dispatcher so Skill 6 / Skill 8 error
// classification is consistent across all connector calls.
async function getWageDataTool(args: Record<string, unknown>): Promise<ToolResult<LaborMarketData>> {
  const socCode = typeof args.socCode === "string" ? args.socCode : "";
  if (!socCode) {
    return { ok: false, tool: "get_wage_data", errorCode: "RAG_RETRIEVAL_EMPTY", detail: "empty socCode" };
  }
  if (!process.env.BLS_API_KEY) {
    return { ok: false, tool: "get_wage_data", errorCode: "RAG_RETRIEVAL_EMPTY", detail: "BLS_API_KEY not set" };
  }
  try {
    const data = await getWageData(socCode);
    // getWageData always returns a shape; treat "all nulls" as empty so the
    // orchestrator can fall back to curated/local context without raising.
    if (data.employment === null && data.meanWage === null && data.medianWage === null) {
      return { ok: false, tool: "get_wage_data", data, errorCode: "RAG_RETRIEVAL_EMPTY", detail: "no series returned" };
    }
    return { ok: true, tool: "get_wage_data", data };
  } catch (e) {
    const err = new AgentError("RAG_SOURCE_DOWN", (e as Error).message);
    logAgentError(err, { tool: "get_wage_data", socCode });
    return { ok: false, tool: "get_wage_data", errorCode: "RAG_SOURCE_DOWN", detail: err.message };
  }
}

// C4: USAJOBS posting counts routed through the dispatcher.
async function getJobCountsTool(args: Record<string, unknown>): Promise<ToolResult<{ keyword: string; count: number }>> {
  const keyword = typeof args.keyword === "string" ? args.keyword : "";
  if (!keyword) {
    return { ok: false, tool: "get_job_counts", errorCode: "RAG_RETRIEVAL_EMPTY", detail: "empty keyword" };
  }
  if (!process.env.USAJOBS_API_KEY || !process.env.USAJOBS_EMAIL) {
    return { ok: false, tool: "get_job_counts", errorCode: "RAG_RETRIEVAL_EMPTY", detail: "USAJOBS credentials not set" };
  }
  try {
    const jobs = await searchJobs(keyword);
    return { ok: true, tool: "get_job_counts", data: { keyword, count: jobs.length } };
  } catch (e) {
    const err = new AgentError("RAG_SOURCE_DOWN", (e as Error).message);
    logAgentError(err, { tool: "get_job_counts", keyword });
    return { ok: false, tool: "get_job_counts", errorCode: "RAG_SOURCE_DOWN", detail: err.message };
  }
}

async function retrieveSkillsTool(args: Record<string, unknown>): Promise<ToolResult<SkillAssessment[]>> {
  const role = typeof args.role === "string" ? args.role.trim() : "";
  // Change 5 P0 (Apr 14 2026): blank role is a DIFFERENT failure mode than
  // "retrieval returned nothing" — return RAG_BLANK_ROLE so the orchestrator
  // can raise `needsRoleConfirmation` and the speaker re-asks instead of
  // silently substituting an unrelated cached occupation.
  if (!role) {
    const err = new AgentError("RAG_BLANK_ROLE", "retrieveSkillsTool called with blank role");
    logAgentError(err, { tool: "retrieve_skills_for_role" });
    return { ok: false, tool: "retrieve_skills_for_role", errorCode: "RAG_BLANK_ROLE", detail: "empty role" };
  }
  try {
    const skills = await retrieveSkillsForRole(role);
    if (skills.length === 0) {
      return { ok: false, tool: "retrieve_skills_for_role", data: [], errorCode: "RAG_RETRIEVAL_EMPTY" };
    }
    return { ok: true, tool: "retrieve_skills_for_role", data: skills };
  } catch (e) {
    // Preserve the original AgentError code (e.g. RAG_BLANK_ROLE if it
    // somehow slipped past the guard) instead of flattening to RAG_SOURCE_DOWN.
    if (e instanceof AgentError) {
      logAgentError(e, { tool: "retrieve_skills_for_role", role });
      return { ok: false, tool: "retrieve_skills_for_role", errorCode: e.code, detail: e.message };
    }
    const err = new AgentError("RAG_SOURCE_DOWN", (e as Error).message);
    logAgentError(err, { tool: "retrieve_skills_for_role", role });
    return { ok: false, tool: "retrieve_skills_for_role", errorCode: "RAG_SOURCE_DOWN", detail: err.message };
  }
}
