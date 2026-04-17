/**
 * Scoped ReAct executor (Change 5 P0, Apr 14 2026).
 *
 * Contract:
 * - Runs ONLY when `process.env.ENABLE_REACT_LOOP === "true"` AND the
 *   orchestrator has set `state.reactIntent` + `state.pendingReactTool`.
 * - Hard caps: abort if `reactStepCount >= maxReactSteps` (default 3) OR
 *   elapsed > 15s per turn.
 * - Never writes state channels outside its own allowlist (reactStepCount,
 *   reactObservationLog, pendingReactTool, reactIntent). Final observation
 *   is consumed by the next turn's speaker prompt via a "Deep research
 *   summary" context block (see speaker-prompt-creator).
 * - Does NOT bypass `runTool` — every side effect still flows through the
 *   orchestrator-approved tool executor.
 */

import type { AgentStateType } from "../state.js";
import { runTool, type ToolName } from "./tool-executor.js";

const HARD_CAP_MS = 15_000;
const ALLOWED_REACT_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "retrieve_skills_for_role",
  "web_search",
  "get_wage_data",
  "get_job_counts",
  "find_courses",
]);

export async function reactExecutor(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  // Flag gate — if disabled, always no-op. Keeps default path byte-identical.
  if (process.env.ENABLE_REACT_LOOP !== "true") return {};

  const intent = state.reactIntent;
  const pending = state.pendingReactTool;
  if (!intent || !pending) return {};

  const maxSteps = state.maxReactSteps ?? 3;
  const stepCount = state.reactStepCount ?? 0;
  if (stepCount >= maxSteps) {
    // Loop exhausted — clear the pending tool so the graph exits cleanly.
    return { pendingReactTool: null };
  }

  const startedAt = Date.now();

  // Validate tool is on the allowlist — the orchestrator may only schedule
  // these specific tools in ReAct mode. Unknown tools abort without side
  // effects so a malformed analyzer output can't escalate privilege.
  if (!ALLOWED_REACT_TOOLS.has(pending.name as ToolName)) {
    return {
      pendingReactTool: null,
      reactObservationLog: [
        {
          step: stepCount + 1,
          tool: pending.name,
          args: pending.args,
          ok: false,
          summary: `tool "${pending.name}" not allowed in ReAct loop`,
        },
      ],
    };
  }

  const result = await runTool({
    name: pending.name as ToolName,
    args: pending.args,
  });

  const elapsed = Date.now() - startedAt;
  const summary = summarizeResult(result);
  const nextStepCount = stepCount + 1;

  const updates: Partial<AgentStateType> = {
    reactStepCount: nextStepCount,
    reactObservationLog: [
      {
        step: nextStepCount,
        tool: pending.name,
        args: pending.args,
        ok: result.ok,
        summary,
      },
    ],
    // Clear the pending tool by default — orchestrator re-primes it next turn
    // if continuing. Prevents re-executing the same tool on accidental re-entry.
    pendingReactTool: null,
  };

  // Hard cap: if we're out of budget either by steps or wall-clock, also
  // clear the intent so the next turn exits the loop.
  if (nextStepCount >= maxSteps || elapsed > HARD_CAP_MS) {
    updates.reactIntent = null;
  }

  // Structured log for observability (LangSmith scrape-friendly).
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "info",
      event: "react_step",
      intent,
      step: nextStepCount,
      tool: pending.name,
      ok: result.ok,
      latency_ms: elapsed,
      ...(result.errorCode ? { error_code: result.errorCode } : {}),
    }),
  );

  return updates;
}

function summarizeResult(result: Awaited<ReturnType<typeof runTool>>): string {
  if (!result.ok) {
    return `error:${result.errorCode ?? "unknown"}${result.detail ? ` — ${result.detail.slice(0, 80)}` : ""}`;
  }
  const data = result.data as unknown;
  if (Array.isArray(data)) {
    return `${data.length} item${data.length === 1 ? "" : "s"} retrieved`;
  }
  if (data && typeof data === "object") {
    const keys = Object.keys(data as Record<string, unknown>).slice(0, 4).join(",");
    return `ok (fields: ${keys || "none"})`;
  }
  return "ok";
}

/**
 * Graph conditional: should we enter the ReAct branch after stateUpdater?
 * Centralized so `graph.ts` stays declarative.
 */
export function shouldStartReact(state: AgentStateType): "react" | "skip" {
  if (process.env.ENABLE_REACT_LOOP !== "true") return "skip";
  if (!state.reactIntent || !state.pendingReactTool) return "skip";
  if ((state.reactStepCount ?? 0) >= (state.maxReactSteps ?? 3)) return "skip";
  return "react";
}
