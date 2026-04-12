import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { PriorPlanSnapshot, UserRating } from "../state.js";

export interface StoredExploredRole {
  role_name: string;
  status: string;
  first_seen_at: number;
}

export interface StoredSkillRating {
  skill_name: string;
  user_rating: UserRating;
}

export interface ProfilePayload {
  last_session_id?: string;
  target_role?: string | null;
  job_title?: string | null;
  conversation_summary?: string;
  // --- Change 4: persistent profile facts that survive role pivots ---
  industry?: string | null;
  education_level?: string | null;
  years_experience?: number | null;
  location?: string | null;
  preferred_timeline?: string | null;
  explored_roles?: StoredExploredRole[];
  prior_plan?: PriorPlanSnapshot | null;
  // Cross-session skill memory: `{ "Financial Analyst": [{ skill_name, user_rating }, ...] }`.
  // Used by rehydrateSkillRatings to cheaply carry ratings to a new target role.
  skill_ratings_by_role?: Record<string, StoredSkillRating[]>;
  updated_at: number;
}

let dbSingleton: Database.Database | null = null;

export function openProfileDb(dbPath: string): Database.Database {
  if (dbSingleton) return dbSingleton;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // Change 4: payload JSON schema extended (see ProfilePayload);
  // legacy rows merge cleanly via spread in upsertProfilePayload, so no ALTER is needed.
  // The new `sessions` table makes session state survive Render free-tier dyno restarts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episodic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic(user_id, created_at);
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at);
  `);
  dbSingleton = db;
  return db;
}

export function getProfilePayload(db: Database.Database, userId: string): ProfilePayload | null {
  const row = db.prepare("SELECT payload FROM profiles WHERE user_id = ?").get(userId) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as ProfilePayload;
  } catch {
    return null;
  }
}

export function upsertProfilePayload(db: Database.Database, userId: string, patch: Partial<ProfilePayload>): void {
  const prev = getProfilePayload(db, userId) ?? { updated_at: Date.now() };
  const next: ProfilePayload = {
    ...prev,
    ...patch,
    updated_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO profiles (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(next), next.updated_at);
}

export function appendEpisodicSummary(
  db: Database.Database,
  userId: string,
  sessionId: string,
  summary: string,
): void {
  const trimmed = summary.trim();
  if (!trimmed) return;
  db.prepare(
    "INSERT INTO episodic (user_id, session_id, summary, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, sessionId, trimmed.slice(0, 8000), Date.now());
}

export function listRecentEpisodic(db: Database.Database, userId: string, limit = 5): string[] {
  const rows = db
    .prepare(
      "SELECT summary FROM episodic WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit) as { summary: string }[];
  return rows.map((r) => r.summary);
}

// --- Change 4 helpers ---

/**
 * Store the most recent completed plan so it can be reused after a role pivot
 * or on returning sessions. Wraps `upsertProfilePayload` so the merge-patch
 * SQL logic stays in one place.
 */
export function recordPriorPlan(
  db: Database.Database,
  userId: string,
  snapshot: PriorPlanSnapshot,
): void {
  upsertProfilePayload(db, userId, { prior_plan: snapshot });
}

/**
 * Persist per-role skill ratings so `rehydrateSkillRatings` can carry them
 * across role pivots (same session) AND across returning sessions (new run).
 * Only stores ratings that are non-null.
 */
export function recordSkillRatingsForRole(
  db: Database.Database,
  userId: string,
  role: string,
  skills: Array<{ skill_name: string; user_rating: UserRating | null }>,
): void {
  const normalized = role.trim();
  if (!normalized) return;
  const rated: StoredSkillRating[] = skills
    .filter((s): s is { skill_name: string; user_rating: UserRating } => s.user_rating !== null)
    .map((s) => ({ skill_name: s.skill_name, user_rating: s.user_rating }));
  if (rated.length === 0) return;
  const prev = getProfilePayload(db, userId) ?? { updated_at: Date.now() };
  const merged: Record<string, StoredSkillRating[]> = {
    ...(prev.skill_ratings_by_role ?? {}),
    [normalized]: rated,
  };
  upsertProfilePayload(db, userId, { skill_ratings_by_role: merged });
}

/**
 * SQLite-backed session persistence. The in-memory Map in server.ts
 * becomes an L1 cache; this is the source of truth so sessions survive
 * Render free-tier dyno restarts (Bug E8).
 */
export function saveSessionState(
  db: Database.Database,
  sessionId: string,
  userId: string | null,
  stateJson: string,
): void {
  db.prepare(
    `INSERT INTO sessions (session_id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       user_id = excluded.user_id,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`
  ).run(sessionId, userId, stateJson, Date.now());
}

export function loadSessionState(
  db: Database.Database,
  sessionId: string,
): { state_json: string; user_id: string | null; updated_at: number } | null {
  const row = db
    .prepare("SELECT state_json, user_id, updated_at FROM sessions WHERE session_id = ?")
    .get(sessionId) as { state_json: string; user_id: string | null; updated_at: number } | undefined;
  return row ?? null;
}
