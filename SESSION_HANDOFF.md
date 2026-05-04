# SESSION HANDOFF — ETB Career Guidance AI

> **Drop this file at the start of any new Claude Code session to resume without re-reading source files.**
> Last updated: 2026-05-04 (SOS P0 fix — RAG alias + ERR-004 orientation)

---

## Project

- **Course:** MGMT 59000 Emerging Tech in Business — Final Project (Purdue Spring 2026)
- **App:** Career Guidance AI chatbot — 4-phase flow (orientation → exploration → planning → export)
- **Stack:** Node 20 / TypeScript / Express / LangGraph / Gemini 2.5 Flash / SQLite / Render free tier
- **Worktree path:**
  `/Users/prabhusana/Library/CloudStorage/OneDrive-purdue.edu/Spring 2026/MGMT 59000 Emerging Tech in Business/Final Project/Execution final deployment/.claude/worktrees/determined-dubinsky-dc48dd/`
- **Inner project:** project files are directly in the worktree root (no subfolder)
- **Production URL:** `https://career-guidance-ai-4aig.onrender.com`

---

## Branch & Merge Status (as of 2026-05-04)

| Branch | Status |
|---|---|
| `claude/flamboyant-diffie` | Change 5 (P0 fixes + scoped ReAct/RAG) — **merged to main** |
| `claude/determined-dubinsky` | Change 10 (planning speaker stall fix) + SOS P0 fixes — **PR #8 open** |

**PR #8 contains:**
1. ERR-005 fix — planning speaker no longer generates forbidden phrases (MANDATORY OVERRIDE in speakerPromptCreator)
2. SOS P0 fix — RAG alias map for "Social Media Strategist" → "Marketing Managers"
3. ERR-004 fix — orientation speaker accepts "I recently graduated" without generic clarification
4. 4 new TST-SOS regression tests

---

## What Has Been Completed

| Change | What | Status |
|---|---|---|
| Change 1–3 | Baseline 4-phase flow, skills assessment, learning-needs gating | Merged / deployed |
| Change 4 | Role memory, persona detection, role-switch rehydration, industry caps, plan continuity | Merged / deployed |
| Change 5 | targetRole drift fix, silent RAG substitution fix, planning loop fix, PDF readiness fix | Merged to main |
| DEMO_REQUIREMENTS_MATRIX Phase 0–9 | logs/ created, analyzer schema extended, trace markers, 54 golden tests | In worktree |
| Change 10 | Planning speaker stall (ERR-005) — MANDATORY OVERRIDE append in speakerPromptCreator | PR #8 open |
| SOS P0 | RAG alias map for "Social Media Strategist" in `src/utils/rag.ts` | PR #8 open |
| ERR-004 | Orientation speaker graduation-context exception | PR #8 open |

---

## What Needs to Be Done Next

### Immediate: Merge PR #8 → main → Redeploy

```bash
# Check PR #8 status
gh pr view 8
# Merge after review
gh pr merge 8 --squash
# Verify Render deploy
curl https://career-guidance-ai-4aig.onrender.com/api/health
```

### After Merge: Run UAT Demo Path

Follow the **SOS Demo Script** below on the live URL. Verify:
1. "I recently graduated" → no generic clarification
2. "Social Media Strategist" → `RAG_ALIAS_RESOLVED` in logs → 6 skills load
3. Planning blocks advance one by one
4. Export button → 200 response → completion card

---

## SOS Demo Script (Social Media Strategist Path)

| Step | User says | Expected |
|---|---|---|
| 1 | "I recently graduated." | Accepted as recent graduate, moves to next field — no clarification |
| 2 | "I am not sure what I should aim for." | Orientation continues |
| 3 | "I am interested in strategy, communication, and creative messaging." | Interests noted |
| 4 | "I am looking for advertising." | Industry captured |
| 5 | "Creating compelling messages." | Activity preference noted |
| 6 | "Social Media Strategist." | Role targeted |
| 7 | "Yes, that is the role I want to explore." | Role confirmed; RAG alias fires; 6 skills load |
| 8 | Rate all skills: Beginner / Intermediate / Advanced | Skills rated one by one |
| 9 | "This summary is correct." | `userConfirmedEvaluation = true` |
| 10 | "3 months." | `timeline` set |
| 11 | Confirm each plan block contextually | Blocks advance via resolveUserConfirming 3-tier |
| 12 | "Plan sums up well. Please generate report." | Speaker offers export button (no restart) |
| 13 | Click export button → POST /api/export | 200 response; completion card shows |

**Expected final state:** Report title = "Social Media Strategist" (not "Marketing Managers").

---

## Key Architectural Facts (do not re-derive)

| Fact | Detail |
|---|---|
| Report generation | `reportGenerated` set ONLY by POST `/api/export` — NEVER in chat flow |
| `isComplete` trigger | `transitionDecision === "complete"` (server.ts line 808); requires `reportGenerated=true` |
| Plan block confirmation | 3-tier: (1) `turn_function=confirm AND referenced_prior_prompt=true`; (2) `user_intent=confirm`; (3) `isConfirmation()` static backstop |
| Filler guard | Does NOT touch `turn_function`/`user_intent` — only zeroes `extracted_fields`, `required_complete`, `phase_suggestion`, `confidence` |
| `applyTargetRoleWrite` | ALL writes to `state.targetRole` MUST go through this helper (never direct assign) — blank/null rejected silently |
| RAG blank role guard | `retrieveSkillsForRole("")` throws `RAG_BLANK_ROLE`; orchestrator sets `needsRoleConfirmation=true` instead |
| RAG alias map | `ROLE_RETRIEVAL_ALIASES` in `src/utils/rag.ts` (exported) — maps display roles to O*NET-retrievable titles for local fuzzy match and live API; alias is RAG-internal only, never touches state |
| `seedPlanBlocks` | Seeds 4 blocks on planning entry: `understanding`, `skills`, `courses`, `end_goal` (skips `path` if `recommendedPath` null) |
| `advanceNextPlanBlock` | Flips next unconfirmed block; called when `planBlockUserConfirming = true` in state-updater |
| MANDATORY OVERRIDE | Appended at very end of speaker prompt when `currentPhase==="planning"` and next unconfirmed block exists — overrides TASK section |

---

## Files Most Likely to Need Reading in a New Session

| File | Why |
|---|---|
| `src/nodes/state-updater.ts` | Orchestrator + state writes (1500+ lines); start at `determineTransition` ~line 256, `resolveUserConfirming` ~line 573 |
| `src/utils/rag.ts` | `ROLE_RETRIEVAL_ALIASES` (top), `retrieveSkillsForRole` (~line 340) |
| `agent_config/skills/orientation/speaker.md` | Graduation-context edge case (ERR-004 fix) |
| `agent_config/skills/planning/speaker.md` | MANDATORY block delivery (top of file, Change 10) |
| `src/nodes/speaker-prompt-creator.ts` | MANDATORY OVERRIDE append (end of file, Change 10) |
| `src/tests/golden-path.test.ts` | Regression gate — 58 assertions, including TST-SOS-001 to TST-SOS-004 |
| `logs/ERROR_TRACKING_LOG.md` | Full error history |
| `CLAUDE.md` | Full architectural reference |

---

## Verification Commands

```bash
cd <worktree-root>

npx tsc --noEmit          # must stay clean
npm run validate-config   # 21/21
npm run golden            # 58/58 assertions (as of 2026-05-04)
npm run eval-fixtures     # 30/30
npm run smoke             # requires GOOGLE_API_KEY
```

---

## Governing Rules for All Future Sessions

1. Follow existing architecture — no redesign of analyzer, orchestrator, speaker, RAG, memory, ReAct, persistence, export.
2. No P1/P2 enhancements unless explicitly requested.
3. No `npm audit fix`.
4. No push / relink remotes.
5. Create dated backup before any code changes (rsync excluding .git, node_modules, .env, logs, data/profiles.db, exports).
6. Preserve `displayTargetRole` separately from `skillsRetrievalRole` — alias is RAG-internal only.
7. Fix by state/context — not hard-coded English phrases.
8. Every change must trace to a failing state, log, test, or transcript.
9. All errors use `AgentError(code)` from `src/utils/errors.ts`; codes in `agent_config/error_catalog.md`.
10. All RAG calls go through `runTool` in `src/nodes/tool-executor.ts` — never inline.
11. All `state.targetRole` writes go through `applyTargetRoleWrite` — never direct assignment.

---

## Open Items / Known Risks

| Item | Priority | Notes |
|---|---|---|
| Merge PR #8 | P0 | Contains all SOS fixes + Change 10 |
| UAT re-run on live URL | P0 | After Render redeploy — verify SOS demo script end-to-end |
| Contextual plan confirmations | Risk (monitor) | "This path aligns with our discussion" relies on LLM classifying `turn_function=confirm`; if misclassified, user needs clearer "yes" / "correct" |
| ERR-004 P0 downgrade | Done | Originally reported as P2 UX; now fixed as P1 demo quality |
| DEMO_REQUIREMENTS_MATRIX Phases 1–9 | Implemented | Analyzer schema extension, trace markers, 54 golden tests — all in worktree |

---

## Backup Location (2026-05-04)

`~/Desktop/etb-backup-20260504-174542/`
