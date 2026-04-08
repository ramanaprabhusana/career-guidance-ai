/**
 * Web search connector (Slice S-D, Sr 25/26).
 *
 * Provides "live trend" context for the orchestrator. We deliberately keep
 * this offline-safe: if no `WEB_SEARCH_API_KEY` is configured we return an
 * empty result with `source: "disabled"` so the caller can fall back to the
 * curated/local data path without raising an error.
 *
 * Real deployments should swap `fetchLive` for a Bing/Brave/Tavily client.
 */

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  ok: boolean;
  source: "live" | "disabled" | "error";
  hits: WebSearchHit[];
  detail?: string;
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const q = (query ?? "").trim();
  if (!q) return { ok: false, source: "disabled", hits: [], detail: "empty query" };
  if (!process.env.WEB_SEARCH_API_KEY) {
    return { ok: false, source: "disabled", hits: [], detail: "WEB_SEARCH_API_KEY not set" };
  }
  try {
    return await fetchLive(q);
  } catch (e) {
    return { ok: false, source: "error", hits: [], detail: (e as Error).message };
  }
}

async function fetchLive(_query: string): Promise<WebSearchResult> {
  // Placeholder for real provider call. The orchestrator treats `disabled`
  // and an empty `hits` list identically, so leaving this as a stub keeps
  // the rest of the pipeline honest until a key is wired up.
  return { ok: true, source: "live", hits: [] };
}
