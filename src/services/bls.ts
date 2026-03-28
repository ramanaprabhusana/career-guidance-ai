/**
 * Bureau of Labor Statistics (BLS) Public Data API v2
 * Docs: https://www.bls.gov/developers/
 */

const BLS_BASE = "https://api.bls.gov/publicAPI/v2";

interface BlsSeries {
  seriesID: string;
  data: { year: string; period: string; periodName: string; value: string }[];
}

interface BlsResponse {
  status: string;
  message: string[];
  Results?: { series?: BlsSeries[] };
}

async function blsFetch(seriesIds: string[], startYear?: string, endYear?: string): Promise<BlsSeries[]> {
  const apiKey = process.env.BLS_API_KEY;
  if (!apiKey) throw new Error("BLS_API_KEY required in .env");

  const currentYear = new Date().getFullYear();
  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: startYear ?? String(currentYear - 2),
    endyear: endYear ?? String(currentYear),
    registrationkey: apiKey,
  };

  const res = await fetch(`${BLS_BASE}/timeseries/data/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`BLS API ${res.status}: ${res.statusText}`);

  const data = (await res.json()) as BlsResponse;
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API error: ${data.message.join(", ")}`);
  }

  return data.Results?.series ?? [];
}

/**
 * OEWS series ID format: OEUM{area}{area_type}{industry}{occupation}{datatype}
 * National level: area=0000000, area_type=00
 * All industries: industry=000000
 * Data types: 01=Employment, 04=Mean wage, 13=Median wage
 */
function buildOEWSSeriesId(socCode: string, dataType: "01" | "04" | "13"): string {
  const occ = socCode.replace("-", "").replace(".", "");
  return `OEUM000000000000000${occ}${dataType}`;
}

export interface LaborMarketData {
  socCode: string;
  employment: string | null;
  meanWage: string | null;
  medianWage: string | null;
  year: string;
}

/** Get employment and wage data for an occupation SOC code */
export async function getWageData(socCode: string): Promise<LaborMarketData> {
  try {
    const seriesIds = [
      buildOEWSSeriesId(socCode, "01"), // employment
      buildOEWSSeriesId(socCode, "04"), // mean wage
      buildOEWSSeriesId(socCode, "13"), // median wage
    ];

    const series = await blsFetch(seriesIds);

    const result: LaborMarketData = {
      socCode,
      employment: null,
      meanWage: null,
      medianWage: null,
      year: String(new Date().getFullYear()),
    };

    for (const s of series) {
      const latest = s.data[0]; // most recent data point
      if (!latest) continue;

      result.year = latest.year;
      if (s.seriesID.endsWith("01")) result.employment = latest.value;
      else if (s.seriesID.endsWith("04")) result.meanWage = latest.value;
      else if (s.seriesID.endsWith("13")) result.medianWage = latest.value;
    }

    return result;
  } catch (e) {
    console.warn(`BLS lookup failed for "${socCode}":`, (e as Error).message);
    return { socCode, employment: null, meanWage: null, medianWage: null, year: "" };
  }
}

/** Get employment projection (CES data) */
export async function getEmploymentTrend(seriesId: string): Promise<{ year: string; value: string }[]> {
  try {
    const series = await blsFetch([seriesId]);
    if (!series[0]) return [];
    return series[0].data.map((d) => ({ year: d.year, value: d.value }));
  } catch (e) {
    console.warn("BLS trend lookup failed:", (e as Error).message);
    return [];
  }
}
