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
