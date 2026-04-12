# CLAUDE.md — Career Guidance AI codebase reference

> **This file is the source of truth for Claude Code sessions on this repo.**
> When a change set touches state, business rules, or critical files, update the relevant section here BEFORE running verification.
> Goal: stop re-reading 20+ source files at the start of every session.
>
> Last updated: 2026-04-11 (Change 4 code-complete; automated verification passed)

---

## 1. Stack

- Node 20 + TypeScript + Express
- LangGraph (Annotation-based state) + Google Gemini (`gemini-2.5-flash`)
- SQLite via `better-sqlite3` → `data/profiles.db` (tables: `profiles`, `episodic`, `sessions`)
- External data: O*NET (live + local fallback) + BLS wage data
- Frontend: vanilla JS in `public/js/app.js` (no framework)
- Deploy target: Render free tier (ephemeral disk → SQLite is source of truth)

---

## 2. Four-Phase Conversation Flow

```
orientation → exploration_career OR exploration_role_targeting → planning
```

| Phase | Purpose | Key gates |
|---|---|---|
| `orientation` | Capture job_title, industry, years_experience, education_level, session_goal (+ optional location, preferred_timeline) | BR-1: all 5 required fields non-null to exit |
| `exploration_career` | Discover interests, constraints, candidate directions (when session_goal = `explore_options`) | Max 3 candidate industries (BR-11) |
| `exploration_role_targeting` | Target role + O*NET skill assessment (100% rated) + learning needs | BR-4: 100% rated + confirmed eval + learning_needs_complete |
| `planning` | Block-by-block plan delivery + export | Terminal phase; BR-8 forbids shortcut from exploration_career |

Routing rules:
- BR-2: `session_goal == "explore_options"` → `exploration_career`; `pursue_specific_role` → `exploration_role_targeting`
- BR-8: `exploration_career` cannot transition directly to `planning`; must go via `exploration_role_targeting`
- BR-9 (Change 4): same-session role pivots archive the prior target and rehydrate shared skill ratings

---

## 3. Critical Files (one-liner each)

### Backend runtime
| File | Role |
|---|---|
| `src/state.ts` | LangGraph Annotation channels — single source of truth for runtime state |
| `src/server.ts` | Express HTTP layer; session persistence; persona detection; role-switch/compare endpoints |
| `src/graph.ts` | LangGraph assembly (state-updater → analyzer → speaker-prompt-creator → speaker) |
| `src/nodes/state-updater.ts` | Orchestrator: merges analyzer output → state; transition decisions; tool dispatch |
| `src/nodes/analyzer.ts` | Calls Gemini to extract structured fields from user message |
| `src/nodes/speaker-prompt-creator.ts` | Builds the LLM prompt for the speaker turn; emits cross-phase context |
| `src/nodes/speaker.ts` | Calls Gemini with the speaker prompt to produce user-facing output |
| `src/nodes/tool-executor.ts` | Side-effect boundary for RAG / O*NET / BLS calls — `runTool("name", args)` |

### Data / utilities
| File | Role |
|---|---|
| `src/utils/rag.ts` | O*NET skill retrieval, blending, per-role caching, `compareTwoRoles` |
| `src/utils/profile-hooks.ts` | Long-term memory hooks (save/load profile, append episodic) |
| `src/utils/history-manager.ts` | Conversation history summarization and recent turn formatting |
| `src/utils/prompt-loader.ts` | `loadSkillFile`, `loadPromptTemplate`, `populateTemplate` |
| `src/utils/errors.ts` | `AgentError(code)` — all nodes must use this, not ad-hoc strings |
| `src/db/profile-db.ts` | SQLite schema + CRUD for `profiles`, `episodic`, `sessions` |
| `src/services/bls.ts` | BLS wage/employment connector |
| `src/services/onet.ts` | O*NET live + local fallback |

### Reports / frontend
| File | Role |
|---|---|
| `src/report/pdf-generator.ts` | Final career plan PDF export (PDFKit) |
| `src/report/html-generator.ts` | Final career plan HTML export |
| `public/js/app.js` | Frontend chat UI, suggestion chips, resume dialog, profile recap card |
| `public/index.html` | SPA shell |

### Config / prompts
| File | Role |
|---|---|
| `agent_config/state_schema.json` | Phase-by-phase field definitions (types, required, defaults) |
| `agent_config/orchestrator_rules.md` | BR-1 … BR-12 business rules, fallback messages, hooks |
| `agent_config/phase_registry.json` | Phase definitions, transition conditions, max turns |
| `agent_config/skills/<phase>/speaker.md` | Per-phase speaker prompt skill files |
| `agent_config/skills/<phase>/analyzer.md` | Per-phase analyzer prompt skill files |
| `agent_config/prompts/speaker_template.md` | Master speaker template (populated per turn) |
| `agent_config/prompts/analyzer_template.md` | Master analyzer template |
| `agent_config/error_catalog.md` | `ErrorCode` union + user-visible fallback messages (Skill 8) |

---

## 4. Reusable Helpers (do NOT reimplement)

| Helper | File:line | Purpose |
|---|---|---|
| `deriveGapCategory` | `src/nodes/state-updater.ts:19` | rating + required → `absent` / `underdeveloped` / `strong` |
| `isConfirmation` | `src/nodes/state-updater.ts:215` | yes/no/confirm token detection |
| `parsePlanBlocks` | `src/nodes/state-updater.ts:223` | Validates plan block JSON shape |
| `rehydrateSkillRatings` | `src/nodes/state-updater.ts` (Change 4) | Copy ratings from prior role to new role by skill_name match |
| `retrieveSkillsForRole` | `src/utils/rag.ts:181` | Single-role O*NET fetch (per-role cached post Change 4) |
| `retrieveSkillsForMultipleRoles` | `src/utils/rag.ts:316` | Parallel multi-role fetch → `Record<role, skills[]>` |
| `blendSkillsAcrossRoles` | `src/utils/rag.ts:336` | Frequency-weighted blend across candidate roles |
| `compareTwoRoles` | `src/utils/rag.ts` (Change 4) | Shared / uniqueA / uniqueB skill split for comparison |
| `limitSkillsPerCategory` | `src/utils/rag.ts:24` | Enforces 4 tech + 4 soft cap |
| `upsertProfilePayload` | `src/db/profile-db.ts:48` | Merge-patch write to profiles table (JSON payload column) |
| `recordPriorPlan` | `src/db/profile-db.ts` (Change 4) | Snapshot prior plan for later reuse |
| `recordSkillRatingsForRole` | `src/db/profile-db.ts` (Change 4) | Persist `{role: [{skill, rating}]}` map |
| `getProfilePayload` | `src/db/profile-db.ts` | Load the merged profile for a userId |
| `appendEpisodicSummary` | `src/db/profile-db.ts` | Append post-session episodic summary |
| `migrateSession` | `src/server.ts:67` | Back-compat for older session JSON on load |
| `loadSkillFile` / `loadPromptTemplate` / `populateTemplate` | `src/utils/prompt-loader.ts` | Prompt assembly |
| `runTool` | `src/nodes/tool-executor.ts` | Single entry point for all side effects |

---

## 5. State Schema Highlights (post-Change 4)

### Orientation
`jobTitle`, `industry`, `yearsExperience`, `educationLevel`, `sessionGoal`, `location`, `preferredTimeline`

### Exploration (career track)
`interests[]`, `constraints[]`, `candidateDirections[]`, **`candidateIndustries[≤3]`** (Change 4), **`prioritizedIndustries[≤3]`** (Change 4), `track`

### Role targeting
`targetRole`, **`previousTargetRole`** (Change 4), **`comparedRoles[≤2]`** (Change 4), `skills[]` (with `user_rating`, `gap_category`), `skillsAssessmentStatus`, `candidateSkills{}` (keyed by role), `learningNeeds[]`, `learningNeedsComplete`, `skillsEvaluationSummary`, `userConfirmedEvaluation`

### Planning
`recommendedPath`, `timeline`, `skillDevelopmentAgenda[]`, `immediateNextSteps[]`, `planRationale`, `reportGenerated`, `learningResources[]`, `evidenceKept[]`, `evidenceDiscarded[]`, `planBlocks[]` (id/label/content/confirmed), `shiftIntent`, **`priorPlan`** (Change 4)

### Memory / persona (Change 4)
**`userPersona`** (`new_user` | `returning_continue` | `returning_restart`), **`exploredRoles[]`** (`{role_name, status, first_seen_at, notes?}`), **`roleSwitchContext`**, **`roleComparisonContext`**, **`roleSwitchAcknowledged`**

### Conversation control
`currentPhase`, `phaseTurnNumber`, `turnType`, `userMessage`, `speakerPrompt`, `speakerOutput`, `analyzerOutput`, `transitionDecision`, `conversationHistory`, `conversationSummary`, `clarificationCount`

---

## 6. Conventions

- **Side effects only via `tool-executor.ts`** — never inline O*NET / BLS / RAG calls in nodes
- **Errors use `AgentError(code)`** from `src/utils/errors.ts`; codes catalogued in `agent_config/error_catalog.md`
- **`validate-config` script** enforces parity between catalog and `ErrorCode` union
- **Canonical 4-level rating language**: `beginner | intermediate | advanced | expert` (Change 3)
- **`PREREQUISITE WARNING` string** in cross-phase context blocks plan generation (BR-4 enforcement)
- **Profile facts MUST survive `applyRestartPivot`** (Change 4); only `applyFreshStart` wipes everything
- **Hard caps enforced in reducers AND speaker warnings**: 3 industries, 2 compared roles
- **Recoverable errors never abort a turn** — state-updater falls through to deterministic path
- **Fatal errors** abort turn + surface to logs/LangSmith
- **Policy errors** (off-topic, safety) always emit speaker message from catalog

---

## 7. Verification Commands

Before any push:
```bash
cd career-guidance-ai
npx tsc --noEmit          # Type check (must pass first)
npm run build             # Docker-compatible build
npm run dev               # Local runtime (port 3000)
```

Local smoke: hit http://localhost:3000, run the 13 scenarios in Change 4 §14, plus bug regressions E6 / E7 / E8 / E9.

Production smoke (after deploy):
```bash
curl https://career-guidance-ai-4aig.onrender.com/api/health
```
Re-run scenarios 5, 6, 9 against the live URL.

---

## 8. Out of Scope (current)

- USAJOBS connector (explicitly out of scope per Revised Prompt §M)
- Heavy auth (lightweight `userId` only)
- Schema migrations beyond JSON-payload extensions
- LLM model/temperature changes
- Frontend visual redesign beyond the 3-button dialog and profile recap card (Change 4)

---

## 9. Change History

- **Change 1–2** (earlier): baseline 4-phase flow, LangGraph assembly, O*NET/BLS connectors, PDF/HTML export
- **Change 3** (deployed): mandatory skills assessment (100% rating required), 4-level rating scale, learning-needs gating, `skillsEvaluationSummary` + `userConfirmedEvaluation`, career-shift variant
- **Change 4** (this branch): structured role memory, persona detection, same-session role-switch rehydration, role comparison (max 2), industry caps (max 3), plan continuity via `priorPlan`, bug fixes E6 (stale 3-level chips) / E7 (planning gate loop) / E8 (ephemeral sessions on Render) / E9 (PDF "not completed" contradiction)

### Change 4 verification status (2026-04-11)
Automated gate — **all green**:
- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run validate-config` 21/21 (runtime-only allowlist extended with `explored_roles, prior_plan, skill_name, unique_a, unique_b, shared_skills, previous_target_role, role_switch_context, role_comparison_context, role_switch_acknowledged, candidate_industries, compared_roles, user_persona, years_experience, education_level, preferred_timeline, session_goal, restart_pivot` — see `scripts/validate-config.ts` BR-9/10/11/12 comment block)
- `npm run smoke` LangGraph + Gemini end-to-end passes
- `npm run eval-fixtures` 30/30 synthetic evidence packs
- `/api/health`, `/api/session`, `/api/session/:id/role-switch`, `/api/session/:id/role-compare` return expected payloads
- E6 regression: only forbidden-warning occurrence of old 3-level language remains
- E7 regression: `isConfirmation` fallback for `learningNeedsComplete` wired in `state-updater.ts` (line 256-264)
- E8 regression: session persists through `kill` + restart via SQLite `sessions` table (verified against PORT=3101)
- E9 regression: `skillsAssessmentStatus === "complete"` branch added to both PDF and HTML generators

Still required before push (manual / UI-driven):
- 13 scenarios from Change 4 §14 executed against `npm start` at `localhost:3000`
- Production deploy gate: scenarios 5, 6, 9 re-run against `https://career-guidance-ai-4aig.onrender.com` after push

---

## 10. Quick Navigation Tips for Claude

When the user asks about:
- **"Why is phase X doing Y?"** → `agent_config/skills/<phase>/speaker.md` + `state-updater.ts` merge functions
- **"Why is the analyzer extracting/not extracting Z?"** → `agent_config/skills/<phase>/analyzer.md` + `analyzer.ts`
- **"Plan/PDF output looks wrong"** → `src/report/pdf-generator.ts` / `html-generator.ts`
- **"Session lost on reload"** → `src/server.ts` → `saveSession` / `loadSession` + `src/db/profile-db.ts` sessions table
- **"Business rule X is not firing"** → `agent_config/orchestrator_rules.md` + `state-updater.ts` `determineTransition` (line ~256)
- **"Skill ratings are wrong after role switch"** → `rehydrateSkillRatings` in `state-updater.ts` + `roleSwitchContext`
- **"Chip language stale"** → `agent_config/skills/exploration_role_targeting/speaker.md` (NOT frontend; Bug E6)
- **"Frontend shows wrong thing"** → `public/js/app.js` + backend `speakerOutput`
