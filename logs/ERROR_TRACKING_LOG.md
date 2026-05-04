# ERROR_TRACKING_LOG.md

Error log for the Career Guidance AI demo stabilization cycle.
Follows Skill 8 (controlled recovery) and Skill 9 (traceable debugging) principles.
Linked to DEMO_REQUIREMENTS_MATRIX_May02_updated.md.

Rules:
1. Do not log vague errors without requirement IDs.
2. Do not mark "Rectified" unless a linked test passed.
3. If root cause is unclear, mark `Why It Occurred` as "Hypothesis" and keep status as WIP.
4. If two requirements conflict, create a Conflict_log.md entry first.
5. Preserve state integrity during recovery — failed tool calls, report generation, or retrieval must not corrupt active role, memory, skill ratings, or report readiness.
6. Prioritize P0 errors tied to cue handling, phase movement, role switch, second-role assessment/report, ReAct/RAG retrieval, memory, and report UI cleanup.

---

## Error Table

| Error ID | Date/Time | Requirement ID(s) | Feature / Logic | Feature Code / Component | Process Stage | Stage Actor | What Went Wrong | Why It Occurred | Recovery Path | Current Status | Test ID(s) | Evidence / Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ERR-001 | 2026-05-03 | AN-001, OR-002, ST-001 | Cue handling — static word-list `isConfirmation()` used as primary cue mechanism | `src/nodes/state-updater.ts:215` — `isConfirmation()` function | Orchestrate | Orchestrator / State Updater | `isConfirmation()` classifies "ok", "yes", "sure" as confirmations without checking prior assistant prompt, active state, or phase context. Weak cues can trigger state writes or phase transitions incorrectly. | Implemented as E7 planning-gate fix (Change 4) using simple token list; no context threading was added at the time | Scope `isConfirmation()` to `learningNeedsComplete` gate only (CONF-001 resolution). Add Analyzer-level `turn_function` + gates for all other cue handling. | Resolved — implementing Phase 2–3 | TST-001-CUE-01, TST-001-CUE-02, TST-001-CUE-04 | CONF-001 confirmed 2026-05-03; see Audit_log AUD-001 |
| ERR-002 | 2026-05-03 | ARCH-001, TST-002 | Architectural traceability — Orchestrator and State Updater responsibilities not distinguishable in runtime logs/traces | `src/nodes/state-updater.ts` — `determineTransition()` and all merge functions co-located | Orchestrate / State Update | Orchestrator, State Updater | TST-002 trace audits cannot distinguish `[ORCHESTRATOR_DECISION]` from `[STATE_WRITE]` without explicit log markers. Node responsibility is logically separated by function name but not traceable in output logs. | Single-node design chosen for simplicity during Change 1–2; never retrofitted with trace markers | Add structured log markers: `[ORCHESTRATOR_DECISION]`, `[STATE_WRITE]`, `[PHASE_DECISION]`, `[RETRIEVAL_GATE]`, `[REPORT_GATE]` inside existing node (CONF-002 resolution) | Resolved — implementing Phase 1 | TST-002-ARCH, TST-002-STATE, TST-002-PHASE | CONF-002 confirmed 2026-05-03; see Audit_log AUD-002 |
| ERR-003 | 2026-05-03 | AN-001, AN-002 | Analyzer output schema missing contextual cue fields required by AN-001 | `src/nodes/analyzer.ts`, `src/state.ts` — `AnalyzerOutput` interface, `agent_config/prompts/analyzer_template.md` | Analyze | Analyzer | `AnalyzerOutput` does not emit `turn_function`, `referenced_prior_prompt`, `target_field`, `proposed_state_patch`, `requires_orchestrator_gate`, or `reason`. Downstream Orchestrator gates cannot validate cue intent without these fields. | Fields not in original design (Changes 1–5); AN-001 requirement introduced in DEMO_REQUIREMENTS_MATRIX_May02 | Additive schema extension — add new fields as optional; update analyzer_template.md to elicit both old and new fields; downstream reads new fields when present, falls back safely when absent (CONF-003 resolution) | Resolved — implementing Phase 2 | TST-001-CUE-01, TST-002-CUE | CONF-003 confirmed 2026-05-03; see Audit_log AUD-003 |
| ERR-004 | 2026-05-03 18:12 | SP-001, SP-002, OR-003 | Orientation clarification prompt too generic when user gives a non-title response | `agent_config/skills/orientation/speaker.md` — clarification response template | Speaker | Speaker | When user replies "I recently graduated" to the job-title question, the bot responds "I want to capture that accurately. Could you clarify what you mean?" — correct to hold gate, but the ask is vague and doesn't guide the user toward an acceptable answer (e.g. "Recent Graduate", degree type, or target role) | Speaker skill file lacks a specific example/hint for the graduation-context clarification path; generic clarification template fires instead | Degrade gracefully — current behavior preserves orientation gate (no bad state write). UX fix: add graduation-context hint to orientation speaker.md clarification instructions | Reported | UAT-OBS-001 | UAT screenshot 2026-05-03 — Turn 2, Phase: Profile. User said "I recently graduated"; bot replied with generic clarification. No state corruption observed. P2 UX issue, not a P0 blocker. |
| ERR-005 | 2026-05-03 20:00 | SP-003, OR-003 | Planning stall — speaker generates forbidden phrases instead of presenting plan block content | `src/nodes/speaker-prompt-creator.ts` — prompt assembly; `agent_config/skills/planning/speaker.md` — MANDATORY block delivery section; `agent_config/prompts/speaker_template.md` — TASK section | Speaker | Speaker / SpeakerPromptCreator | For 4+ consecutive planning turns, bot outputs forbidden phrases ("I'm now putting together your personalized plan") with NO subsequent plan block content. When user says "Present the complete plan", bot replies with generic clarification. | `speaker_template.md` TASK section ("smoothly conclude and prompt forward") appears at END of assembled prompt; LLMs weight end-of-prompt text more heavily; MANDATORY block delivery in `planning/speaker.md` appears mid-prompt and is overridden | Change 10: (A) append MANDATORY OVERRIDE block at very end of speaker prompt in `speakerPromptCreator` when in planning phase and next block exists; (B) move Block-by-Block Delivery section to TOP of `planning/speaker.md` | Rectified — Change 10 implemented 2026-05-03 | UAT-OBS-002 | UAT transcript 2026-05-03 — planning phase with 4 seeded blocks; 7-turn stall. Root cause: LLM over-weighted TASK section vs. MANDATORY skill instruction. Fixed by post-template prompt append. |

---

## Status Legend

| Status | Meaning |
|---|---|
| Reported | Error identified, not yet being worked |
| WIP | Work in progress |
| Rectified | Fixed and linked test passed |
| Reopened | Regression or new evidence reopened |
| Deferred | Deferred to post-demo cycle |
