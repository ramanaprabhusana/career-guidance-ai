# Cursor / Claude Working Prompt

Use this prompt separately. Do not embed it inside `DEMO_REQUIREMENTS_MATRIX_May02.md`.

```text
We are in demo stabilization mode.

Use DEMO_REQUIREMENTS_MATRIX_May02.md as the single source of truth.

Do not add a central rule engine.
Do not add new features.
Do not implement unresolved conflicting requirements.
Do not modify unrelated files.

Task:
Map the following requirement IDs to existing files:
[LIST REQUIREMENT IDS]

Before coding:
1. Identify affected files.
2. Identify existing duplicate or conflicting logic.
3. Create a conflict report if any conflict exists.
4. Propose minimal implementation plan.
5. Wait for confirmation before coding if conflicts exist.
6. Add/update tests linked to requirement IDs.
7. Update Audit_log.md and CHANGELOG_TECH.md / CHANGELOG_FEATURES.md using tabular format.

For cue handling:
Do not implement a static cue-word dictionary as the main decision mechanism.
Cue words are weak signals.
Analyzer must infer the user turn function from current phase, prior assistant prompt, active state, missing fields, explicit user content, and conversation summary.
Analyzer may propose a state patch, but it must not write state.
Orchestrator must validate Analyzer’s proposal using deterministic gates before any state update, phase transition, retrieval, or report generation.
State Updater must persist only Orchestrator-approved patches.

Implementation must preserve:
- Analyzer proposes only.
- Orchestrator decides phase/tool/state/report gates.
- State Updater validates and persists approved writes.
- Speaker communicates only.

Required output before implementation:
1. Requirement-to-file mapping table
2. Conflict report, if any
3. Minimal implementation plan
4. Test plan with requirement IDs
5. Changelog/audit update plan

If no conflict exists, proceed only with the listed requirement IDs.
If conflict exists, stop and ask for confirmation before coding.
```

**Additional instruction: Error logging and recovery tracking**

Implementation must follow the project’s base Skill 8 and Skill 9 principles.

Skill 8 expectation:
Errors should follow a controlled recovery path: retry where safe, degrade gracefully, fallback where needed, preserve state integrity, and avoid corrupting user/session state.

Skill 9 expectation:
Testing/debugging should be traceable through config validation, integration checks, realistic multi-turn scenarios, observability into prompts, raw outputs, state changes, tool calls, and orchestrator decisions.

Before implementing or fixing any issue, create or update an error log table in `Audit_log.md` or `ERROR_TRACKING_LOG.md`.

Use this table format:

| Error ID | Date/Time | Requirement ID(s) | Feature / Logic | Feature Code / Component | Process Stage | Stage Actor | What Went Wrong | Why It Occurred | Recovery Path | Current Status | Test ID(s) | Evidence / Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Required field guidance:

- `Error ID`: sequential, e.g., ERR-001
- `Date/Time`: local timestamp when observed or updated
- `Requirement ID(s)`: link to DEMO_REQUIREMENTS_MATRIX_May02.md
- `Feature / Logic`: role switch, cue handling, report readiness, ReAct/RAG retrieval, memory hydration, etc.
- `Feature Code / Component`: file/module/function if known
- `Process Stage`: analyze, orchestrate, state update, retrieval, memory, report, speaker, UI, test
- `Stage Actor`: Analyzer, Orchestrator, State Updater, Speaker, Bounded ReAct, RAG, Vector DB, Memory, Report Export, UI
- `What Went Wrong`: observable failure
- `Why It Occurred`: root cause or current hypothesis
- `Recovery Path`: retry, degrade, fallback, terminate, state-preserve, or manual fix
- `Current Status`: Reported, WIP, Rectified, Reopened, Deferred
- `Test ID(s)`: linked regression or trace tests
- `Evidence / Notes`: trace link, log snippet, screenshot, transcript, or report reference

Rules:
1. Do not log vague errors without requirement IDs.
2. Do not mark an error “Rectified” unless a linked test passed.
3. If root cause is unclear, mark `Why It Occurred` as “Hypothesis” and keep status as WIP.
4. If two requirements conflict, create a conflict report first and do not implement until confirmed.
5. Preserve state integrity during recovery. A failed tool call, report generation, or retrieval step must not corrupt active role, memory, skill ratings, or report readiness.
6. For demo readiness, prioritize P0 errors tied to cue handling, phase movement, role switch, second-role assessment/report, ReAct/RAG retrieval, memory, and report UI cleanup.