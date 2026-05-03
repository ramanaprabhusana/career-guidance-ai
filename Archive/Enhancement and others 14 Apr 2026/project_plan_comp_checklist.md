# Project plan compliance checklist

**Git sync (local `career-guidance-ai`):** **`origin/main`** @ **`74f4376`** (*fix: stop chatbot re-suggesting roles and trim repetitive report sections*). Sync confirmed **2026-04-13** (`git fetch` + `reset --hard`; no newer commit than **`74f4376`**).

### Governance (how to read this checklist)

1. **Project plan (Jan 28 PDF)** defines **product scope** for the **career guidance chatbot**: multi-phase experience, memory/research/evidence/export/evaluation expectations. The team **does not** treat **Python** or **Streamlit** as implementation requirements.

2. **Skills 1–10** and **[`implementation_spec.md`](Revised%20Feb17th_Chatbot%20Skills/implementation_spec.md)** define the **authoritative technical approach** for the agent (configuration-first design, Analyzer → Orchestrator → Speaker pattern, phase registry, prompts, validation, testing, domain customization, etc.). Where the plan names a stack (e.g. Python + Streamlit + Chroma), **skills + implementation_spec override** for how the product is built.

3. **Plan delta** — Milestones, deliverables, or technical needs in the **project plan document** that are **not** covered by skills **1–10** or **implementation_spec** are **explicitly planned and tracked** by developers against the plan PDF (rows may cite “Supporting skill —” when not skill-driven).

4. **Compliance** is assessed on **capabilities and artifacts**, not on matching legacy technology names from the plan.

**Purpose:** Living checklist mapping **approved Jan 28 plan scope** + **skills-backed implementation** in **`career-guidance-ai`**. Update as scope or code changes.

**Project plan PDF:** `Project plan_approved_Jan28,2026.pdf` — if not under this folder, current copy used for this table: `ETB_Week 2/Project plan_approved_Jan28,2026.pdf` (same content).

**Skills reference:** [`Revised Feb17th_Chatbot Skills/`](Revised%20Feb17th_Chatbot%20Skills/) (overview, **`implementation_spec.md`**, skills **1–10**).

**Stack note (actual implementation):** **TypeScript**, **LangGraph / LangChain**, **Express**, **session JSON files**, **FAISS** (`faiss-node` / embeddings data), **`public/index.html`** + **`public/js/app.js`**, optional **SQLite** profile store (`data/profiles.db`), **`parallel-turn.ts`** (P9 concurrent analyzer + speaker), **`tool-executor.ts`** (RAG, **web search**, **course finder**), **plain-text resume** (`resume-parser.ts`, `POST /api/upload`), **returning-user** flows (`isReturningUser`, `resumeChoice`, resume vs fresh-start in `server.ts`). *Plan-document references to Streamlit/Python/Chroma describe intent; the shipped stack follows skills + this note.*

**Code baseline:** `career-guidance-ai` **`origin/main`** @ **`74f4376`**.

**Last updated:** 2026-04-13

**Column guide:** **Implemented (baseline)** reflects the **pre–Phase 2** checklist snapshot (commit-era **~`2cc1086`** in prior doc). **Status (2026-04-13)** is the current judgment after **`74f4376`**. Values: **Yes** / **Partial** / **No** / **N/A** (stretch-only).

---

## Table 1 — Established plan compliance (Jan 28 MVP rows)

| High level Component | Sub-component | Usage | Implemented (baseline) | Implementation level | Supporting skill | Primary evidence | Status (2026-04-13) |
|----------------------|---------------|-------|--------------------------|----------------------|------------------|------------------|---------------------|
| Career Guidance Chatbot | Multi-phase conversation (orientation → exploration → role targeting → planning) | Delivers goal intake, exploration, gap-related skill assessment, and plan creation per plan MVP | Yes | MVP | 1, 2, 3, 4, 5, 6 | `src/graph.ts`, `agent_config/`, `src/nodes/state-updater.ts` | Yes |
| Career Guidance Chatbot | Role / goal capture (target role, experience, education, session goal) | Supports role selection and planning inputs aligned with plan | Partial | MVP | 1, 4 | `state_schema.json`, orientation + planning phase skills | Partial |
| Career Guidance Chatbot | Explicit location & timeline fields in schema | Plan calls out location/timeline; capture depends on phase skills and state | Partial | MVP | 1, 4 | `state.ts`, phase `analyzer.md` / schema | Partial |
| Chat Orchestrator | LangGraph five-node loop (prompt creators → Analyzer → State updater → Speaker) | Implements “orchestrator” responsibilities (plan: intents routing) via phases and deterministic merge | Yes | MVP | 2, 3, 6, (overview) | `src/graph.ts`, `analyzer-prompt-creator.ts`, `speaker-prompt-creator.ts` | Yes — **`74f4376`:** runtime is **`parallelTurn`** → **`stateUpdater`** → conditional **`summarizer`** (see Table 2); prompt creators still drive behavior |
| Chat Orchestrator | Phase redirect limit (max 2) | Prevents oscillation when user input fits another phase | Yes | MVP | 6 | `src/graph.ts`, `orchestrator_rules.md` | Yes |
| Memory Service | Session memory (current chat context) | Keeps turn history and structured state for the active session | Yes | MVP | 7 | `conversationHistory` in `state.ts`, `server.ts` merge on `/api/chat` | Yes |
| Memory Service | Session persistence across process restarts | Plan implies durable sessions; file-based store per session id | Yes | MVP | — | `sessions/*.json`, `server.ts` `saveSession` / `loadSession` | Yes |
| Memory Service | Episodic memory (summaries of past sessions) | Post-session summaries for return visits | Partial | MVP | 7 | `src/utils/summarizer.ts`, `src/db/profile-db.ts` episodic table; optional `userId` on `/api/session` | Partial — rolling summary in-graph (`summarizer-node.ts`, `summary_template.md`); episodic store still partial vs full URD |
| Memory Service | Long-term profile memory (SQLite: users, skill_profile, preferences, progress) | Plan: relational profile store; drives personalization across sessions | Partial | MVP | 4, 6 | `src/db/profile-db.ts`, `better-sqlite3`; keyed by `userId` from client | Partial — `profile-hooks.ts` |
| Memory Service | Vector store for **user** summaries / notes | Plan: Chroma/FAISS over episodic text | No | Not implemented | 7 | **RAG** (`faiss-node`, `data/`, `rag.ts`) indexes **occupation/career knowledge**, not end-user episodic text | No |
| Research Service | O*NET connector (occupation / skills) | Skills, tasks, taxonomy for gap and role context | Partial | MVP | — | `src/services/onet.ts`, local `data/occupations.json` + optional API | Partial — `retrieve_skills_for_role` via `tool-executor.ts` |
| Research Service | BLS OEWS / wage context | Wage outlook in enriched role data | Partial | MVP | — | `src/services/bls.ts`, `rag.ts` `getWageData` | Partial |
| Research Service | USAJOBS connector (posting metadata / signals) | Job signal counts / federal postings context | Partial | MVP | — | `src/services/usajobs.ts`, optional count in `rag.ts` | Partial |
| Research Service | Normalized common schema (occupation_id, skill_id, wage_stats, job_counts) | Single interchange format across connectors | Partial | MVP | — | Typed structures in `rag.ts` / services, not a standalone shared schema package | Partial — **improved:** `src/services/common-schema.ts` (`8db0222`) |
| Research Service | Search strategies module (BFS baseline, optional Beam) | Plan Week 5 / stretch retrieval strategy | No | Not implemented (stretch) | — | Cosine retrieval only in `retrieveChunks` | N/A (stretch) |
| Research Service | Keep vs discard logger (with reasons) | Transparency for evidence pack; plan acceptance criterion | Partial | MVP | — | `evidenceKept` / `evidenceDiscarded` in `state.ts`, planning analyzer, `src/report/evidence-pack.ts`, Evidence tab | Partial |
| Deep Research / Evidence Pack | Evidence pack as structured JSON artifact | Plan: standard JSON schema + fields (top roles, gaps, resources, wages, jobs, assumptions) | Yes | MVP | — | `src/report/evidence-pack.ts`, `POST /api/export` `format=json`, `exports/evidence-pack-*.json` | Yes |
| Deep Research / Evidence Pack | Learning resources list (links only) | Plan deliverable | Partial | MVP | — | `learningResources` in state; planning phase extraction; `data/curated-resources.json`; reports + JSON | Partial |
| Export / Report | PDF export | Downloadable career report | Yes | MVP | 3 | `src/report/pdf-generator.ts`, `POST /api/export` | Yes |
| Export / Report | HTML export | Accessible / alternate report | Yes | MVP | 3 | `src/report/html-generator.ts` | Yes |
| Export / Report | Track-aware report layout (explore vs pursue) + **technical vs soft** skill sections | Plan/user-story alignment for role track and skill-gap presentation | Yes | MVP | 3 | `pdf-generator.ts`, `html-generator.ts`, `rag.ts` (`categorizeSkillType`, `blendSkillsAcrossRoles`), `state.ts` `skill_type` | Yes |
| UI | Primary chat experience | User interacts with assistant | Yes | MVP | 3 | `public/index.html`, `public/js/app.js`, `/api/chat` | Yes |
| UI | Plan-style tabs (Chat, Evidence Pack, Profile, History, Export) | Streamlit-style IA from plan | Partial | MVP | — | Sidebar: Career Coach, Evidence, Profile, History, Skills Dashboard, Explore, Resources, Export | Partial |
| UI | Keep/discard log visible | Plan Week 5 deliverable | Partial | MVP | — | Evidence tab + exports | Partial |
| UI | Progress tracker (user marks completion) | Plan Week 6 | Partial | MVP | — | `progressItems` in state, `PATCH /api/session/:id/progress`, Progress panel | Partial |
| Data plan compliance | Public APIs and open datasets only (O*NET, BLS, USAJOBS) | No scraping; structured fields | Yes | MVP | — | Connectors + local curated JSON for dev | Yes |
| Data plan compliance | No storage of full scraped articles | Store structured fields and notes only | Yes | MVP | — | Session JSON + exports; no article blob store | Yes |
| Quality / Evaluation | Smoke or end-to-end test of pipeline | Plan expects automated checks | Partial | MVP | 9 | `src/tests/smoke-test.ts` | Partial |
| Quality / Evaluation | Pre-deployment config validation (registry / schema consistency) | Skill 9 style checks | Partial | MVP | 9 | `scripts/validate-config.ts`, `npm run validate-config`, `npm run check`, `.github/workflows/ci.yml` | Partial — validates **`summary_template.md`** and expanded checks (`8db0222`) |
| Quality / Evaluation | Synthetic profile test set (20–30) + metrics report | Plan Weeks 7 + acceptance | Partial | MVP | 9 | `fixtures/eval-profiles.json`, `scripts/eval-fixtures.ts` | Partial |
| Quality / Evaluation | LLM observability (LangSmith traces) | Debugging, latency/cost visibility | Partial | MVP | — | `server.ts` `graph.invoke` metadata; env `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY` | Partial |
| Delivery / Ops | Container / cloud deploy config | Plan Week 1 skeleton / hosting | Partial | MVP | — | `Dockerfile`, `render.yaml`, `DEPLOY.md` | Partial — **improved:** Dockerfile / `DEPLOY.md` updates (`8db0222`) |
| Delivery / Ops | CI pipeline (e.g. GitHub Actions) | Plan Week 1 mentions CI | Yes | MVP | — | `.github/workflows/ci.yml` | Yes |
| Meta | Domain configuration process (generated agent_config) | Aligns chatbot with requirements via skills-driven artifacts | Yes | MVP | 10 | `agent_config/` tree | Yes |

---

## Table 2 — New coverage (Phase 2 `f82a1bf` + post-`74f4376`)

| High level Component | Sub-component | Usage | Supporting skill | Primary evidence | Status (2026-04-13) |
|----------------------|---------------|-------|------------------|------------------|---------------------|
| Chat Orchestrator | **Summarizer** LangGraph node (post-`stateUpdater`) | Rolling **Skill 7** summary; conditional edge `shouldSummarize` | 7 | `src/graph.ts`, `src/nodes/summarizer-node.ts`, `src/utils/summarizer.ts` | Yes |
| Chat Orchestrator | **Parallel turn (P9)** — concurrent analyzer + speaker | Cuts 1-turn lag; `parallelTurn` replaces sequential APC→An→SPC→Sp chain | 2, 3 | `src/nodes/parallel-turn.ts`, `src/graph.ts` | Yes |
| Chat Orchestrator | **Tool execution** layer after orchestrator decision | Approved side effects: RAG role skills, optional web search, course discovery | 6, 8 | `src/nodes/tool-executor.ts`, `runTool` from `state-updater.ts` | Partial |
| Input / documents | **Resume** upload (plain text) + structured extract | Name, years, dominant domain seeding context | — | `src/services/resume-parser.ts`, `POST /api/upload`, `server.ts` | Partial |
| UX / Memory | **Returning user** — welcome back + **resume vs fresh-start** | First-turn intercept; `detectResumeIntent`, `applyFreshStart`, `resumeChoice` | 6, 7 | `src/server.ts`, `state.ts`, `speaker-prompt-creator.ts` | Partial |
| Research Service | **Supplemental web search** & **course** surfacing | Contextual search / course hints behind tool dispatch | — | `src/services/web-search.ts`, `src/services/courses.ts`, `tool-executor.ts` | Partial |
| Safety / policy | **Content & topic** guardrails | Off-topic handling, escalation counters, protected traits | 6, 8 | `orchestrator_rules.md`, `safety-guard.ts`, `topic-guard.ts`, `state-updater.ts` | Partial |
| Quality / Evaluation | **Error catalog** & structured **error** handling | Skill 8-style codes in config + TS utilities + tool results | 8, 9 | `agent_config/error_catalog.md`, `src/utils/errors.ts`, `tool-executor.ts` | Partial |
| Agent pattern | **ReAct**-style loop (repeat Thought → Action → Observation in one turn) | Discussed in skills **overview** as an extension; not required for shipped MVP | — | `src/nodes/react-executor.ts` (Change 5, 2026-04-15) — flag-gated on `ENABLE_REACT_LOOP` + `reactIntent="deep_research_role"`. Hard caps: 3 steps / 15 s / 5-tool allowlist. Default path unchanged. | **Partial (feature-flagged)** |
| Quality / Evaluation | **Golden-path regression test** — Apr 12 field transcript replay (Recent Graduate → Corporate Finance Analyst → plan → PDF) with assertions on targetRole stability, planBlocks seeding, readiness math, display-role label | Prevents regression of the four Change 5 P0 fixes | 6, 9 | `src/tests/golden-path.test.ts` — 14 deterministic assertions; wired as `npm run golden` | **Yes (Change 5)** |
| Quality / Evaluation | **Report download** — real PDF download button with regenerate-on-demand endpoint | Fixes user-reported "report ready but cannot download" bug (Apr 16); disk-wipe safe; pop-up-blocker safe | — | `src/server.ts` `GET /api/report/:sessionId.pdf`; `public/js/app.js` `exportReport()` | **Yes (Change 6)** |

---

## Skills 1–10 gap (strict snapshot, `74f4376`)

Use this table with **[`architecture_target_vs_current.md` §7](architecture_target_vs_current.md)** for professor or audit questions.

| Skill | One-line status |
|-------|-----------------|
| **1–3** | **Strong** — phase skills + analyzer/speaker templates wired in code. |
| **4** | **Partial** — `state.ts` is runtime SSOT; `state_schema.json` is companion/validation. |
| **5** | **Strong** — `phase_registry.json`. |
| **6** | **Partial** — rules in markdown + logic in `state-updater.ts`; not all documented BRs fully automated. |
| **7** | **Strong** — history + conditional summarizer. |
| **8** | **Partial** — catalog/errors; full recovery / handoff incomplete. |
| **9** | **Partial** — validate-config, smoke, CI; not exhaustive. |
| **10** | **Partial** — rich `agent_config/`; formal meta-process informal. |
| **ReAct (teaching extension)** | **Shipped behind flag (Change 5)** — `src/nodes/react-executor.ts`. Activates only on `ENABLE_REACT_LOOP=true` + `reactIntent`. 5 loop-protection layers (step cap, wall-clock cap, tool allowlist, per-step clear, graph-router re-check). Default path still orchestrator-approved single pass. |
| **RAG** | **Shipped for career KB** — not used as **user** vector memory. |

---

## How to update this checklist

- **Add a row** when the project plan or scope adds a new module, acceptance criterion, or named deliverable.
- **Change** **Status (YYYY-MM-DD)** when behavior ships or is removed; use **Partial** when only a subset of the sub-component exists.
- **Adjust Implementation level** (`MVP`, `stub`, `prod`, `config only`, `rules doc only`) when quality or depth changes—not on every bugfix.
- **Supporting skill:** cite Feb17th skill numbers only when that skill’s artifact or rule directly defines the sub-component; otherwise `—`.
- **Primary evidence:** prefer one directory or entrypoint; update if code moves.
- **Revisit** after major merges, demo milestones, or plan amendments.

**Next review triggers:** plan PDF revision; deeper episodic/vector user memory; evidence-pack schema revisions; evaluation harness metrics; UI depth vs plan narrative (not Streamlit parity as a requirement).

---

## Out of scope for this checklist (deliberately omitted)

- **Mandating** Python, Streamlit, or Chroma — **skills 1–10 + implementation_spec** define implementation approach (see Governance).
- **Stretch-only plan items** unless promoted to MVP: DFS/BFS/Beam benchmarking, advisor mode, cohort dashboard (listed as stretch in plan).
- **Optional data source** OpenAlex — not required for core checklist rows.
- **Course/lab topics** not in the Jan 28 plan: MCP, n8n, multi-agent split, fine-tuning pipelines, generic RAG coursework extras.
- **Per-user-story URD** items — tracked separately in [`audit_chatbot.md`](audit_chatbot.md) if needed.

---

*This file is for local tracking; not a substitute for the signed project plan PDF.*
