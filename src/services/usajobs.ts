/**
 * USAJOBS API connector
 * Docs: https://developer.usajobs.gov/API-Reference
 */

// C5: normalized job-count type re-exported from `./common-schema.ts`.
export type { JobCounts } from "./common-schema.js";

const USAJOBS_BASE = "https://data.usajobs.gov/api";

interface UsajobsHeaders {
  Host: string;
  "User-Agent": string;
  "Authorization-Key": string;
}

function getHeaders(): UsajobsHeaders {
  const apiKey = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;
  if (!apiKey || !email) throw new Error("USAJOBS_API_KEY and USAJOBS_EMAIL required in .env");

  return {
    Host: "data.usajobs.gov",
    "User-Agent": email,
    "Authorization-Key": apiKey,
  };
}

export interface USAJob {
  id: string;
  title: string;
  organization: string;
  department: string;
  location: string;
  salary: { min: string; max: string };
  grade: string;
  url: string;
  openDate: string;
  closeDate: string;
  qualifications: string;
}

interface SearchResultItem {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionTitle: string;
    OrganizationName: string;
    DepartmentName: string;
    PositionLocationDisplay: string;
    PositionRemuneration: { MinimumRange: string; MaximumRange: string }[];
    JobGrade: { Code: string }[];
    PositionURI: string;
    PositionStartDate: string;
    PositionEndDate: string;
    QualificationSummary: string;
  };
}

interface SearchResponse {
  SearchResult: {
    SearchResultCount: number;
    SearchResultCountAll: number;
    SearchResultItems: SearchResultItem[];
  };
}

/** Search USAJOBS listings by keyword */
export async function searchJobs(keyword: string, resultCount: number = 10): Promise<USAJob[]> {
  try {
    const params = new URLSearchParams({
      Keyword: keyword,
      ResultsPerPage: String(resultCount),
    });

    const res = await fetch(`${USAJOBS_BASE}/Search?${params}`, {
      headers: getHeaders() as unknown as HeadersInit,
    });

    if (!res.ok) throw new Error(`USAJOBS API ${res.status}: ${res.statusText}`);

    const data = (await res.json()) as SearchResponse;

    return data.SearchResult.SearchResultItems.map((item) => {
      const desc = item.MatchedObjectDescriptor;
      const pay = desc.PositionRemuneration?.[0];
      const grade = desc.JobGrade?.[0];

      return {
        id: item.MatchedObjectId,
        title: desc.PositionTitle,
        organization: desc.OrganizationName,
        department: desc.DepartmentName,
        location: desc.PositionLocationDisplay,
        salary: {
          min: pay?.MinimumRange ?? "N/A",
          max: pay?.MaximumRange ?? "N/A",
        },
        grade: grade?.Code ?? "N/A",
        url: desc.PositionURI,
        openDate: desc.PositionStartDate,
        closeDate: desc.PositionEndDate,
        qualifications: desc.QualificationSummary,
      };
    });
  } catch (e) {
    console.warn(`USAJOBS search failed for "${keyword}":`, (e as Error).message);
    return [];
  }
}

/** Get count of open positions for a keyword */
export async function getJobCount(keyword: string): Promise<number> {
  try {
    const params = new URLSearchParams({
      Keyword: keyword,
      ResultsPerPage: "1",
    });

    const res = await fetch(`${USAJOBS_BASE}/Search?${params}`, {
      headers: getHeaders() as unknown as HeadersInit,
    });

    if (!res.ok) return 0;

    const data = (await res.json()) as SearchResponse;
    return data.SearchResult.SearchResultCountAll;
  } catch {
    return 0;
  }
}
