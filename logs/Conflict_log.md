# Conflict_log.md

Requirement conflict reports for the Career Guidance AI demo stabilization cycle.
Linked to DEMO_REQUIREMENTS_MATRIX_May02_updated.md — section 10.

All conflicts must be resolved with user confirmation before implementation proceeds.

---

## Conflict Table

| Conflict ID | Requirement A | Requirement B | Affected Node/File | Conflict Description | Risk | Suggested Resolution | User Confirmation | Status |
|---|---|---|---|---|---|---|---|---|
| CONF-001 | AN-001 — Contextual cue interpretation | E7 fix (Change 4) — `isConfirmation()` at `state-updater.ts:215` gates `learningNeedsComplete` statically | `src/nodes/state-updater.ts:215`, `agent_config/skills/*/analyzer.md` | AN-001 requires Analyzer to output a structured `turn_function` proposal with context; E7 fix uses a static word-list `isConfirmation()` inside State Updater, bypassing contextual interpretation. Replacing globally re-opens E7 regression (planning gate loop). | Medium | Keep `isConfirmation()` as narrow backward-compatible fallback for `learningNeedsComplete`/planning-gate (E7) only. Add `turn_function`, `referenced_prior_prompt`, `target_field`, `requires_orchestrator_gate`, `reason` to Analyzer output for all general cue interpretation. All cue-driven state updates/phase transitions/retrievals/report generation still pass Orchestrator/State Updater gates. | APPROVED 2026-05-03 | Resolved |
| CONF-002 | ARCH-001 — Strict Analyzer→Orchestrator→State Updater→Speaker node separation | Current `state-updater.ts` acts as both Orchestrator (`determineTransition`) and State Updater (all merge/write functions) in a single node | `src/nodes/state-updater.ts`, `src/graph.ts` | ARCH-001 requires traceable separation. A full architectural split into separate runtime nodes is a large refactor inconsistent with demo stabilization mode and the "no broad AI-generated rewrites" constraint. | High if refactored; Low if addressed via log markers only | Do not split the node. Implement logical separation inside the existing file using clearly named functions and structured log markers: `[ORCHESTRATOR_DECISION]`, `[STATE_WRITE]`, `[PHASE_DECISION]`, `[RETRIEVAL_GATE]`, `[REPORT_GATE]`. TST-002 verifies Analyzer output, Orchestrator decision, State Updater write, and Speaker response are distinguishable in logs/traces. | APPROVED 2026-05-03 | Resolved |
| CONF-003 | AN-001 — New Analyzer output schema (`turn_function`, `turn_confidence`, `referenced_prior_prompt`, `target_field`, `proposed_state_patch`, `requires_orchestrator_gate`, `reason`) | Current `AnalyzerOutput` type: `extracted_fields`, `required_complete`, `phase_suggestion`, `confidence`, `notes` | `src/nodes/analyzer.ts`, `src/state.ts`, `agent_config/prompts/analyzer_template.md` | New schema fields partially overlap/rename existing fields. `phase_suggestion + confidence` overlap with `turn_function + turn_confidence`. Full replacement breaks all existing prompt parsing. | Medium | Additive extension only. Do NOT remove or rename existing fields. Add new fields as optional. Update `analyzer_template.md` to request both sets. Downstream reads new fields when present; for cue/ambiguous turns when absent, defaults to safe behavior (preserve state, stay in phase, or ask clarification). No breaking schema migration before demo. | APPROVED 2026-05-03 | Resolved |

---

## Status Legend

| Status | Meaning |
|---|---|
| Pending | Conflict identified, awaiting user confirmation |
| Resolved | User confirmed resolution, safe to implement |
| Deferred | Deferred to post-demo cycle |
| Reopened | New evidence reopened the conflict |
