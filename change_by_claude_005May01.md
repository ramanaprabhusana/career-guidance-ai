# Change Log — Claude Session 005 (May 02, 2026)

## Source Documents
- **Design framework:** `/Users/niteentomar/Downloads/Chatbot/deliberations_May022026.md`
- **Rule tracking:** `/Users/niteentomar/Downloads/Chatbot/suggested_corrections_May022026.md`
- **Transcripts analysed:** SE→DA PDF, SE→DA→PM PDF, `chat text messages_After changes file.docx`

## Session Context

Post-demo review of the SE→DA→PM session recording. Three conversation breaks and two report defects were identified from the transcript and PDFs. The deliberations framework from `deliberations_May022026.md` was applied to root-cause each issue and select the minimum correct fix aligned with the principle:

> **LLM proposes. Code decides. State persists. Tests enforce.**

---

## Deliberation Summary

| Issue | Transcript Evidence | Root Cause | Deliberation |
|-------|--------------------|-----------:|--------------|
| **B2 — E7 double-ask** | Bot asks priorities + timeline together → user answers "6 months" → bot re-asks full block | `mergeRoleTargetingFields` fallback requires `learningNeedsCurrent.length > 0` to fire; empty on the timeline-only turn | Two options: (A) fix the fallback condition to fire on timeline alone; (B) change the speaker to never ask two slots in one message. Option B is correct per deliberations SP-002 ("one question at a time"). Option A is a symptom patch — the underlying speaker design is the bug. |
| **B4 — "nice" triggers report message** | User says "nice" → bot says "your detailed career plan report is being generated" | "nice" not in FILLER_PATTERNS; `isFillerOrAmbiguous("nice")` returns false; `user_intent` was probably `new_info` | Positive single-word reactions carry no career-fact information. They are structurally identical to "ok" after a statement (not a question). Per AN-004, the filler guard pattern list must include them. Extending the pattern list is correct per deliberations (deterministic code, not LLM) — the LLM should classify them too, but the pattern list is the guaranteed backstop. |
| **C1 — Evidence log wrong role** | SE→DA→PM PDF shows "[O*NET] Data Analyst" in PM plan evidence log | `evidenceKept[]` / `evidenceDiscarded[]` not cleared in `applyRoleSwitchPivot`; DA evidence carries over into PM plan | Per OR-011 and RPT-003, prior role evidence must not appear in the new role's active plan. DA evidence belongs only in `priorPlan` (Appendix A). The fix is a two-line clear in `applyRoleSwitchPivot` — trivial, correct, and does not affect the priorPlan snapshot. |
| **B1 — Orientation bleed (P1)** | "We're ready to explore what's next" emitted mid-skill-assessment | speaker-prompt-creator injects orientation-completion context even when assessment is active | P1 — bot self-recovers; fixing requires speaker-prompt-creator logic; deferred to next sprint. |
| **B3 — Block repeat (self-resolving)** | Understanding block asked twice; first "Yes, that's right" did not advance | Stall phrase on "Please generate" turn broke question-anchor chain; first confirmation not classified as "confirm" | SP-011 (Change 7) bans stall phrases. Without the stall, the question anchor chain stays intact and the first confirmation advances the block. B3 should resolve transitively. SC-009 (pending-confirmation state channel) is P1 hardening for belt-and-suspenders. |

---

## P0 Rules Being Implemented in This Change

Format matches `suggested_corrections_May022026.md`.

| ID | Priority | Component / Node | Journey / Scope | Rule / Logic | Trigger / Condition | Expected System Behavior | Must Not Happen | Implementation Location | Verification | Status | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AN-013 | P0 | Analyzer / Filler Guard | All phases | Positive single-word reactions must be classified as filler; must not trigger state writes or report-generation messages | User says `nice`, `great`, `cool`, `wow`, `thanks`, `awesome`, `excellent`, `perfect`, `interesting`, `lovely` | Filler guard fires; analyzerOutput stripped of durable writes; speaker produces a natural continuation question | `nice` causes bot to emit "your detailed career plan report is being generated" | `src/nodes/filler-guard.ts` — extend `FILLER_PATTERNS` regex list | TC-011: say "nice" after a plan block is confirmed; verify bot does NOT emit report message; verify target_role and planBlocks unchanged | In Progress | Bug B4. Positive reactions fail FILLER_PATTERNS check → not caught as filler → bot treats as `new_info` → incorrect downstream action. Fix: add `/^(nice|great|cool|wow|thanks|thank you|awesome|excellent|perfect|interesting|lovely|sounds good|looks good|good|noted)$/` to FILLER_PATTERNS. |
| OR-011 | P0 | Orchestrator / State Updater | Role switch | On role pivot, clear evidenceKept and evidenceDiscarded so the new role's report evidence log shows only the new role's O*NET evidence | `applyRoleSwitchPivot()` is called in state-updater.ts | PM report evidence log contains only PM O*NET entries; DA evidence appears only in Appendix A (priorPlan) | PM report shows "[O*NET] Data Analyst" evidence entry | `src/nodes/state-updater.ts` — inside `applyRoleSwitchPivot()`, add `updates.evidenceKept = []; updates.evidenceDiscarded = [];` | TC-013: complete DA session → pivot to PM → export PM report → verify evidence log contains PM O*NET only | In Progress | Bug C1. SE→DA→PM PDF evidence log shows "[O*NET] Data Analyst" in PM plan. `evidenceKept[]` is not cleared on pivot. The priorPlan snapshot already captures DA evidence separately. |
| SP-009 | P0 | Speaker | Post-assessment learning needs | Post-assessment slot collection must be sequential: Step 3a asks learning priorities only; bot waits for user reply; Step 3b (separate message) asks timeline only. Never combine both questions in one message. | After `userConfirmedEvaluation = true` and all skills rated; speaker enters Step 3 of post-assessment flow | Turn N: "Which of these gaps feel most urgent to you?" → Turn N+1 (user answers any skill) → Turn N+2: "Do you have a rough timeframe in mind?" → Turn N+3 (user answers) → `learningNeedsComplete = true` | Both questions combined in one message; user answers only one; bot re-asks the full combined block (E7 regression) | `agent_config/skills/exploration_role_targeting/speaker.md` — rewrite Step 3 into two sequential sub-steps (3a and 3b) | TC-012: rate all skills → confirm evaluation → verify bot asks priorities only → answer one skill → verify bot asks timeline only → answer → verify no re-ask → verify learningNeedsComplete fires | In Progress | Bug B2. Combines SP-002 (one question at a time) with post-assessment slot collection. Root: Speaker.md Step 3 says "ask TWO things" in one message. When user answers only timeline: `learningNeedsCurrent.length = 0` → fallback condition cannot fire → bot re-asks. Fix is in the speaker instruction, not the state-updater condition. |

---

## Files to Change

| File | Change | Rule(s) |
|------|--------|---------|
| `src/nodes/filler-guard.ts` | Extend `FILLER_PATTERNS` to include positive single-word reactions | AN-013 |
| `src/nodes/state-updater.ts` | Add `updates.evidenceKept = []; updates.evidenceDiscarded = [];` inside `applyRoleSwitchPivot()` after existing `reportGenerated = false` line | OR-011 |
| `agent_config/skills/exploration_role_targeting/speaker.md` | Rewrite Step 3 of Post-Assessment Flow into sequential 3a (priorities) and 3b (timeline); ban combined asking | SP-009 |

---

## Rules NOT Changed in This Sprint

| Rule | Reason deferred |
|------|----------------|
| SP-010 — Orientation bleed suppression | P1; bot self-recovers; requires speaker-prompt-creator logic change; post-demo |
| SC-009 — Pending confirmation question anchor | P1; B3 self-resolves with Change 7 stall phrase ban; SC-009 is belt-and-suspenders |
| AN-001 / AN-002 — Full turn_type enum + Zod validation | P1; structural change; out of MVP scope |
| OR-002 — Confidence threshold gate | P1; confidence field exists but no deterministic gate |
| TST-001 through TST-005 — Full regression test suite | Post-demo |

---

## Verification Plan

```
1. npx tsc --noEmit          → must be clean
2. npm run validate-config   → must pass 21/21
3. npm run golden            → must pass 14/14
4. Manual TC-011: say "nice" after plan block → no report message
5. Manual TC-012: rate PM skills → confirm eval → bot asks priorities only → answer → bot asks timeline only
6. Manual TC-013: complete DA → pivot PM → export → check PDF evidence log
```

---

## What Was Already Implemented (Changes 1–7, for traceability)

The following rules from `suggested_corrections_May022026.md` are marked **Implemented** as a result of Changes 1–7 (pre-this session):

| Rule | Implemented by |
|------|---------------|
| AN-003, AN-004, AN-005, AN-006, AN-007, AN-008 | Changes 4–6 |
| OR-001, OR-003, OR-004, OR-006, OR-007, OR-008, OR-009, OR-012 | Changes 1–4, Change 7 |
| SP-001, SP-003, SP-011 | Changes 1–3, Change 7 |
| ST-001 through ST-009 (except ST-006, ST-010) | Changes 1–4 |
| SC-002 through SC-007 (except SC-001, SC-008, SC-009) | Changes 1–5 |
| MEM-001 through MEM-007, MEM-009 | Changes 1–4, Change 7 |
| RE-001, RE-002, RE-003, RE-005 | Change 5 |
| RAG-001, RAG-002, RAG-005 | Changes 5, 7 |
| RPT-001 through RPT-005 | Changes 4–6 |
| SQL-001, SQL-002, SQL-003 | Changes 1–4 |
