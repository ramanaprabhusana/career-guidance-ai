/**
 * P4 memory-continuity regression (Apr 17 2026).
 *
 * Exercises the SQLite-backed session + profile path end-to-end against a
 * temporary on-disk database. Asserts:
 *   (C1) session save → load round-trips stateJson exactly
 *   (C2) overwriting an existing session_id updates, doesn't duplicate
 *   (C3) profile payload merge preserves prior fields (additive patch)
 *   (C4) recording a prior plan snapshot is readable via getProfilePayload
 *   (C5) skill ratings for a role are keyed by normalized role name
 *
 * Dependency-free (pure better-sqlite3); runs in < 1s.
 * Run: `npm run continuity`
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  openProfileDb,
  saveSessionState,
  loadSessionState,
  upsertProfilePayload,
  getProfilePayload,
  recordPriorPlan,
  recordSkillRatingsForRole,
} from "../db/profile-db.js";

let failed = 0;
let passed = 0;

function assert(label: string, cond: unknown, detail?: string): void {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  \u2717 ${label}${detail ? " — " + detail : ""}`);
  }
}

function section(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n[${name}]`);
}

const tmp = mkdtempSync(join(tmpdir(), "cga-continuity-"));
const dbPath = join(tmp, "profiles.db");

try {
  const db = openProfileDb(dbPath);

  // -----------------------------------------------------------------------
  // [C1] session round-trip
  // -----------------------------------------------------------------------
  section("C1] session save/load round-trip");
  {
    const payload = JSON.stringify({ sessionId: "s1", targetRole: "Data Scientist" });
    saveSessionState(db, "s1", "u1", payload);
    const row = loadSessionState(db, "s1");
    assert("loadSessionState returns row",       row !== null);
    assert("state_json round-trips exactly",      row?.state_json === payload);
    assert("user_id preserved",                    row?.user_id === "u1");
  }

  // -----------------------------------------------------------------------
  // [C2] overwrite updates, does not duplicate
  // -----------------------------------------------------------------------
  section("C2] overwrite-on-conflict");
  {
    const updated = JSON.stringify({ sessionId: "s1", targetRole: "Product Manager" });
    saveSessionState(db, "s1", "u1", updated);
    const row = loadSessionState(db, "s1");
    assert("overwrite kept latest",               row?.state_json === updated);
  }

  // -----------------------------------------------------------------------
  // [C3] profile payload additive merge
  // -----------------------------------------------------------------------
  section("C3] profile payload merge is additive");
  {
    upsertProfilePayload(db, "u1", { target_role: "Data Scientist", industry: "Tech" });
    upsertProfilePayload(db, "u1", { location: "Boston" });
    const payload = getProfilePayload(db, "u1");
    assert("target_role retained",                payload?.target_role === "Data Scientist");
    assert("industry retained across merges",     payload?.industry === "Tech");
    assert("location added",                       payload?.location === "Boston");
  }

  // -----------------------------------------------------------------------
  // [C4] prior plan snapshot round-trip
  // -----------------------------------------------------------------------
  section("C4] recordPriorPlan → getProfilePayload");
  {
    recordPriorPlan(db, "u1", {
      target_role: "Data Scientist",
      recommended_path: "Strengthen stats, ship ML portfolio",
      generated_at: Date.now(),
      skill_development_agenda: [],
      immediate_next_steps: [],
      timeline: null,
    });
    const payload = getProfilePayload(db, "u1");
    assert("priorPlan readable",                   payload?.prior_plan?.target_role === "Data Scientist");
  }

  // -----------------------------------------------------------------------
  // [C5] skill ratings keyed by role (case-normalized)
  // -----------------------------------------------------------------------
  section("C5] recordSkillRatingsForRole normalization");
  {
    recordSkillRatingsForRole(db, "u1", "  Data Scientist  ", [
      { skill_name: "Python", user_rating: "advanced" },
      { skill_name: "Statistics", user_rating: "intermediate" },
    ]);
    const payload = getProfilePayload(db, "u1");
    const ratings = payload?.skill_ratings_by_role ?? {};
    const keys = Object.keys(ratings);
    assert("at least one role recorded",           keys.length > 0);
    assert("role key trimmed",                     keys.includes("Data Scientist"));
    const first = ratings["Data Scientist"];
    assert("ratings array has 2 entries",          Array.isArray(first) && first.length === 2);
  }

  db.close();
} catch (e) {
  failed++;
  // eslint-disable-next-line no-console
  console.error("FATAL:", (e as Error).message);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  // eslint-disable-next-line no-console
  console.error("Continuity regression suite FAILED");
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log("All continuity assertions passed.");
