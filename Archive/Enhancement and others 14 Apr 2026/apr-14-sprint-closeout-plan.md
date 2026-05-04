# Apr 14 sprint — close-out plan

> **Nature of this plan:** Change 5 (Apr 14 sprint) is **already code-complete** in `.claude/worktrees/flamboyant-diffie` — ReAct loop, RAG rerank, all P0 fixes, golden tests, and doc updates exist as uncommitted files in the working tree. This document is therefore a **close-out plan** (commit → re-gate → manual-smoke → merge), not an implementation plan. §"ReAct implementation summary" below documents what is already built so a reviewer can assess it without opening source files.

## Context

The Apr 14 sprint ("Change 5") is code-complete in the `flamboyant-diffie` worktree but **nothing has been committed**. Branch `claude/flamboyant-diffie` HEAD = `74f4376` = `main` HEAD. The sprint exists only as 18 modified + 3 new files in the working tree of `.claude/worktrees/flamboyant-diffie`. One `git reset --hard` or worktree cleanup would wipe the entire sprint.

All code claims in the hand-off summary verified against the working tree (see §Verification of hand-off below). Automated gates reportedly green, but they were run against an uncommitted state — any re-run after commit must be done before merge.

User directive (memory: `feedback_branch_discipline.md`): **never merge to `main` until all automated + manual gates green**. Bug fixes and new features should ship in separate PRs so a feature regression doesn't block a hotfix.

## Verification of hand-off (already done, read-only)

| Claim | Evidence |
|---|---|
| P0 #1 targetRole guard | `applyTargetRoleWrite` at state-updater.ts:55, 4 guarded call sites (102/130/215/…) |
| P0 #2 blank-role RAG | `RAG_BLANK_ROLE` in errors.ts:37 + catalog:61; `needsRoleConfirmation` in state.ts:329 |
| P0 #3 planning loop | `seedPlanBlocks` state-updater.ts:546, `advanceNextPlanBlock` :679, wired at :974/:1142 |
| P0 #4 readiness math | `computeReadinessStats`, `getDisplayRole` in new `src/report/report-helpers.ts` |
| RAG rerank (flagged) | `ENABLE_RAG_RERANK` check rag.ts:217, `rerankByLexicalOverlap` :248 |
| ReAct (flagged) | `src/nodes/react-executor.ts` 139 lines, `HARD_CAP_MS = 15_000`, allowlist-only state writes |
| Golden regression | `src/tests/golden-path.test.ts` — 14 `assert(...)` calls, matches claim |
| CLAUDE.md sync | "Last updated: 2026-04-15 (Change 5 code-complete…)" line 7; §4 +8 helper rows; §5 ReAct subsection |

## Gaps vs. original sprint plan (memory: `project_apr14_sprint.md`)

1. `npm run eval-rag` script was in the original gate list but was **not added** to `package.json`. Only `smoke` and `golden` are wired.
2. Two audit docs outside the worktree were in Step 8 but are untouched:
   - `Enhancement and others 14 Apr 2026/Checklist_claude_summary.md` — P0 rows not flipped to Done
   - `Enhancement and others 14 Apr 2026/architecture_target_vs_current.md` §6 — ReAct row not updated to "implemented behind flag"
3. Nothing is committed. This is the highest risk in the current state.

## ReAct implementation summary (already shipped — for teammate review)

Addressing teammate's concern about loop-runaway: the implementation has **five independent loop-protection mechanisms** layered so any single failure is caught by the next. All exist in `src/nodes/react-executor.ts` and `src/graph.ts` (uncommitted; see evidence line numbers below).

**Where it lives**
- `src/nodes/react-executor.ts` (139 lines) — executor + graph-router predicate.
- `src/state.ts:335–345` — 5 dedicated state channels (`reactIntent`, `pendingReactTool`, `reactStepCount`, `maxReactSteps`, `reactObservationLog`).
- `src/graph.ts` — conditional edge: `stateUpdater → shouldStartReact → (react | speaker)`.
- `src/nodes/speaker-prompt-creator.ts` — consumes `reactObservationLog` as a "Deep research summary" context block for the next user-facing turn.

**How it is invoked (double-gated, not on by default)**
1. Env flag: `process.env.ENABLE_REACT_LOOP === "true"` (executor line 33 + router line 135). Default OFF → byte-identical to pre-Change-5 path.
2. Intent: orchestrator must have set `state.reactIntent = "deep_research_role"` AND `state.pendingReactTool`. Missing either → no-op.

**Loop-protection mechanisms**

| # | Guard | Location | Trigger | Fallback |
|---|---|---|---|---|
| 1 | **Step-count cap** (`maxReactSteps`, default 3) | executor:41, :93 | `stepCount >= 3` | Clear `pendingReactTool` and `reactIntent` → graph routes to speaker. |
| 2 | **Wall-clock cap** (`HARD_CAP_MS = 15_000`) | executor:20, :93 | `elapsed > 15s` on any step | Same as #1 — clear intent, exit loop. |
| 3 | **Tool allowlist** (5 tools only) | executor:21–27, :51–64 | Orchestrator schedules non-allowlisted tool | Abort with `ok: false`, logged reason, `pendingReactTool` cleared. No side-effect executed. |
| 4 | **Pending tool cleared every step** | executor:88 | Every invocation | Orchestrator MUST explicitly re-prime for continuation → accidental re-entry can't re-run the same tool. |
| 5 | **Graph-router re-check** | executor:134–138 (`shouldStartReact`) | Before graph enters ReAct node | Re-evaluates flag + intent + pending tool + step-count. Any miss → routes to `speaker`, not `react`. |

**Fallback path when any cap trips**

`reactIntent` cleared → next-turn `shouldStartReact` returns `"skip"` → graph goes `stateUpdater → speaker` (normal path) → `speaker-prompt-creator` injects accumulated `reactObservationLog` as a "Deep research summary" block → user gets a normal reply grounded in partial observations. No silent loop, no partial state leakage, no privilege escalation.

**Observability — LangSmith is the destination (pre-existing, integrated 2026-03-28)**
- LangSmith auto-tracing wired in `src/server.ts:1212` — gated on `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY`. Env vars already present in `render.yaml:24` for production. `langsmith` npm package 0.5.15 in lockfile.
- **Dual-sink design** — every structured log line emits to **stderr (always on)** AND to **LangSmith spans (when flag enabled)**. Stderr is the durable record; LangSmith adds searchable UI + latency/cost breakdown.
- Change 5 added four new LangSmith-scrape-friendly event types (shapes are stable JSON so span extractors can key on `event`):
  - `event: "react_step"` — react-executor.ts:99–110 — fields: `intent, step, tool, ok, latency_ms, error_code?`
  - `event: "tool_call"` — tool-executor.ts:~49 — every `runTool()` invocation
  - `event: "rag_retrieve"` — rag.ts:277–290 — fields include `reranked` flag so rerank A/B is measurable
  - `event: "target_role_write"` — state-updater.ts:53 — every real change to `targetRole` (regression-visible)
- Fatal errors (`AgentError` with severity `fatal`) surface to LangSmith with full stack per `agent_config/error_catalog.md:24`.
- Golden-path test (`src/tests/golden-path.test.ts`, 14 asserts) exercises the default-OFF path; ReAct-specific regression tests can be added post-merge.
- **Reviewer verification path:** after Step 2, `LANGCHAIN_TRACING_V2=true LANGCHAIN_API_KEY=… npm run smoke` → open the LangSmith project → filter by `event` field → confirm all four new event types appear with expected shapes.

**Why this avoids the professor's "ReAct in a loop" warning**
The classic failure mode (model re-planning forever) is blocked at three layers: the step cap (#1) stops it at 3 iterations regardless of what the model wants; the wall-clock cap (#2) stops it at 15s even if a single tool call hangs; and the tool allowlist (#3) prevents the model from escalating to arbitrary tools mid-loop. Falling back to the normal speaker path (never to "hang" or "empty reply") keeps user-visible latency bounded.

## Recommended close-out sequence

Order matters — commit first, re-gate second, manual-gate third, docs fourth, merge last. **Commands below are literal; run them in order from the stated working directory.**

### Step 1 — Commit the sprint on `claude/flamboyant-diffie`

Working dir (for all Step 1 commands): `.claude/worktrees/flamboyant-diffie/`

Recommend **two code commits + one docs commit** so a P0 hotfix can land without dragging flagged features.

**1a — Sanity check before staging:**
```bash
cd .claude/worktrees/flamboyant-diffie
git status                                       # expect 18 modified + 3 untracked
git rev-parse HEAD                               # expect 74f4376 (same as main)
git diff --stat                                  # line-count sanity check
```

**1b — Commit A (P0 bug fixes — shippable as hotfix without flagged features):**
```bash
git add \
  src/nodes/state-updater.ts \
  src/utils/errors.ts \
  agent_config/error_catalog.md \
  src/report/report-helpers.ts \
  src/report/pdf-generator.ts \
  src/report/html-generator.ts \
  agent_config/skills/exploration_role_targeting/analyzer.md \
  agent_config/skills/exploration_role_targeting/speaker.md \
  agent_config/skills/planning/analyzer.md \
  agent_config/skills/planning/speaker.md \
  src/tests/golden-path.test.ts \
  scripts/validate-config.ts

# NOTE: src/state.ts, src/utils/rag.ts, src/nodes/speaker-prompt-creator.ts, and
# package.json contain MIXED P0 + flagged changes. Use `git add -p` to stage only
# the P0 hunks in this commit; the remaining hunks go into Commit B.
git add -p src/state.ts src/utils/rag.ts src/nodes/speaker-prompt-creator.ts package.json

git commit -m "fix(change5-P0): targetRole guard, blank-role RAG, planning loop, readiness math"
```

**1c — Commit B (flagged features + observability):**
```bash
git add \
  src/nodes/react-executor.ts \
  src/graph.ts \
  src/nodes/tool-executor.ts
# Residual hunks in state.ts / rag.ts / speaker-prompt-creator.ts / package.json:
git add src/state.ts src/utils/rag.ts src/nodes/speaker-prompt-creator.ts package.json

git commit -m "feat(change5): scoped ReAct loop + RAG rerank (flagged) + tool_call logs"
```

**1d — Commit C (docs only):**
```bash
git add CLAUDE.md project_plan_comp_checklist.md
git commit -m "docs(change5): CLAUDE.md §9/§4/§5 + plan-comp checklist delta"
```

**1e — Verify commit graph:**
```bash
git log --oneline main..HEAD                     # expect exactly 3 commits
git diff main..HEAD --stat | tail -1             # sanity on total line count
```

Fallback: if `git add -p` gets painful, collapse 1b+1c into a single `commit -m "feat: Change 5 — P0 fixes + scoped ReAct + RAG rerank (flagged)"` and keep docs separate. Do NOT use `--no-verify` under any circumstance.

### Step 2 — Re-run automated gates against committed state
From `career-guidance-ai` subdir of the worktree:
```bash
npx tsc --noEmit
npm run build
npm run validate-config
npm run golden
npm run eval-fixtures
npm run smoke            # without GOOGLE_API_KEY: config+graph-compile check only
```
All must be green. If `eval-rag` is still desired per original plan, add it as a follow-up or drop it from the gate list (recommend dropping — golden covers the regression intent).

### Step 3 — Manual gates (user-owned; cannot run from here)
1. `GOOGLE_API_KEY=… npm run smoke` — full LLM end-to-end.
2. **UI transcript replay** at `localhost:3000`: Recent Graduate → explore → "Corporate Finance Analyst" → rate all skills → "ok" → plan → PDF. Assertions: `targetRole` never drifts, no "preparing your plan" loop, PDF assessment % vs strength % split correctly, header role ↔ badge role agree.
3. *(Optional but recommended)* `ENABLE_REACT_LOOP=true` UI run with a "deep research this role" utterance — observe ≤3 tool iterations, ≤15s, no default-path regression.
4. **Default-path byte-identity check**: smoke run with both `ENABLE_RAG_RERANK` and `ENABLE_REACT_LOOP` OFF → confirm no behavior change vs. pre-Change-5.

### Step 4 — Sync external audit docs (live in main repo, outside worktree)
Paths (relative to repo root):
- `Enhancement and others 14 Apr 2026/Checklist_claude_summary.md` — flip P0 rows (targetRole, blank-role RAG, planning loop, PDF readiness) to Done.
- `Enhancement and others 14 Apr 2026/architecture_target_vs_current.md` §6 — ReAct row from "Not implemented" → "Implemented behind `ENABLE_REACT_LOOP` flag; scoped to `deep_research_role` intent; 3-step / 15s hard cap".
- `Enhancement and others 14 Apr 2026/project_plan_comp_checklist.md` Table 2 — ReAct row `No → Partial (feature-flagged)`, add golden-path row.

These are cleanest to edit post-merge from `main`, but can be done on the branch too.

### Step 5 — Squash-merge `claude/flamboyant-diffie` → `main`
Only after Steps 1–4 green. Via PR (so Render auto-deploy fires from a reviewed commit, not a local merge):
```bash
cd .claude/worktrees/flamboyant-diffie
git push -u origin claude/flamboyant-diffie
gh pr create --base main --head claude/flamboyant-diffie \
  --title "Change 5: P0 fixes + scoped ReAct + RAG rerank (flagged)" \
  --body "$(cat <<'EOF'
## Summary
- P0 bug fixes: targetRole drift guard, blank-role RAG short-circuit, planning-loop fix, PDF/HTML readiness math
- Scoped ReAct loop behind ENABLE_REACT_LOOP (5-layer loop protection — see close-out plan)
- RAG rerank behind ENABLE_RAG_RERANK
- Golden-path regression test (14 asserts) + tool_call structured logs

## Test plan
- [x] tsc --noEmit / build / validate-config 21/21 / golden 14/14 / eval-fixtures 30/30
- [ ] GOOGLE_API_KEY smoke
- [ ] UI transcript: Recent Graduate → Corporate Finance Analyst → plan → PDF
- [ ] ENABLE_REACT_LOOP=true UI smoke with "deep research this role"
- [ ] Default-path byte-identity with both flags OFF
EOF
)"
```
After merge: confirm Render auto-deploy, then:
```bash
curl https://career-guidance-ai-4aig.onrender.com/api/health
```
Re-run field scenarios 5, 6, 9 against the live URL.

## Critical files to modify

*(No new code edits proposed.)* Step 1 commits the already-existing working-tree changes in `.claude/worktrees/flamboyant-diffie`:

- **Modified:** `CLAUDE.md`, `agent_config/error_catalog.md`, `agent_config/skills/exploration_role_targeting/analyzer.md`, `agent_config/skills/exploration_role_targeting/speaker.md`, `agent_config/skills/planning/analyzer.md`, `agent_config/skills/planning/speaker.md`, `package.json`, `project_plan_comp_checklist.md`, `scripts/validate-config.ts`, `src/graph.ts`, `src/nodes/speaker-prompt-creator.ts`, `src/nodes/state-updater.ts`, `src/nodes/tool-executor.ts`, `src/report/html-generator.ts`, `src/report/pdf-generator.ts`, `src/state.ts`, `src/utils/errors.ts`, `src/utils/rag.ts`
- **New:** `src/nodes/react-executor.ts`, `src/report/report-helpers.ts`, `src/tests/golden-path.test.ts`
- **External audit docs (Step 4):** three files under `Enhancement and others 14 Apr 2026/`.

## Verification

End-to-end pass =
- `git log claude/flamboyant-diffie ^main` shows 1–3 new commits (not zero).
- Re-run of the six automated gates from Step 2 all green on the committed HEAD.
- All four manual gates green (user-reported).
- Audit docs show P0 Done + ReAct Partial-flagged.
- `gh pr create` merges cleanly; Render deploys; `curl https://career-guidance-ai-4aig.onrender.com/api/health` returns 200; scenarios 5, 6, 9 re-run against live URL.

## Open questions

- Confirm two-commit split vs. single squash for Step 1.
- Confirm `eval-rag` gate is dropped (recommended) vs. added as follow-up.
- Confirm whether audit-doc sync happens pre-merge (on branch) or post-merge (on main).

---

## New P0 — Report download failure (user-reported 2026-04-16)

User report: *"I was unable to download the report despite having the message that the report is ready."*

**Read-only investigation (already done; evidence below):**

| # | Finding | File:line |
|---|---|---|
| 1 | Frontend ignores the PDF URL — only opens HTML in new tab | `public/js/app.js:392` — `window.open(${API}${data.html})`. Backend returns both `pdf` and `html` at `src/server.ts:716–719` but `data.pdf` is discarded. |
| 2 | Action labeled "View Full Report" (not "Download") | `public/js/app.js:628` |
| 3 | `/exports` served as static from local fs | `src/server.ts:727` — `express.static(join(ROOT, "exports"))`. On Render free tier the disk is ephemeral; files can be wiped between request and click. |
| 4 | No persistent blob store | PDFs/HTMLs are fs-only; no DB column, no S3. |

**Most probable root cause (hypothesis):** combination of #1 + #3. User gets "ready" toast → clicks → tab opens HTML URL → Render ephemeral disk or pop-up blocker produces a broken/empty tab → user perceives "cannot download".

**Proposed fix (Change 6 — separate PR, NOT folded into Change 5):**
- **Frontend:** add a real "Download PDF" button that triggers `window.location = data.pdf` with `Content-Disposition: attachment` (backend already sets this for JSON pack — extend to PDF). Keep "View HTML" as a secondary action.
- **Backend:** ensure `exports/` dir is `mkdirSync(…, {recursive: true})` at server boot. Stream PDF bytes inline on `/api/export` when `format: "pdf"` is requested, bypassing fs entirely — makes it immune to ephemeral-disk wipes.
- **Optional hardening:** persist PDF as base64 in `sessions` table (small files, <500 KB typical) so retries from a fresh Render dyno still work.

**Verification steps (for Change 6):**
1. Trigger "Download PDF" on localhost → browser save dialog appears with `career-plan-<sessionId>.pdf`.
2. Same action on Render after a dyno restart (simulate ephemeral wipe) → PDF still streams successfully.
3. DevTools Network tab shows `Content-Type: application/pdf` + `Content-Disposition: attachment`.
4. Regression: HTML "View" path still works for users who want the in-browser view.

**Scope decision needed from user:** ship this as a Change 5 addition (delays merge; adds new code to the current PR) OR as a follow-on Change 6 PR (merges Change 5 first, then this). Recommended: **Change 6** — keeps Change 5's all-green gate state intact and gives the download fix its own focused review.

---

## Modifications log (this planning session — 2026-04-16)

Chronological record of what was done in this plan-mode session.

| # | Action | Artifact |
|---|---|---|
| 1 | Read Apr 14 sprint memory files (`project_apr14_sprint.md`, `feedback_branch_discipline.md`, `reference_audit_docs.md`) | `~/.claude/projects/…/memory/` |
| 2 | Verified branch state — `claude/flamboyant-diffie` HEAD = `main` HEAD (`74f4376`) → nothing committed | `git rev-parse` |
| 3 | Confirmed 18 modified + 3 new uncommitted files in `.claude/worktrees/flamboyant-diffie` | `git status` |
| 4 | Verified every Change 5 code claim against working tree (8 rows in §Verification of hand-off) | grep line numbers |
| 5 | Read `src/nodes/react-executor.ts` (139 lines) to document ReAct loop-protection mechanisms | 5-row guard table in plan |
| 6 | Confirmed LangSmith integration pre-existed (2026-03-28) and Change 5 logs target it | `server.ts:1212`, `render.yaml:24`, 4 new `event:` types |
| 7 | Investigated report-download bug user reported — identified 4 likely causes | `server.ts:680-724`, `app.js:374-402` |
| 8 | Wrote initial close-out plan | `~/.claude/plans/apr-14-sprint-is-warm-torvalds.md` |
| 9 | Per user direction, moved plan inside project tree | `Enhancement and others 14 Apr 2026/apr-14-sprint-closeout-plan.md` |
| 10 | Added §"ReAct implementation summary" (teammate feedback) with 5-guard loop-protection table | plan §ReAct |
| 11 | Rewrote Step 1 as literal bash commands (1a sanity → 1b/1c/1d commits → 1e verify) | plan §Step 1 |
| 12 | Added literal `gh pr create` with PR body + post-merge health check | plan §Step 5 |
| 13 | Expanded §Observability to call out LangSmith as the destination + 4 new event types | plan §ReAct |
| 14 | Added this modifications log + §"New P0 — Report download failure" | plan §tail |
| 15 | Kept plan file synced at both paths (project copy + canonical `~/.claude/plans/`) | `cp` after each edit |

**Files touched by this planning session (plan docs only — no source code modified):**
- `Enhancement and others 14 Apr 2026/apr-14-sprint-closeout-plan.md` (created + edited)
- `~/.claude/plans/apr-14-sprint-is-warm-torvalds.md` (created + mirror-synced)

**Files read but not modified (evidence gathering):**
`src/nodes/react-executor.ts`, `src/nodes/state-updater.ts`, `src/utils/errors.ts`, `src/utils/rag.ts`, `src/state.ts`, `src/report/report-helpers.ts`, `src/server.ts`, `src/tests/golden-path.test.ts`, `public/js/app.js`, `CLAUDE.md`, `package.json`, `render.yaml`, plus the three memory files.
