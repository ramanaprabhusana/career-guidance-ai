# Skills checklist — Claude summary (as-on-date)

**Purpose:** One place to see **Skills 1–10** status for the **whole system** and what would move **Partial → Strong**.  
**Code baseline:** `career-guidance-ai` **`origin/main`** @ **`74f4376`**.  
**Last updated:** 2026-04-16 (Change 5 committed on `claude/flamboyant-diffie` @ `b132557`; Change 6 committed on `claude/change6-report-download` @ `fa48daf` — PR #2)  

---

## Change 5 / Change 6 update (2026-04-16) — P0 rows now Done

| Original P0 row | Status | Where it was fixed |
|---|---|---|
| Keep `targetRole` stable in planning | **Done (Change 5)** | `applyTargetRoleWrite` in `src/nodes/state-updater.ts:55`; guarded at 4 merge sites; logs every real change. Covered by `src/tests/golden-path.test.ts` group [1]. |
| Safe skill retrieval — no silent unrelated-role RAG | **Done (Change 5)** | `RAG_BLANK_ROLE` error code + `needsRoleConfirmation` state channel; RAG short-circuits when `targetRole` blank. Covered by golden group [2]. |
| Analyzer preserves fields on low-signal turns | **Done (Change 5)** | `applyTargetRoleWrite` rejects blank writes; analyzer thin-reply rule added. |
| Planning speaker — stop "preparing your plan" loop | **Done (Change 5)** | `seedPlanBlocks` on planning entry + `advanceNextPlanBlock` on confirmation; speaker escape-hatch removed. Covered by golden group [3]. |
| Do not re-ask target role | **Done (Change 5)** | `needsRoleConfirmation` gate only fires when genuinely missing. |
| PDF/report title ↔ badge mismatch | **Done (Change 5)** | `getDisplayRole` in `src/report/report-helpers.ts` — single source of truth for role label across PDF and HTML. Covered by golden group [5]. |
| TECH READY 0% when 100% assessed | **Done (Change 5)** | `computeReadinessStats` splits `assessmentPct` from `strengthPct` — no longer conflated. Covered by golden group [4]. |
| P0 journey test (Recent Graduate → Corporate Finance Analyst) | **Done (Change 5)** | `src/tests/golden-path.test.ts` — 14 deterministic assertions, wired as `npm run golden`. |
| **Report download unreachable** (user report, Apr 16) | **Done (Change 6)** | New `GET /api/report/:sessionId.pdf` endpoint with `Content-Disposition: attachment` + regenerate-on-demand (disk-wipe safe). Frontend uses `<a download>` anchor instead of `window.open`. Button relabeled "Download Report (PDF)". |

Remaining Partial rows are untouched by Change 5/6 and stay as-is until the next sprint.


**Field evidence (April 12):** `April12 feedback/Recent Graduate.txt` (planning loop, lost target role, wrong suggested role) and PDF screenshots (**0% TECH READY** while **100% assessed**; header role vs badge role mismatch). These are **production bugs**, not plan stretch goals.

This file does **not** list stretch items from the project plan. It reflects **skills / architecture** gaps, doc drift, and **observed failures**.

---

## Skills 1–10 — status snapshot (system-wide)

**Strong** = matches the skill’s intent in shipped code/config with no material gap.  
**Partial** = works in production but missing pieces, doc/code drift, weak tests, or **known user-visible failures**.

| Skill | Topic | Status |
|-------|--------|--------|
| **1** | Phase skill files (`agent_config/skills/...`) | **Strong** |
| **2** | Analyzer prompts + extraction | **Partial** |
| **3** | Speaker prompts + user-facing reply (incl. planning UX) | **Partial** |
| **4** | State schema (design vs runtime) | **Partial** |
| **5** | Phase registry | **Strong** |
| **6** | Orchestrator rules vs code | **Partial** |
| **7** | Conversation history + rolling summary | **Strong** |
| **8** | Error recovery catalog + behavior | **Partial** |
| **9** | Testing + config validation | **Partial** |
| **10** | Domain customization process | **Partial** |

**Note:** **Skill 2** moved to **Partial** because bad or empty extractions on short replies (“ok”) likely contribute to **lost `targetRole`** and wrong tool/RAG behavior (ties April 12 transcript). **Skill 3** moved to **Partial** because of **repeated planning lines**, **re-asking target role**, and **chat vs export** feeling out of sync.

---

## Actionable items (Partial → Strong)

Strong skills (**1, 5, 7**) need **no change** for this checklist—just avoid regressions when editing nearby code.

Repeat **Skill** on each row when several steps are needed. Order is **rough priority** (P0 first).

| Skill | Actionable |
|-------|------------|
| **6** | **P0 — Keep `targetRole` stable in planning:** Trace merges in `state-updater.ts` so thin user messages (“ok”, “I think we already covered it”) do **not** clear or replace `targetRole`. Add logging when `targetRole` changes. |
| **6** | **P0 — Safe skill retrieval:** If `targetRole` is missing or ambiguous, **do not** silently load skills for an unrelated occupation (April 12: jump to **Data Entry Keyer**). Require a confirmed role or explicit user pick before RAG/tool fetch. |
| **2** | **P0 — Analyzer on low-signal turns:** When the user sends acknowledgment-only text, **prefer preserving** prior extracted fields (especially `target_role`) instead of empty deltas that let orchestration drift. |
| **3** | **P0 — Planning speaker:** Stop **repeating** “we’re preparing your plan” without advancing **plan blocks** or clear next step. Align speaker skill + gates with `planBlocks` / `reportGenerated` rules. |
| **3** | **P0 — Do not re-ask target role** if `targetRole` is already set unless the user explicitly changes track or resets. |
| **3** | **P1 — PDF/report consistency:** Fix **title vs badge** mismatch (e.g. header “Software Engineer” vs green badge “Data Analyst” / “Technical Product Manager”) by using **one clear rule** (e.g. current job vs target role) everywhere in `pdf-generator` / `html-generator`. |
| **3** | **P1 — TECH READY 0% bug:** When assessment is **100%** and skills exist, **0% TECH READY** is wrong. Audit how technical vs soft readiness is computed (`skill_type`, `categorizeSkillType`, report aggregations); add a **unit or snapshot test** on export output. |
| **4** | Pick **one** official source of truth (`state.ts` *or* `state_schema.json`) and document it in one short readme note. |
| **4** | Add **automated checks** so `state_schema.json` and `state.ts` do not drift; fail CI when they disagree. |
| **4** | **P1 — Planning-phase field audit:** List every place `targetRole`, `jobTitle`, `track`, and `sessionGoal` are written; ensure explore vs pursue paths cannot overwrite each other by mistake. |
| **6** | **Either** enforce transition **confidence** in `state-updater.ts` as `orchestrator_rules.md` says **or** change the markdown to match real code. |
| **6** | Close **BR-6** (handoff after repeated failures) with a user message + state flag **or** mark “not implemented” in rules. |
| **6** | Add **tests** for main phase transitions (orientation → exploration → role targeting → planning). |
| **8** | Map **`error_catalog.md`** codes to **short user-safe messages** in one place. |
| **8** | Short **recovery playbook** for top codes (retry, rephrase, stop). |
| **8** | **Automated prompts** that hit error paths without crashing. |
| **9** | **Validate** Analyzer JSON (e.g. Zod) before merge; retry or safe fallback on failure. |
| **9** | **P0 journey test:** Script or fixture: **recent graduate → explore → pick role (e.g. Corporate Finance Analyst) → rate all skills → plan**; assert `targetRole` unchanged and no spurious role switch. |
| **9** | **P1 export test:** After assessment, PDF metrics must not show **0% TECH READY** if technical skills are present in state (Software Engineer / TPM style path). |
| **9** | Document **one command** (e.g. `npm run check`) before merge. |
| **10** | One-page **process note** for reviewing/releasing `agent_config/` changes. |

---

## Map to other Project Files (what to prioritize)

Use this when updating [`architecture_target_vs_current.md`](architecture_target_vs_current.md) and [`project_plan_comp_checklist.md`](project_plan_comp_checklist.md).

| Theme | `architecture_target_vs_current.md` | `project_plan_comp_checklist.md` |
|--------|-------------------------------------|----------------------------------|
| Lost / wrong **target role** | §3 **orchestrator**, **tool/RAG**, **state**; §6–7 | **Role capture**, **Chat orchestrator**, **Memory** rows |
| Planning **loop** / chat vs plan | §3 **planning / export**, **Skill 3** | **Multi-phase conversation**, **Export** |
| **0% TECH READY** / missing technical in PDF | §3 **Export**, track-aware / tech vs soft | **Export / Report** (track-aware, technical vs soft) |
| **Header vs badge** role mismatch | §3 **Export** | Same **Export / Report** rows |
| **Tests** | §7 **Skill 9** | **Quality / Evaluation** rows |

**Priority order for the team:** (1) **State + orchestration + RAG/tool guard** for `targetRole`, (2) **planning speaker + plan blocks**, (3) **PDF readiness math + role labeling**, (4) schema drift + catalog + docs.

---

## How to use this file

- Use with [`architecture_target_vs_current.md`](architecture_target_vs_current.md) and [`project_plan_comp_checklist.md`](project_plan_comp_checklist.md).  
- When **`origin/main` moves**, re-check status after review.  
- Bump **Last updated** when you edit this file.
