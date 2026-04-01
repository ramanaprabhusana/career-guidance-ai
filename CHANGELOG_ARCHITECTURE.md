# Architecture Change Log

All architectural decisions, technology changes, and structural modifications to the Career Guidance AI Assistant.

| Date | Time (ET) | What Changed | Where (File/Component) | What It Replaced | Why |
|------|-----------|-------------|----------------------|-----------------|-----|
| 2026-03-27 | 18:55 | Chose LangGraph TypeScript + Gemini as runtime stack | Project-wide | Python + Streamlit (from approved project plan) | TypeScript provides type safety; LangGraph enables stateful multi-node agent pipeline |
| 2026-03-27 | 18:55 | 5-node StateGraph pipeline: AnalyzerPromptCreator -> Analyzer -> StateUpdater -> SpeakerPromptCreator -> Speaker | `src/graph.ts` | N/A (greenfield) | Separation of concerns: analysis, state mutation, and response generation are independent nodes per chatbot_lab framework |
| 2026-03-27 | 18:55 | Gemini 2.0 Flash Preview (`gemini-2.0-flash-preview`) via `@langchain/google-genai` as LLM | `src/config.ts` | N/A | Free tier availability; sufficient quality for career guidance domain |
| 2026-03-27 | 18:55 | Ollama nomic-embed-text for local embeddings + FAISS for vector store | `src/utils/rag.ts`, `scripts/build-index.ts` | N/A | Local embedding generation (no API cost); FAISS for fast similarity search |
| 2026-03-27 | 18:55 | 4-phase conversation architecture: Orientation -> Exploration (dual-track: Career/Role Targeting) -> Planning | `agent_config/phase_registry.json`, `src/state.ts` | N/A | URD requirement for structured career guidance flow with dual-track routing |
| 2026-03-27 | 18:55 | Zod schema validation for agent state with 20+ typed fields | `src/state.ts` | N/A | Runtime type safety for complex conversation state |
| 2026-03-27 | 18:55 | File-based prompt template system with `{{placeholder}}` substitution | `src/utils/prompt-loader.ts`, `agent_config/` | N/A | Maintainable prompt engineering; domain config separated from code |
| 2026-03-27 | 19:03 | Express.js HTTP server with REST API endpoints | `src/server.ts` | CLI-only (`src/index.ts`) | Web deployment requirement; REST API for frontend communication |
| 2026-03-27 | 19:03 | Single-page HTML/CSS/JS frontend (no framework) | `public/index.html` | Terminal CLI | Accessible browser-based interface; zero build step for frontend |
| 2026-03-27 | 23:46 | Three external API service connectors as separate modules | `src/services/onet.ts`, `src/services/bls.ts`, `src/services/usajobs.ts` | Hardcoded occupation data only | Live labor market data integration per URD data source requirements |
| 2026-03-27 | 23:48 | Docker containerization with multi-stage build | `Dockerfile` | Local Node.js execution only | Render.com deployment requires containerized application |
| 2026-03-27 | 23:48 | Render.yaml deployment specification | `render.yaml` | N/A | Declarative deployment config for Render.com cloud platform |
| 2026-03-28 | 01:43 | File-based session persistence (JSON in `sessions/` directory) | `src/server.ts` | In-memory Map only | Sessions survive server restarts and Render redeploys |
| 2026-03-28 | 01:43 | Client-side retry logic with 55s timeout and AbortController | `public/index.html` | No timeout handling | Render free tier has cold start delays; retry prevents false failures |
| 2026-03-28 | 18:55 | O*NET API migration: v1 (Basic Auth, services.onetcenter.org/ws) -> v2 (X-API-Key, api-v2.onetcenter.org) | `src/services/onet.ts` | v1 API with Basic Auth at legacy endpoint | v1 returning 401 Unauthorized; v2 is current supported API with different auth model |
| 2026-03-28 | 18:55 | BLS series ID format: OEUM (27-char) -> OEUS (25-char) with state FIPS code | `src/services/bls.ts` | Incorrect 27-char OEUM format | Reverse-engineered correct 25-char OEUS format from BLS API documentation |
| 2026-03-28 | 19:40 | LangSmith auto-tracing via `@langchain/core` environment variables + metadata in graph.invoke() config | `src/server.ts`, `.env` | No observability | Production monitoring; `LANGCHAIN_TRACING_V2=true` enables automatic trace capture |
| 2026-03-31 | -- | localStorage-based session resumption (no authentication required) | `public/index.html`, `src/server.ts` | No session persistence across browser reloads | Session continuity without login system; `careerbot_session_id` stored in browser |
| 2026-03-31 | -- | `/api/session/:id/history` endpoint for session state retrieval | `src/server.ts` | No history retrieval API | Enables frontend to restore conversation on returning visit |
| 2026-03-31 | -- | Data sync script for bulk API data download into enriched local cache | `scripts/sync-data.ts` | Manual data in `data/occupations.json` | Automated enrichment from O*NET + BLS + USAJOBS APIs with rate limiting |
