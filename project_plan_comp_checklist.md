# Project plan compliance checklist

**Purpose:** Living checklist mapping the **approved Jan 28, 2026 project plan** to implementation in **`career-guidance-ai`**, with **Revised Feb17th chatbot skills** cited only where they underpin the architecture.

**Stack note:** Plan names Streamlit + Python + SQLite + Chroma; the implemented app is **TypeScript**, **LangGraph / LangChain**, **Express**, **session JSON files**, **FAISS** (via `faiss-node` / embeddings data), and **`public/index.html`** UI. Compliance is judged on **capabilities**, not identical technology names.

**Last updated:** 2026-04-15 (Change 5 — Apr 12 transcript P0 fixes + scoped RAG/ReAct upgrade on branch `claude/flamboyant-diffie`)

### Change 5 delta (2026-04-15)

- **ReAct loop** row moves from "Not implemented" → **Partial (feature-flagged)** — `ENABLE_REACT_LOOP=true` + named intent `deep_research_role` enables ≤ 3-step scoped loop in `src/nodes/react-executor.ts`. Default chat path stays single-pass.
- **RAG quality** row — lexical re-rank + structured retrieval logging added behind `ENABLE_RAG_RERANK=true` in `src/utils/rag.ts`; chunk schema tolerates both legacy strings and `{content, metadata}` shapes.
- **Quality / Evaluation — Golden-path regression** (new row class) — `npm run golden` added (`src/tests/golden-path.test.ts`); 14 deterministic assertions cover the four Apr 12 P0 regressions (targetRole drift, blank-role RAG, planning loop, PDF readiness math).
- **Observability** — every `runTool` call now emits a structured `tool_call` JSON log with latency + error code.

---

## Compliance table

| High level Component | Sub-component | Usage | Implemented | Implementation level | Supporting skill | Primary evidence |
|----------------------|---------------|-------|-------------|----------------------|------------------|------------------|
| Career Guidance Chatbot | Multi-phase conversation (orientation → exploration → role targeting → planning) | Delivers goal intake, exploration, gap-related skill assessment, and plan creation per plan MVP | Yes | MVP | 1, 2, 3, 4, 5, 6 | `src/graph.ts`, `agent_config/`, `src/nodes/state-updater.ts` |
| Career Guidance Chatbot | Role / goal capture (target role, experience, education, session goal) | Supports role selection and planning inputs aligned with plan | Partial | MVP | 1, 4 | `state_schema.json`, orientation + planning phase skills |
| Career Guidance Chatbot | Explicit location & timeline fields in schema | Plan calls out location/timeline; capture depends on phase skills and state | Partial | MVP | 1, 4 | `state.ts`, phase `analyzer.md` / schema |
| Chat Orchestrator | LangGraph five-node loop (prompt creators → Analyzer → State updater → Speaker) | Implements orchestrator responsibilities via phases and deterministic merge | Yes | MVP | 2, 3, 6, (overview) | `src/graph.ts`, `analyzer-prompt-creator.ts`, `speaker-prompt-creator.ts` |
| Chat Orchestrator | Phase redirect limit (max 2) | Prevents oscillation when user input fits another phase | Yes | MVP | 6 | `src/graph.ts`, `orchestrator_rules.md` |
| Memory Service | Session memory (current chat context) | Keeps turn history and structured state for the active session | Yes | MVP | 7 | `conversationHistory` in `state.ts`, `server.ts` merge on `/api/chat` |
| Memory Service | Session persistence across process restarts | Plan implies durable sessions; file-based store per session id | Yes | MVP | — | `sessions/*.json`, `server.ts` `saveSession` / `loadSession` |
| Memory Service | Episodic memory (summaries of past sessions) | Post-session summaries for return visits | Partial | MVP | 7 | `src/utils/summarizer.ts`, `src/db/profile-db.ts` `episodic` table; optional `userId` on `/api/session` |
| Memory Service | Long-term profile memory (SQLite: users, skill_profile, preferences, progress) | Plan: relational profile store | Partial | MVP | 4, 6 | `src/db/profile-db.ts`, `better-sqlite3`; keyed by `userId` from client |
| Memory Service | Vector store for **user** summaries / notes | Plan: Chroma/FAISS over episodic text | No | Not implemented | 7 | FAISS/index used for **occupation RAG**, not user memory |
| Research Service | O*NET connector (occupation / skills) | Skills, tasks, taxonomy for gap and role context | Partial | MVP | — | `src/services/onet.ts`, local `data/occupations.json` + optional API |
| Research Service | BLS OEWS / wage context | Wage outlook in enriched role data | Partial | MVP | — | `src/services/bls.ts`, `rag.ts` `getWageData` |
| Research Service | USAJOBS connector (posting metadata / signals) | Job signal counts / federal postings context | Partial | MVP | — | `src/services/usajobs.ts`, optional count in `rag.ts` |
| Research Service | Normalized common schema (occupation_id, skill_id, wage_stats, job_counts) | Single interchange format across connectors | Partial | MVP | — | Typed structures in `rag.ts` / services |
| Research Service | Search strategies module (BFS baseline, optional Beam) | Plan Week 5 / stretch retrieval strategy | No | Not implemented (stretch) | — | Cosine retrieval only in `retrieveChunks` |
| Research Service | Keep vs discard logger (with reasons) | Transparency for evidence pack | Partial | MVP | — | `evidenceKept` / `evidenceDiscarded` in `state.ts`, planning analyzer, `src/report/evidence-pack.ts`, Evidence tab |
| Deep Research / Evidence Pack | Evidence pack as structured JSON artifact | Plan: standard JSON schema + fields | Yes | MVP | — | `src/report/evidence-pack.ts`, `POST /api/export` `format=json`, `exports/evidence-pack-*.json` |
| Deep Research / Evidence Pack | Learning resources list (links only) | Plan deliverable | Partial | MVP | — | `learningResources` in state; planning phase extraction; reports + JSON |
| Export / Report | PDF export | Downloadable career report | Yes | MVP | 3 | `src/report/pdf-generator.ts`, `POST /api/export` |
| Export / Report | HTML export | Accessible / alternate report | Yes | MVP | 3 | `src/report/html-generator.ts` |
| UI | Primary chat experience | User interacts with assistant | Yes | MVP | 3 | `public/index.html`, `/api/chat` |
| UI | Plan-style tabs (Chat, Evidence Pack, Profile, History, Export) | Streamlit-style IA from plan | Partial | MVP | — | Sidebar: Career Coach, Evidence, Profile, History, Skills Dashboard, Explore, Resources, Export |
| UI | Keep/discard log visible | Plan Week 5 deliverable | Partial | MVP | — | Evidence tab + exports |
| UI | Progress tracker (user marks completion) | Plan Week 6 | Partial | MVP | — | `progressItems` in state, `PATCH /api/session/:id/progress`, Progress panel |
| Data plan compliance | Public APIs and open datasets only | No scraping; structured fields | Yes | MVP | — | Connectors + local curated JSON for dev |
| Data plan compliance | No storage of full scraped articles | Store structured fields and notes only | Yes | MVP | — | Session JSON + exports |
| Quality / Evaluation | Smoke or end-to-end test of pipeline | Plan expects automated checks | Partial | MVP | 9 | `src/tests/smoke-test.ts` |
| Quality / Evaluation | Pre-deployment config validation (registry / schema consistency) | Skill 9 style checks | Partial | MVP | 9 | `scripts/validate-config.ts`, `npm run validate-config`, `.github/workflows/ci.yml` |
| Quality / Evaluation | Synthetic profile test set (20–30) + metrics report | Plan Weeks 7 + acceptance | Partial | MVP | 9 | `fixtures/eval-profiles.json`, `scripts/eval-fixtures.ts` |
| Quality / Evaluation | LLM observability (LangSmith traces) | Debugging, latency/cost visibility | Partial | MVP | — | `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY` |
| Delivery / Ops | Container / cloud deploy config | Plan Week 1 skeleton / hosting | Partial | MVP | — | `Dockerfile`, `render.yaml` |
| Delivery / Ops | CI pipeline (e.g. GitHub Actions) | Plan Week 1 mentions CI | Yes | MVP | — | `.github/workflows/ci.yml` |
| Meta | Domain configuration process (generated agent_config) | Aligns chatbot with requirements | Yes | MVP | 10 | `agent_config/` tree |

---

## How to update this checklist

- **Add a row** when the project plan or scope adds a new module or acceptance criterion.
- **Change Implemented** when behavior ships; use **Partial** when only a subset exists.
- **Primary evidence:** prefer one directory or entrypoint; update if code moves.

## Out of scope (unless promoted)

- Stretch-only: DFS/BFS/Beam benchmarking, OpenAlex.
- Exact stack parity with Streamlit / Python / Chroma naming.
