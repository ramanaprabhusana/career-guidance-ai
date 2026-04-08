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
import { AgentError, logAgentError } from "../utils/errors.js";
import { webSearch, type WebSearchResult } from "../services/web-search.js";
import { findCourses, type CourseHit, type FindCoursesArgs } from "../services/courses.js";

export type ToolName = "retrieve_skills_for_role" | "web_search" | "find_courses";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: ToolName;
  data?: T;
  errorCode?: "RAG_RETRIEVAL_EMPTY" | "RAG_SOURCE_DOWN" | "CONFIG_MISSING" | "LLM_TIMEOUT";
  detail?: string;
}

export async function runTool(call: ToolCall): Promise<ToolResult> {
  switch (call.name) {
    case "retrieve_skills_for_role":
      return await retrieveSkillsTool(call.args);
    case "web_search":
      return await webSearchTool(call.args);
    case "find_courses":
      return findCoursesTool(call.args);
    default: {
      const err = new AgentError("CONFIG_MISSING", `Unknown tool: ${call.name as string}`);
      logAgentError(err, { tool: call.name });
      return { ok: false, tool: call.name, errorCode: "CONFIG_MISSING", detail: err.message };
    }
  }
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

async function retrieveSkillsTool(args: Record<string, unknown>): Promise<ToolResult<SkillAssessment[]>> {
  const role = typeof args.role === "string" ? args.role : "";
  if (!role) {
    return { ok: false, tool: "retrieve_skills_for_role", errorCode: "RAG_RETRIEVAL_EMPTY", detail: "empty role" };
  }
  try {
    const skills = await retrieveSkillsForRole(role);
    if (skills.length === 0) {
      return { ok: false, tool: "retrieve_skills_for_role", data: [], errorCode: "RAG_RETRIEVAL_EMPTY" };
    }
    return { ok: true, tool: "retrieve_skills_for_role", data: skills };
  } catch (e) {
    const err = new AgentError("RAG_SOURCE_DOWN", (e as Error).message);
    logAgentError(err, { tool: "retrieve_skills_for_role", role });
    return { ok: false, tool: "retrieve_skills_for_role", errorCode: "RAG_SOURCE_DOWN", detail: err.message };
  }
}
