/**
 * Orchestrator profile / episodic hooks (G5)
 *
 * Skills-architecture target says profile load/save and episodic append are
 * **orchestrator-approved side effects**, not server-only behavior. This
 * module wraps `src/db/profile-db.ts` so the state-updater (orchestrator)
 * can invoke them directly without touching `better-sqlite3` itself.
 *
 * - Lazy singleton DB handle so the hooks no-op gracefully when SQLite
 *   isn't available (e.g. CI without write access).
 * - All hooks are guarded by `userId`; passing null is a silent no-op.
 * - Failures surface a `PROFILE_DB_UNAVAILABLE` error code (Skill 8) but
 *   never throw — orchestrator turns must keep flowing.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  openProfileDb,
  getProfilePayload,
  upsertProfilePayload,
  appendEpisodicSummary,
  listRecentEpisodic,
  type ProfilePayload,
} from "../db/profile-db.js";
import { AgentError, logAgentError } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), "..", "..");
const DEFAULT_DB_PATH = join(ROOT, "data", "profiles.db");

let dbHandle: ReturnType<typeof openProfileDb> | null = null;
let dbDisabled = false;

function getDb(): ReturnType<typeof openProfileDb> | null {
  if (dbDisabled) return null;
  if (dbHandle) return dbHandle;
  try {
    dbHandle = openProfileDb(DEFAULT_DB_PATH);
    return dbHandle;
  } catch (e) {
    dbDisabled = true;
    logAgentError(new AgentError("PROFILE_DB_UNAVAILABLE", (e as Error).message));
    return null;
  }
}

export function loadProfileHook(userId: string | null | undefined): ProfilePayload | null {
  if (!userId) return null;
  const db = getDb();
  if (!db) return null;
  try {
    return getProfilePayload(db, userId);
  } catch (e) {
    logAgentError(new AgentError("PROFILE_DB_UNAVAILABLE", (e as Error).message), { hook: "load", userId });
    return null;
  }
}

export interface SaveProfileInput {
  userId: string | null | undefined;
  sessionId: string;
  targetRole?: string | null;
  jobTitle?: string | null;
  conversationSummary?: string;
}

export function saveProfileHook(input: SaveProfileInput): void {
  if (!input.userId) return;
  const db = getDb();
  if (!db) return;
  try {
    upsertProfilePayload(db, input.userId, {
      last_session_id: input.sessionId,
      target_role: input.targetRole ?? null,
      job_title: input.jobTitle ?? null,
      conversation_summary: input.conversationSummary,
    });
  } catch (e) {
    logAgentError(new AgentError("PROFILE_DB_UNAVAILABLE", (e as Error).message), { hook: "save", userId: input.userId });
  }
}

export function appendEpisodicHook(
  userId: string | null | undefined,
  sessionId: string,
  summary: string | null | undefined,
): void {
  if (!userId || !summary) return;
  const db = getDb();
  if (!db) return;
  try {
    appendEpisodicSummary(db, userId, sessionId, summary);
  } catch (e) {
    logAgentError(new AgentError("PROFILE_DB_UNAVAILABLE", (e as Error).message), { hook: "episodic", userId });
  }
}

export function listEpisodicHook(userId: string | null | undefined, limit = 5): string[] {
  if (!userId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    return listRecentEpisodic(db, userId, limit);
  } catch (e) {
    logAgentError(new AgentError("PROFILE_DB_UNAVAILABLE", (e as Error).message), { hook: "list", userId });
    return [];
  }
}
