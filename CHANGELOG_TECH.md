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
**Focus:** P0 latency and no-repeat prompt hardening

- Changed sample provider routing to Gemini-only for MVP (`LLM_PROVIDER_SEQUENCE=google`).
- Added provider invoke timeouts so optional Groq fallback cannot hang for OS-level TCP timeout duration.
- Added a hard known-facts prompt section before phase speaker instructions.

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 19:05 ET | `.env.example` | Set active sample provider sequence to `google`; moved `groq,google` to an optional commented fallback | Replaced active `LLM_PROVIDER_SEQUENCE=groq,google` |
| 19:05 ET | `src/config.ts` | Added provider-specific LLM call timeouts (`groq=12s`, `google=25s`) around model invocation | Replaced unbounded provider `model.invoke()` calls |
| 19:05 ET | `agent_config/prompts/speaker_template.md` | Added `ALREADY COLLECTED - HARD CONSTRAINT` before phase speaker skill instructions | Replaced relying only on later cross-phase known-facts context |
| 19:05 ET | `src/nodes/speaker-prompt-creator.ts` | Added deterministic `hard_known_facts` payload from structured state | Added hard no-repeat facts before phase instructions |

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
