# Deploy Career Guidance Assistant (Render)

This app is configured for **Docker** deployment. The public URL updates only after you **push code to Git** and **Render rebuilds**, and after **environment variables** match your local setup.

## 1. Repository layout on GitHub

- If the Git repository root **is** the `career-guidance-ai` folder, use the default root in Render.
- If the repo root is the parent **Execution final deployment** folder, set **Root Directory** in the Render service to `career-guidance-ai` (Dashboard: Settings → Build & Deploy → Root Directory).

## 2. Required environment variables (Render → Environment)

| Variable | Required | Notes |
|----------|----------|--------|
| `LLM_PROVIDER_SEQUENCE` | Recommended | MVP default: `google`. Use `groq,google` only after Groq key/rate limits are tested. |
| `LLM_PROVIDER` | No | Optional single-provider override (`groq` or `google`) when sequence is unset. |
| `GROQ_API_KEY` | Required if using Groq | Groq API key for OpenAI-compatible model routing. |
| `GROQ_BASE_URL` | Required if using Groq | Use `https://api.groq.com/openai/v1`. |
| `GROQ_MODEL` | Recommended if using Groq | Example: `llama-3.1-8b-instant`. |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Required if using Gemini | Gemini API key. Needed for Google fallback or Google-only mode. |
| `PORT` | Auto | Render injects `3000`; Dockerfile exposes 3000. |
| `ONET_USERNAME` | Recommended | O*NET v2 **API key** (stored in this variable name for history). |
| `ONET_PASSWORD` | No | Optional; live O*NET uses `ONET_USERNAME` only. |
| `BLS_API_KEY` | Recommended | Enables live wage data when set. |
| `USAJOBS_API_KEY` | No | Leave unset if USAJOBS is out of scope. USAJOBS remains disabled unless `ENABLE_USAJOBS=true`. |
| `USAJOBS_EMAIL` | No | Required only with USAJOBS key and `ENABLE_USAJOBS=true`. |
| `ENABLE_USAJOBS` | No | Default off for MVP. Set `true` only after USAJOBS connector is tested. |
| `ENABLE_WEB_SEARCH` | No | Default off for MVP. Set `true` only after web search citation/scope behavior is tested. |
| `LANGSMITH_TRACING` | No | Set `true` to send traces to LangSmith. |
| `LANGSMITH_ENDPOINT` | No | Use `https://api.smith.langchain.com`. |
| `LANGSMITH_API_KEY` | No | LangSmith API key. |
| `LANGSMITH_PROJECT` | No | Defaults to `career-guidance-ai` if unset. |
| `OLLAMA_BASE_URL` | No | On Render there is usually **no** Ollama; leave unset. RAG **skill lists** still work via O*NET live + `data/occupations.json`. |

Copy values from your local `career-guidance-ai/.env` (never commit `.env`).

## 3. Ship code changes

```bash
cd career-guidance-ai
git add -A
git commit -m "Describe your change"
git push origin main
```

Render will redeploy if auto-deploy is on. Otherwise use **Manual Deploy → Deploy latest commit**.

## 4. Verify production

1. Open `https://<your-service>.onrender.com/api/health` → should return JSON with `"ok": true` and `version`.
2. Open `/api/data-sources` → `onet.connected` should be **true** if `ONET_USERNAME` is set.
3. Load the site, start a session, send a chat message, export a report.

May 01 service refreshes:
- 19:07 ET: `/api/health` returned `200`; cold-start wake-up observed at about `22.5s`.
- 19:07 ET: `/api/data-sources` returned `200` after warm-up in about `99ms`; O*NET, BLS, and local cache connected; USAJOBS disabled for MVP.
- 20:57 ET: `/api/health` returned `200`; cold-start wake-up observed at about `21.5s`.
- 20:57 ET: `/api/data-sources` returned `200` after warm-up in about `98ms`; O*NET, BLS, and local cache connected; USAJOBS disabled for MVP.
- 22:25 ET: `/api/health` returned `200`; cold-start wake-up observed at about `21.3s`.
- 22:25 ET: `/api/data-sources` returned `200` after warm-up in about `77ms`; O*NET, BLS, and local cache connected; USAJOBS disabled for MVP.
- 23:28 ET: `/api/health` returned `200`; cold-start wake-up observed at about `21.5s`.
- 23:28 ET: `/api/data-sources` returned `200` after warm-up in about `116ms`; O*NET, BLS, and local cache connected; USAJOBS disabled for MVP.

## 5. Files included in the Docker image

- `data/*.json` (occupations, chunks, embeddings, curated-resources) is **copied** into the image unless excluded. Do not add broad `data/*` rules to `.gitignore` for files the app needs in production.

## 6. Blueprint (`render.yaml`)

Optional: connect the repo to Render Blueprint and use `render.yaml`. Sync **secret** vars in the dashboard (`sync: false` placeholders).

## 7. Keep warm on free tier (P8)

Render's **free** plan spins the service down after ~15 minutes of inactivity. The next visitor pays the full cold start (even with the P1 multi-stage image, that's still ~5–8 s). For demo / review sessions, add one external ping:

- **cron-job.org** (free): create a job that GETs `https://career-guidance-ai.onrender.com/api/health` every **14 minutes**.
- **UptimeRobot** (free, alt): HTTP monitor against the same URL at 5 min interval.

Verify in Render logs that the pings arrive and return `{"ok": true}`. Remove the ping if you upgrade to a paid plan (which keeps the service hot by default).

## 8. Performance notes

Latest cold-start + per-turn pass (commit `perf:`):
- Multi-stage Docker build — `node dist/server.js` replaces `npx tsx src/server.ts` at runtime (~7 s off cold start).
- Prompt template + skill file in-memory cache (~40 ms off every turn).
- Async session writes — `/api/chat` responds before the JSON lands on disk (~50–200 ms).
- Summarizer routed via conditional edge — only runs when history + turn cadence trigger it.
- RAG embeddings warmed via `setImmediate` after `app.listen`.
- BLS wage + USAJOBS count calls parallelized (~1–2 s off role-targeting turns).
- Small LRU (50 entries) on query embeddings.

After each architecture or deploy change, record date, time, and version in your technical changelog if you maintain one.
