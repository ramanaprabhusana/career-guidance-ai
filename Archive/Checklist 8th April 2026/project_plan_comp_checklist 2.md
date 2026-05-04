# Project plan compliance checklist

**Purpose:** Living checklist mapping the **approved Jan 28, 2026 project plan** to implementation in **`career-guidance-ai`**, with **Revised Feb17th chatbot skills** cited only where they underpin the architecture. Update this file as scope or code changes.

**Project plan PDF:** `Project plan_approved_Jan28,2026.pdf` — if not under this folder, current copy used for this table: `ETB_Week 2/Project plan_approved_Jan28,2026.pdf` (same content).

**Skills reference:** [`Revised Feb17th_Chatbot Skills/`](Revised%20Feb17th_Chatbot%20Skills/) (overview, `implementation_spec.md`, skills 1–10 as applicable).

**Stack note:** Plan names Streamlit + Python + SQLite + Chroma; the implemented app is **TypeScript**, **LangGraph / LangChain**, **Express**, **session JSON files**, **FAISS** (via `faiss-node` / embeddings data), **`public/index.html`** + **`public/js/app.js`**, optional **SQLite** profile store (`data/profiles.db`), **`tool-executor.ts`** (RAG retrieve, **web search**, **course finder**), and **plain-text resume** parse (`resume-parser.ts`, `POST /api/upload`). Compliance is judged on **capabilities**, not identical technology names.

**Code baseline:** `career-guidance-ai` **`origin/main`** @ **`f82a1bf`** (*Phase 2: close gaps G1-G7 and ship user-story slices S-A through S-H*).

**Last updated:** 2026-04-08 (Phase 3 closure — C1–C7 shipped; validate-config 21/21, eval 30/30)

**Suggested extra columns (in table):** `Supporting skill`, `Primary evidence` — keep entries short; use `—` when not skill-driven.

---

## Compliance table

| High level Component | Sub-component | Usage | Implemented | Implementation level | Supporting skill | Primary evidence |
|----------------------|---------------|-------|-------------|----------------------|------------------|------------------|
| Career Guidance Chatbot | Multi-phase conversation (orientation → exploration → role targeting → planning) | Delivers goal intake, exploration, gap-related skill assessment, and plan creation per plan MVP | Yes | MVP | 1, 2, 3, 4, 5, 6 | `src/graph.ts`, `agent_config/`, `src/nodes/state-updater.ts` |
| Career Guidance Chatbot | Role / goal capture (target role, experience, education, session goal) | Supports role selection and planning inputs aligned with plan | Yes | MVP | 1, 4 | `state_schema.json`, orientation + planning phase skills |
| Career Guidance Chatbot | Explicit location & timeline fields in schema | Plan calls out location/timeline; capture depends on phase skills and state | Yes | MVP | 1, 4 | C1: `state_schema.json` orientation fields `location` + `preferred_timeline`; extraction rules in `orientation/analyzer.md`; merged in `state-updater.ts` |
| Chat Orchestrator | LangGraph loop (prompt creators → Analyzer → State updater → Speaker → **Summarizer**) | Core dialogue + post-turn rolling summary (Skill 7) in graph | Yes | MVP | 2, 3, 6, 7, (overview) | `src/graph.ts` (`summarizer` → `END`), `analyzer-prompt-creator.ts`, `speaker-prompt-creator.ts`, `summarizer-node.ts` |
| Chat Orchestrator | Phase redirect limit (max 2) | Prevents oscillation when user input fits another phase | Yes | MVP | 6 | `src/graph.ts`, `orchestrator_rules.md` |
| Chat Orchestrator | Tool execution (approved side effects after orchestrator) | Retrieval / connectors invoked via explicit dispatch | Yes | MVP | 6, 8 | C4: `tool-executor.ts` now dispatches `retrieve_skills_for_role`, `web_search`, `find_courses`, `get_wage_data`, `get_job_counts`; `rag.ts` routes BLS/USAJOBS via `runTool` |
| Memory Service | Session memory (current chat context) | Keeps turn history and structured state for the active session | Yes | MVP | 7 | `conversationHistory` in `state.ts`, `server.ts` merge on `/api/chat` |
| Memory Service | Session persistence across process restarts | Plan implies durable sessions; file-based store per session id | Yes | MVP | — | `sessions/*.json`, `server.ts` `saveSession` / `loadSession` |
| Memory Service | Episodic memory (summaries of past sessions) | Post-session summaries for return visits | Yes | MVP | 7 | C3: `/api/session` prefetches up to 3 summaries via `listRecentEpisodic`; speaker-prompt-creator surfaces the most recent in the welcome-back opener; `summarizer-node.ts` in graph |
| Memory Service | Long-term profile memory (SQLite: users, skill_profile, preferences, progress) | Plan: relational profile store; drives personalization across sessions | Yes | MVP | 4, 6 | `src/db/profile-db.ts`, `src/utils/profile-hooks.ts`, `better-sqlite3`; prefetch on `/api/session`, hooks from `state-updater.ts` |
| Memory Service | Vector store for **user** summaries / notes | Plan: Chroma/FAISS over episodic text | No | Not implemented | 7 | FAISS/index used for **occupation RAG**, not user memory (`data/`, `rag.ts`) |
| Input / documents | Resume upload (plain text) and structured extract | Name, experience years, dominant domain for context | Yes | MVP | — | `src/services/resume-parser.ts`, `POST /api/upload`, `server.ts`; minimal three-field scope is intentional (Sr 24) |
| Research Service | O*NET connector (occupation / skills) | Skills, tasks, taxonomy for gap and role context | Yes | MVP | — | `src/services/onet.ts`, local `data/occupations.json` + optional API; `retrieve_skills_for_role` via `tool-executor.ts` |
| Research Service | BLS OEWS / wage context | Wage outlook in enriched role data | Yes | MVP | — | C4: `get_wage_data` tool in `tool-executor.ts`; `rag.ts` routes via `runTool` |
| Research Service | USAJOBS connector (posting metadata / signals) | Job signal counts / federal postings context | Yes | MVP | — | C4: `get_job_counts` tool in `tool-executor.ts`; `rag.ts` routes via `runTool` |
| Research Service | Supplemental web search & course discovery | Contextual search / course hints (plan-aligned “authentic sources”) | Yes | MVP | — | `src/services/web-search.ts`, `src/services/courses.ts`, `tool-executor.ts` (`web_search`, `find_courses`) |
| Research Service | Normalized common schema (occupation_id, skill_id, wage_stats, job_counts) | Single interchange format across connectors | Yes | MVP | — | C5: `src/services/common-schema.ts` — `OccupationRecord`, `SkillRecord`, `WageStats`, `JobCounts`, `ResearchEvidence`; re-exported from `onet.ts` / `bls.ts` / `usajobs.ts` |
| Research Service | Search strategies module (BFS baseline, optional Beam) | Plan Week 5 / stretch retrieval strategy | No | Not implemented (stretch) | — | Cosine retrieval only in `retrieveChunks` |
| Research Service | Keep vs discard logger (with reasons) | Transparency for evidence pack; plan acceptance criterion | Yes | MVP | — | G7: `evidence_discarded.required_per_entity_fields` enforces `reason`; `evidence-pack.ts` emits `reason`; Evidence tab |
| Deep Research / Evidence Pack | Evidence pack as structured JSON artifact | Plan: standard JSON schema + fields (top roles, gaps, resources, wages, jobs, assumptions) | Yes | MVP | — | `src/report/evidence-pack.ts`, `POST /api/export` `format=json`, `exports/evidence-pack-*.json` |
| Deep Research / Evidence Pack | Learning resources list (links only) | Plan deliverable | Partial | MVP | — | `learningResources` in state; planning phase extraction; `data/curated-resources.json`; reports + JSON |
| Export / Report | PDF export | Downloadable career report | Yes | MVP | 3 | `src/report/pdf-generator.ts`, `POST /api/export` |
| Export / Report | HTML export | Accessible / alternate report | Yes | MVP | 3 | `src/report/html-generator.ts` |
| Export / Report | Track-aware report layout (explore vs pursue) + **technical vs soft** skill sections | Plan/user-story alignment for role track and skill-gap presentation | Yes | MVP | 3 | `pdf-generator.ts`, `html-generator.ts`, `rag.ts` (`categorizeSkillType`, `blendSkillsAcrossRoles`), `state.ts` `skill_type` |
| UI | Primary chat experience | User interacts with assistant | Yes | MVP | 3 | `public/index.html`, `public/js/app.js`, `/api/chat` |
| UI | Plan-style tabs (Chat, Evidence Pack, Profile, History, Export) | Streamlit-style IA from plan | Partial | MVP | — | Sidebar: Career Coach, Evidence, Profile, History, Skills Dashboard, Explore, Resources, Export |
| UI | Keep/discard log visible | Plan Week 5 deliverable | Partial | MVP | — | Evidence tab + exports |
| UI | Progress tracker (user marks completion) | Plan Week 6 | Partial | MVP | — | `progressItems` in state, `PATCH /api/session/:id/progress`, Progress panel |
| Safety / policy | Content & topic guardrails (orchestrator + utilities) | Off-topic, escalation counters, protected traits handling | Partial | MVP | 6, 8 | `orchestrator_rules.md`, `src/utils/safety-guard.ts`, `src/utils/topic-guard.ts`, `state-updater.ts` |
| Data plan compliance | Public APIs and open datasets only (O*NET, BLS, USAJOBS) | No scraping; structured fields | Yes | MVP | — | Connectors + local curated JSON for dev |
| Data plan compliance | No storage of full scraped articles | Store structured fields and notes only | Yes | MVP | — | Session JSON + exports; no article blob store |
| Quality / Evaluation | Smoke or end-to-end test of pipeline | Plan expects automated checks | Partial | MVP | 9 | `src/tests/smoke-test.ts` |
| Quality / Evaluation | Pre-deployment config validation (registry / schema consistency) | Skill 9 style checks | Yes | MVP | 9 | C6: `scripts/validate-config.ts` **21/21** incl. phase↔folder parity, orphan folder scan, orchestrator-rules field reference scan, C7 recovery parity; CI |
| Quality / Evaluation | Error catalog & structured handling | Skill 8 style codes | Yes | MVP | 8 | C7: `error_catalog.md` Recovery column + `errors.ts` `RecoveryStrategy` / `recoveryFor()`; parity enforced by validate-config |
| Quality / Evaluation | Synthetic profile test set (20–30) + metrics report | Plan Weeks 7 + acceptance | Yes | MVP | 9 | `fixtures/eval-profiles.json` (30 profiles), `scripts/eval-fixtures.ts` → `exports/eval-report.json`, **30/30 passing** |
| Quality / Evaluation | LLM observability (LangSmith traces) | Debugging, latency/cost visibility | Partial | MVP | — | `server.ts` `graph.invoke` metadata; env `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY` |
| Delivery / Ops | Container / cloud deploy config | Plan Week 1 skeleton / hosting | Partial | MVP | — | `Dockerfile`, `render.yaml`, `DEPLOY.md` |
| Delivery / Ops | CI pipeline (e.g. GitHub Actions) | Plan Week 1 mentions CI | Yes | MVP | — | `.github/workflows/ci.yml` |
| Meta | Domain configuration process (generated agent_config) | Aligns chatbot with requirements via skills-driven artifacts | Yes | MVP | 10 | `agent_config/` tree |

---

## How to update this checklist

- **Add a row** when the project plan or scope adds a new module, acceptance criterion, or named deliverable.
- **Change Implemented** when behavior ships or is removed; use **Partial** when only a subset of the sub-component exists.
- **Adjust Implementation level** (`MVP`, `stub`, `prod`, `config only`, `rules doc only`) when quality or depth changes—not on every bugfix.
- **Supporting skill:** cite Feb17th skill numbers only when that skill’s artifact or rule directly defines the sub-component; otherwise `—`.
- **Primary evidence:** prefer one directory or entrypoint; update if code moves.
- **Revisit** after major merges, demo milestones, or plan amendments (e.g. post–Mar 31).

**Next review triggers:** plan PDF revision; deeper episodic/vector user memory; evidence-pack schema revisions; evaluation harness metrics; UI parity with full Streamlit IA.

---

## Out of scope for this checklist (deliberately omitted)

- **Stretch-only plan items** unless promoted to MVP: DFS/BFS/Beam benchmarking, advisor mode, cohort dashboard (listed as stretch in plan).
- **Optional data source** OpenAlex — not required for core checklist rows.
- **Course/lab topics** not in the Jan 28 plan: MCP, n8n, multi-agent split, fine-tuning pipelines, generic RAG coursework extras.
- **Per-user-story URD** items — tracked separately in [`audit_chatbot.md`](audit_chatbot.md) if needed.
- **Exact stack parity** with Streamlit / Python / Chroma naming — replaced by TS/LangGraph/FAISS/session files + SQLite profile store as noted above.

---

*This file is for local tracking; not a substitute for the signed project plan PDF.*
