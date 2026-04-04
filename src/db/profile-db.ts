import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

export interface ProfilePayload {
  last_session_id?: string;
  target_role?: string | null;
  job_title?: string | null;
  conversation_summary?: string;
  updated_at: number;
}

let dbSingleton: Database.Database | null = null;

export function openProfileDb(dbPath: string): Database.Database {
  if (dbSingleton) return dbSingleton;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
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
