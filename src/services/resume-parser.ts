/**
 * Resume parser (Slice S-C, Sr 19B + 24).
 *
 * Deliberately **not** an ATS-style parser. Per Sr 24 we extract exactly
 * three fields:
 *   1. name
 *   2. total years of experience
 *   3. prominent work domain (industry/sector user worked in most)
 *
 * Plain-text only. Callers are expected to hand us already-decoded UTF-8
 * (the upload endpoint does the decoding). No PDF/DOCX binaries.
 */

export interface ResumeExtract {
  name: string | null;
  years: number | null;
  domain: string | null;
}

const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  Technology: /\b(software|engineer|developer|programmer|devops|cloud|backend|frontend|full.?stack|data (scientist|engineer|analyst)|ml|machine learning|ai|cybersecurity|it)\b/i,
  Healthcare: /\b(nurse|nursing|physician|doctor|clinician|hospital|patient care|pharmac|medical|healthcare|clinical)\b/i,
  Finance: /\b(finance|accounting|accountant|audit|banking|investment|trading|cfa|cpa|portfolio|treasury)\b/i,
  Education: /\b(teacher|teaching|professor|lecturer|instructor|curriculum|school|education)\b/i,
  Manufacturing: /\b(manufacturing|production|assembly|factory|plant|operations|industrial|supply chain|logistics)\b/i,
  Marketing: /\b(marketing|brand|advertising|seo|content|growth|campaign|social media)\b/i,
  Sales: /\b(sales|business development|account executive|territory|quota)\b/i,
  Consulting: /\b(consult(ant|ing)?|advisory|strategy)\b/i,
  Legal: /\b(attorney|lawyer|paralegal|legal|counsel|litigation)\b/i,
};

export function parseResumeText(raw: string): ResumeExtract {
  const text = (raw ?? "").replace(/\r/g, "");
  const extract: ResumeExtract = { name: null, years: null, domain: null };
  if (!text.trim()) return extract;

  // --- Name: first non-empty line that looks like a person name (2-4 words,
  // mostly letters, no digits, not an email / URL / section header).
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (/@|https?:|\d/.test(line)) continue;
    if (/^(resume|curriculum vitae|cv|profile|summary|objective|experience|education|skills)$/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][a-zA-Z.\-']*$/.test(w))) {
      extract.name = line;
      break;
    }
  }

  // --- Years: explicit "X years of experience" phrase, else max from
  // "YYYY - YYYY" or "YYYY-Present" date ranges.
  const explicit = text.match(/(\d{1,2})\+?\s*years?\s+(of\s+)?(professional\s+)?experience/i);
  if (explicit) {
    extract.years = Math.min(60, parseInt(explicit[1], 10));
  } else {
    const currentYear = new Date().getFullYear();
    let maxSpan = 0;
    const range = /(\b(19|20)\d{2})\s*[-–to]{1,3}\s*(\b(19|20)\d{2}\b|present|current)/gi;
    let m: RegExpExecArray | null;
    while ((m = range.exec(text)) !== null) {
      const start = parseInt(m[1], 10);
      const endRaw = m[3].toLowerCase();
      const end = /present|current/.test(endRaw) ? currentYear : parseInt(endRaw, 10);
      if (end >= start && end - start <= 60) maxSpan = Math.max(maxSpan, end - start);
    }
    if (maxSpan > 0) extract.years = maxSpan;
  }

  // --- Domain: score each domain by total keyword hits; pick the winner.
  let best: { domain: string; score: number } | null = null;
  for (const [domain, regex] of Object.entries(DOMAIN_KEYWORDS)) {
    const matches = text.match(new RegExp(regex.source, "gi"));
    const score = matches ? matches.length : 0;
    if (score > 0 && (!best || score > best.score)) {
      best = { domain, score };
    }
  }
  if (best) extract.domain = best.domain;

  return extract;
}
