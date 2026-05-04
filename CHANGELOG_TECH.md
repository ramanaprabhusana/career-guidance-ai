# Changelog — Technical

All technical, architectural, and infrastructure changes to the Career Guidance AI Assistant.

---

## v3.0.0 (Planned)
**Date:** 2026-04-02
**Architecture diagram:** [docs/architecture/architecture-3.0.0.mmd](docs/architecture/architecture-3.0.0.mmd)

- Added 3 new route modules (resume, interview, resources) as Express Router middleware
- Extended AgentState with resumeProfile, interviewSessions[], recommendedResources[]
- Standalone processing pipelines for resume and interview (not LangGraph subgraphs)

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| TBD | src/routes/resume.ts | Added resume upload + confirm route module | Added new file (Multer + pdf-parse + mammoth) |
| TBD | src/routes/interview.ts | Added interview start + answer route module | Added new file |
| TBD | src/routes/resources.ts | Added resource recommendation route module | Added new file |
| TBD | src/services/resume-extractor.ts | Added PDF/DOCX text extraction + LLM structuring service | Added new file |
| TBD | src/interview/question-generator.ts | Added mode-based question generation with O*NET grounding | Added new file |
| TBD | src/interview/grader.ts | Added 5-dimension rubric scorecard grading | Added new file |
| TBD | src/interview/personas.ts | Added Professional Coach + Friendly Peer persona prompts | Added new file |
| TBD | src/resources/recommender.ts | Added curated resource lookup + filtering | Added new file |
| TBD | src/state.ts | Extended AgentState with resumeProfile, interviewSessions[], recommendedResources[] | Added 3 new state fields with types |
| TBD | src/server.ts | Registered 3 new route modules via app.use() | Added route imports and registration |
| TBD | src/report/pdf-generator.ts | Added Resume, Interview, Resources sections to PDF output | Extended existing generator |
| TBD | src/report/html-generator.ts | Added same sections to HTML output | Extended existing generator |
| TBD | package.json | Added pdf-parse, mammoth, multer dependencies | Added 3 new runtime deps |
| TBD | data/curated-resources.json | Added 20-30 curated learning resources by domain | Added new data file |
| TBD | data/interview-templates.json | Added question templates by interview mode | Added new data file |

---

## v2.1.0
**Date:** 2026-05-01
**Focus:** P0 latency, no-repeat prompt hardening, planning completion correctness, and confirmed-state locks

- Changed sample provider routing to Gemini-only for MVP (`LLM_PROVIDER_SEQUENCE=google`).
- Added provider invoke timeouts so optional Groq fallback cannot hang for OS-level TCP timeout duration.
- Added a hard known-facts prompt section before phase speaker instructions.
- Added analyzer-level `user_intent` classification so confirmation replies in planning are not treated as filler.
- Added role-scoped report completion tracking with `reportGeneratedForRole`.
- Added confirmed-state prompt injection and merge locks for orientation fields and completed skill assessments.
- Moved speaker locked-state facts to prompt primacy and tightened role-targeting pre-checks.
- Added final MVP fixes for planning stall loops, completion-card dismissal persistence, and technology-skill retrieval for TPM/PM-style roles.
- Added post-demo Change 8 fixes for positive-reaction filler handling, role-scoped evidence reset, and sequential post-assessment slot collection.

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 19:05 ET | `.env.example` | Set active sample provider sequence to `google`; moved `groq,google` to an optional commented fallback | Replaced active `LLM_PROVIDER_SEQUENCE=groq,google` |
| 19:05 ET | `src/config.ts` | Added provider-specific LLM call timeouts (`groq=12s`, `google=25s`) around model invocation | Replaced unbounded provider `model.invoke()` calls |
| 19:05 ET | `agent_config/prompts/speaker_template.md` | Added `ALREADY COLLECTED - HARD CONSTRAINT` before phase speaker skill instructions | Replaced relying only on later cross-phase known-facts context |
| 19:05 ET | `src/nodes/speaker-prompt-creator.ts` | Added deterministic `hard_known_facts` payload from structured state | Added hard no-repeat facts before phase instructions |
| 20:56 ET | `agent_config/prompts/analyzer_template.md` | Added required `user_intent` output classification using recent-turn context | Replaced message-text-only interpretation for short confirmations |
| 20:56 ET | `agent_config/skills/planning/analyzer.md` | Added binding planning analyzer guidance for `confirm`, `filler`, `question`, `new_info`, and `correction` intents | Replaced thin-reply guidance without explicit intent output |
| 20:56 ET | `src/state.ts` | Added optional `AnalyzerOutput.user_intent` and `reportGeneratedForRole` state channel | Replaced unscoped report completion signal for terminal planning checks |
| 20:56 ET | `src/nodes/filler-guard.ts` | Made filler guard prefer analyzer `user_intent` over regex when available | Replaced regex-only handling for short replies like `ok` or `yeah` |
| 20:56 ET | `src/nodes/state-updater.ts` | Used `user_intent=confirm` for plan/evaluation confirmations and role-scoped report completion checks | Replaced bare word-list confirmation and unscoped `reportGenerated` terminal guard |
| 20:56 ET | `src/server.ts` | Persisted `reportGeneratedForRole` when JSON/PDF/HTML export succeeds | Added role identity to report-completion state |
| 20:56 ET | `scripts/validate-config.ts` | Added runtime-only allowlist entries for `report_generated_for_role` and `user_intent` | Prevents config validation from flagging runtime-only fields |
| 22:24 ET | `src/nodes/analyzer-prompt-creator.ts` | Added `confirmed_fields` injection from structured state into analyzer prompts | Added analyzer visibility into fields that should not be re-extracted |
| 22:24 ET | `agent_config/prompts/analyzer_template.md` | Added `CONFIRMED STATE - DO NOT RE-EXTRACT` instructions before output schema | Replaced analyzer relying only on recent-turn context for locked fields |
| 22:24 ET | `src/nodes/state-updater.ts` | Locked orientation fields after orientation and locked completed skill ratings unless user intent is correction | Replaced unconditional late writes from analyzer extractions |
| 22:24 ET | `src/nodes/state-updater.ts` | Cleared `needsRoleConfirmation` immediately when a pivot writes a new non-blank role | Prevents one-turn stale confirmation flag after role switch |
| 22:24 ET | `agent_config/prompts/speaker_template.md` | Moved `hard_known_facts` to top-of-prompt locked-state block | Replaced lower-priority mid-template placement |
| 22:24 ET | `agent_config/skills/exploration_role_targeting/speaker.md` | Added binding confirmed-role pre-check against locked state before role-identification instructions | Prevents re-asking for an already confirmed target role |
| 22:24 ET | `src/report/pdf-generator.ts` | Added technical/soft skill count context to readiness chips and overall readiness text | Replaced bare strength percentages without N/M context |
| 23:27 ET | `agent_config/skills/planning/speaker.md` | Added forbidden stall phrases and mandatory immediate plan-block delivery when a next block is present | Prevents content-free planning promises from causing filler-loop stalls |
| 23:27 ET | `src/nodes/state-updater.ts` | Reset `transitionDecision` to `continue` during planning role pivots | Prevents stale `complete` state from re-firing completion responses after Continue |
| 23:27 ET | `public/js/app.js` | Added `_completionDismissedForRole` tracking around completion cards | Suppresses re-inserting a dismissed card for the same role while still allowing a new role's card |
| 23:27 ET | `src/utils/rag.ts` | Merged O*NET technology skill categories into live skill retrieval for roles such as TPM/PM | Replaced cognitive-skills-only retrieval that could yield zero technical assessment items |
| 23:27 ET | `change_by_claude_004May01.md` | Added RCA and verification notes for the final MVP Change 004 fixes | Documents the selected P0 fixes and deferred post-demo items |
| 12:50 ET | `src/nodes/filler-guard.ts` | Added positive-reaction filler patterns such as `nice`, `great`, `cool`, `thanks`, `perfect`, and `looks good` | Prevents non-fact reactions from durable writes or report-generation messages |
| 12:50 ET | `src/nodes/state-updater.ts` | Cleared active `evidenceKept` and `evidenceDiscarded` arrays during role pivots | Prevents prior-role evidence from appearing in the new role's active report evidence log |
| 12:50 ET | `agent_config/skills/exploration_role_targeting/speaker.md` | Split post-assessment Step 3 into sequential priorities-only and timeline-only turns | Replaces combined two-slot question that caused E7 repeated full-block asks |
| 12:50 ET | `change_by_claude_005May01.md` | Added deliberation notes, P0 rules, deferred rules, and verification plan for Change 8 | Documents AN-013, OR-011, and SP-009 implementation rationale |
| -- | `agent_config/skills/exploration_role_targeting/speaker.md` | Added FORBIDDEN BRIDGE PHRASES section banning standalone transition turns before Skill 1; added MANDATORY FIRST MESSAGE rule requiring role confirmation + Skill 1 in the same opening message | Replaces advisory "introduce naturally" Opening Message that allowed 2–3 content-free turns before skill assessment (SP-012) |
| -- | `agent_config/prompts/analyzer_template.md` | Added CRITICAL caveat to confirm classification: output "confirm" ONLY when the most recent assistant message ended with a yes/no question or explicit choice prompt; bridge and transition messages must produce "filler" instead | Replaces advisory confirm examples that listed "sure" without a prior-question requirement, enabling false confirms after bridge turns (AN-005) |
| -- | `src/nodes/filler-guard.ts` | Introduced `UNCONDITIONAL_FILLER_PATTERNS` (sure, got it, understood, alright, I see, makes sense, right, fair enough, sure thing) that fire regardless of `user_intent`; existing `FILLER_PATTERNS` retain the confirm override for context-sensitive tokens (ok, hmm, fine). `fillerGuard` logic: `isFiller = intentIsFiller \|\| isUnconditionalFiller \|\| isContextualFiller` | Fixes review finding from Change 9 initial commit: bridge-ack tokens were placed in the wrong (context-sensitive) list, leaving LLM "confirm" able to bypass the intended deterministic backstop (AN-004, AN-013, F-C) |
| -- | `change_by_claude_006May02.md` | Added deliberation table, P0 rule table (SP-012, AN-005, F-C), files-to-change, verification plan, and review-finding correction note for two-tier filler guard | Documents Change 9 rationale and unconditional-vs-contextual pattern list design decision |

---

## v2.2.0 — Demo Stabilization (Change 9 implementation, Phase 8–9)
**Date:** 2026-05-03
**Branch:** `claude/determined-dubinsky-dc48dd`
**Focus:** DEMO_REQUIREMENTS_MATRIX_May02 — contextual cue interpretation, structured trace audit, loop prevention, test coverage (TST-001, TST-002)

| When | Area / Part | What Changed | Requirement IDs | With What |
|------|------------|-------------|-----------------|-----------|
| 2026-05-03 | `logs/` | Created `logs/` subfolder with `Audit_log.md`, `ERROR_TRACKING_LOG.md`, `Conflict_log.md` — seeded with correct table headers, 3 conflict entries, and 3 error entries | AUD-001, CONFLICT-001, LOG-001 | New files |
| 2026-05-03 | `src/state.ts` | Added `TurnFunction` discriminated union type (10 values + null); extended `AnalyzerOutput` with 7 optional AN-001 fields: `turn_function`, `turn_confidence`, `referenced_prior_prompt`, `target_field`, `proposed_state_patch`, `requires_orchestrator_gate`, `reason` | AN-001, AN-002, CONF-003 | Additive — existing fields (`extracted_fields`, `required_complete`, `phase_suggestion`, `confidence`, `notes`) unchanged |
| 2026-05-03 | `src/nodes/state-updater.ts` | Added `logOrch(tag, payload)` helper emitting structured JSON to stderr for all 5 trace markers: `[ORCHESTRATOR_DECISION]`, `[PHASE_DECISION]`, `[STATE_WRITE]`, `[RETRIEVAL_GATE]`, `[REPORT_GATE]` | ARCH-001, ST-001A, CONF-002 | No runtime logic change — observability only |
| 2026-05-03 | `src/nodes/state-updater.ts` | Added `resolveUserConfirming(analyzerOutput, userMessage)` with 3-tier priority: `turn_function=confirm + referenced_prior_prompt=true` → `user_intent=confirm` → `isConfirmation()` backstop | AN-001, OR-001, CONF-001 | Replaced scattered inline `isConfirmation()` calls and `user_intent` checks in merge functions |
| 2026-05-03 | `src/nodes/state-updater.ts` | Added `isCorrection(analyzerOutput)` and `isRoleSwitchSignal(analyzerOutput)` helpers reading `turn_function` first, `user_intent` as fallback | AN-001, ST-001, OR-002 | Replaced `user_intent !== "correction"` literal string comparisons |
| 2026-05-03 | `src/nodes/state-updater.ts` | Wired `turn_function` into `determineTransition()` — every return branch now emits `[PHASE_DECISION]` with reason; `mergeOrientationFields`, `mergeRoleTargetingFields`, and `stateUpdater` main use the new gate helpers | OR-001, OR-002, ST-001, ST-001A, CONF-001 | Replaces direct `isConfirmation()` and `user_intent` checks at gate points |
| 2026-05-03 | `src/nodes/speaker-prompt-creator.ts` | Added `getLoopPreventionBlock(state)` that detects `turn_function=invalid/uncertain` or skill/orientation stall and injects bounded-option choices into speaker context | OR-003, SP-002, PH-001, PH-002 | New function — wired as first element of `additionalContext` in `speakerPromptCreator` |
| 2026-05-03 | `agent_config/prompts/analyzer_template.md` | Added TURN FUNCTION CLASSIFICATION section with instructions for all 10 `turn_function` values, `referenced_prior_prompt`, `target_field`, `proposed_state_patch`, `requires_orchestrator_gate`, `reason`; extended OUTPUT FORMAT JSON | AN-001, AN-002, CONF-003 | Additive — existing schema fields preserved |
| 2026-05-03 | `agent_config/skills/exploration_role_targeting/analyzer.md` | Added turn_function classification table with role-targeting-specific cue examples and key rule: bare "ok" after bridge = acknowledge, not confirm | AN-001, SK-002 | Additive section |
| 2026-05-03 | `agent_config/skills/planning/analyzer.md` | Added turn_function classification section with planning-phase examples; required `reason` field output for TST-002-CUE trace audit | AN-001, CONF-002 | Additive section |
| 2026-05-03 | `src/tests/golden-path.test.ts` | Extended with 40 new assertions: 8 TST-001 groups (CUE-01/02/03/04, ROLE-SWITCH/RESET, SK-DELTA, RAG-BLOCK/PERF-NOTOOL, PHASE-STAY/MOVE, RPT-READY/NOTREADY/ROLE2/UI, CONFIRM 3-tier, MEM-RETURN) + TST-002 trace audit group (10 assertions verifying all 5 log markers) | TST-001, TST-002, AUD-001 | Grew from 14 assertions (Change 5) to 54 total |
| 2026-05-03 | `logs/Audit_log.md` | Added Phase 9 requirement rows for all P0 groups; updated merge readiness checklist | AUD-001, LOG-001 | Updated |
| 2026-05-03 | `CHANGELOG_TECH.md`, `CHANGELOG_FEATURES.md` | Added v2.2.0 requirement-linked changelog rows per matrix §11.1 and §11.2 | LOG-001 | This entry |

---

## v2.2.1 — UAT Bug Fix (Change 10 — Planning Stall, ERR-005)
**Date:** 2026-05-03
**Branch:** `claude/determined-dubinsky-dc48dd`
**Focus:** Fix planning speaker stall — MANDATORY block delivery override appended at end of assembled prompt

| When | Area / Part | What Changed | Requirement IDs | With What |
|------|------------|-------------|-----------------|-----------|
| 2026-05-03 | `src/nodes/speaker-prompt-creator.ts` | After `populateTemplate`, append MANDATORY OVERRIDE block at the very end of the prompt when `currentPhase === "planning"` and a next unconfirmed plan block exists; this ensures the LLM sees the block content LAST (highest weight) and cannot default to generic "preparing" promises | SP-003, OR-003 | Fixes ERR-005: planning speaker generating forbidden phrases for 4+ turns despite MANDATORY instruction mid-prompt |
| 2026-05-03 | `agent_config/skills/planning/speaker.md` | Moved Block-by-Block Delivery section to the TOP of the file (before "Role" section) so it is the first instruction in PHASE SPEAKER SKILL; removed the duplicate mid-file copy | SP-003 | Previously at §9 (end of skill file); now §1 (top priority) |
| 2026-05-03 | `logs/ERROR_TRACKING_LOG.md` | Added ERR-005 row (planning stall, P1, Rectified) | AUD-001 | UAT-OBS-002 |

---

## v2.0.0
**Date:** 2026-04-02
**Architecture diagram:** [docs/architecture/architecture-2.0.0.mmd](docs/architecture/architecture-2.0.0.mmd)

- UI redesign: 9-section landing page with structured IA (backend unchanged)
- CSS design token system expanded to 30+ variables
- Responsive breakpoints refined to 3 tiers (1200+, 900px, 600px)

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 00:50 ET | public/index.html (CSS) | Added 30+ CSS variables to :root for colors, spacing, shadows | Replaced hardcoded values in some components |
| 00:50 ET | public/index.html (CSS) | Added ARIA accessibility layer (aria-live, role=dialog, role=group, role=progressbar) | Added new attributes throughout |
| 00:50 ET | public/index.html (JS) | Added renderMarkdown() function for bot message formatting | Added new function (~20 lines) |
| 00:50 ET | public/index.html (JS) | Added fetchDataSourceStatus() for live API dot colors | Added new function |
| 00:50 ET | public/index.html (JS) | Added updateStatsBar(), showCompletionCard(), setupScrollButton() | Added 3 new functions |
| 00:50 ET | public/index.html (JS) | Refactored showResumeDialog() with focus trap + ARIA | Replaced basic overlay implementation |
| 00:50 ET | public/index.html (JS) | Added navigator.onLine checks in startNewSession() and sendMessage() | Added 2 new guard conditions |
| 00:50 ET | public/index.html (JS) | Added 404 session recovery in sendMessage() | Added new error handler branch |
| 01:11 ET | public/index.html (CSS) | Added design tokens: --bg-section, --trust-bg, --space-section (56px), --space-inner (24px) | Extended :root variables |
| 01:11 ET | public/index.html (CSS) | Added .trust-bar, .trust-stat, .section-title, .landing-section, .landing-section--alt | Added 5 new component style blocks |
| 01:11 ET | public/index.html (CSS) | Added :focus-visible global outline (2px solid primary, 2px offset) | Replaced browser default focus styles |
| 01:11 ET | public/index.html (HTML) | Wrapped landing sections in `<section>` tags with aria-labelledby | Replaced flat div structure |
| 01:11 ET | public/index.html (HTML) | Added dual skip links targeting #heroSection and #msgInput | Replaced single skip link |
| 01:11 ET | public/index.html (CSS) | Refined 3-tier responsive breakpoints (1200+, 900px, 600px) | Extended 2-breakpoint system |
| 10:54 ET | public/index.html (CSS) | Added .hero-cta-group, .secondary-cta, .faq-grid, .faq-item, .disclaimer-box | Added 5 new component style blocks |
| 10:54 ET | public/index.html (CSS) | Added .footer-grid, .footer-col, .footer-brand, .footer-links, .footer-bottom | Replaced single .project-footer block |
| 10:54 ET | public/index.html (HTML) | Added FAQ section (4-item grid), AI disclaimer, bottom CTA, 2-column footer | Added 4 new HTML sections (~80 lines) |
| 10:54 ET | public/index.html (CSS) | Added mobile overrides: .faq-grid 1-col, .footer-grid 1-col, .hero-cta-group vertical | Extended @media blocks |
| 10:54 ET | REDESIGN_PLAN.md | Added competitive UX notes + complete copy deck | Extended documentation |

---

## v1.3.0
**Date:** 2026-03-28 — 2026-03-31
**Architecture diagram:** [docs/architecture/architecture-1.3.0.mmd](docs/architecture/architecture-1.3.0.mmd)

- File-based session persistence replacing in-memory-only storage
- LangSmith auto-tracing integration
- Data sync pipeline for bulk API downloads

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 03-28 01:43 | src/server.ts | Added loadSession() / saveSession() with JSON file I/O | Replaced Map-only persistence |
| 03-28 01:43 | public/index.html | Added AbortController with 55s timeout + retry loop in sendMessage() | Replaced no-timeout fetch |
| 03-28 04:06 | src/utils/rag.ts | Fixed optional score field access in skill retrieval | Replaced strict property access |
| 03-28 04:06 | src/graph.ts | Fixed routing conditional for phase transitions | Replaced incorrect comparison |
| 03-28 18:55 | src/services/onet.ts | Migrated from v1 API (Basic Auth) to v2 API (X-API-Key header) | Replaced base URL + auth method |
| 03-28 18:55 | src/services/bls.ts | Fixed OEWS series ID format from 27-char OEUM to 25-char OEUS | Replaced series ID construction |
| 03-28 19:40 | src/server.ts | Added LangSmith tracing config in graph.invoke() calls | Added runName, tags, metadata |
| 03-28 19:40 | .env | Added LANGCHAIN_TRACING_V2, LANGCHAIN_API_KEY, LANGCHAIN_PROJECT | Added 3 new env vars |
| 03-31 -- | src/server.ts | Added GET /api/session/:id/history endpoint | Added new route handler |
| 03-31 -- | public/index.html | Added localStorage session ID + checkReturningUser() + resumeSession() | Added 3 new JS functions |
| 03-31 -- | scripts/sync-data.ts | Added bulk data sync script with rate limiting (300-500ms delays) | Added new file |
| 03-31 -- | data/enriched-occupations.json | Generated enriched occupation cache (10 occupations) | Added new data file |

---

## v1.2.0
**Date:** 2026-03-27
**Architecture diagram:** [docs/architecture/architecture-1.2.0.mmd](docs/architecture/architecture-1.2.0.mmd)

- External API service connectors + containerized deployment

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 23:46 ET | src/services/onet.ts | Added O*NET v2 API connector (search, skills, knowledge, tasks, tech skills) | Added new service file |
| 23:46 ET | src/services/bls.ts | Added BLS Public Data API connector (wage data, employment trends) | Added new service file |
| 23:46 ET | src/services/usajobs.ts | Added USAJOBS API connector (search jobs, get count) | Added new service file |
| 23:46 ET | src/server.ts | Added GET /api/data-sources endpoint for API health checks | Added new route |
| 23:48 ET | Dockerfile | Added multi-stage Docker build (node:20-slim) | Added new file |
| 23:48 ET | render.yaml | Added Render.com deployment specification | Added new file |

---

## v1.1.0
**Date:** 2026-03-27
**Architecture diagram:** [docs/architecture/architecture-1.1.0.mmd](docs/architecture/architecture-1.1.0.mmd)

- Express HTTP server + single-page HTML/CSS/JS frontend

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 19:03 ET | src/server.ts | Added Express server with POST /api/session, /api/chat, /api/export | Added new file |
| 19:03 ET | public/index.html | Added single-page app: sidebar, phase stepper, chat area, input bar | Added new file (~800 lines) |
| 19:03 ET | package.json | Added express, cors dependencies | Added 2 runtime deps |

---

## v1.0.0
**Date:** 2026-03-27
**Architecture diagram:** [docs/architecture/architecture-1.0.0.mmd](docs/architecture/architecture-1.0.0.mmd)

- Initial build: LangGraph pipeline + CLI + RAG + export

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 18:55 ET | src/graph.ts | Created 5-node StateGraph (APC → Analyzer → SU → SPC → Speaker) | N/A (greenfield) |
| 18:55 ET | src/state.ts | Created AgentState with 20+ typed fields, 4-phase flow | N/A |
| 18:55 ET | src/nodes/*.ts | Created 5 node implementations | N/A |
| 18:55 ET | src/config.ts | Created config loader (phase_registry + state_schema + Gemini models) | N/A |
| 18:55 ET | src/utils/rag.ts | Created RAG pipeline (Ollama embeddings + cosine similarity) | N/A |
| 18:55 ET | src/report/pdf-generator.ts | Created PDFKit report generator (6 sections) | N/A |
| 18:55 ET | src/report/html-generator.ts | Created HTML report generator (6 sections) | N/A |
| 18:55 ET | agent_config/ | Created phase registry, state schema, prompt templates, skill files | N/A |
| 18:55 ET | package.json | Initial deps: @langchain/langgraph, @langchain/google-genai, pdfkit, faiss-node, zod | N/A |
