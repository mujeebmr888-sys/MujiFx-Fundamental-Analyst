const DOL_UI_CLAIMS_URL = "https://oui.doleta.gov/unemploy/wkclaims/report.asp";

export interface DolUiClaimObservation {
  weekEnded: string;
  reflectingWeekEnded: string | null;
  initialClaims: number;
  continuedClaims: number;
}

export interface DolUiClaimsResult {
  observations: DolUiClaimObservation[];
  retrievedAt: string;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function parseUsDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function extractWeekBlocks(xml: string): string[] {
  return [...xml.matchAll(/<week(?:\s[^>]*)?>[\s\S]*?<\/week>/gi)].map((match) => match[0]);
}

export async function fetchDolUiClaims(startYear: number, endYear: number): Promise<DolUiClaimsResult> {
  const body = new URLSearchParams({
    level: "national",
    final_yr: String(endYear),
    strtdate: String(startYear),
    enddate: String(endYear),
    filetype: "xml",
    submit: "Submit",
  });

  const response = await fetch(DOL_UI_CLAIMS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`DOL UI claims request failed with HTTP ${response.status}.`);
  }

  const xml = await response.text();
  const blocks = extractWeekBlocks(xml);
  const observations: DolUiClaimObservation[] = [];

  for (const block of blocks) {
    const weekEnded = parseUsDate(extractTag(block, "weekEnded"));
    const reflectingWeekEnded = parseUsDate(extractTag(block, "ReflectingWeekEnded"));
    const initialClaims = parseNumber(extractTag(block, "InitialClaims"));
    const continuedClaims = parseNumber(extractTag(block, "ContinuedClaims"));

    if (!weekEnded || initialClaims === null || continuedClaims === null) {
      continue;
    }

    observations.push({
      weekEnded,
      reflectingWeekEnded,
      initialClaims,
      continuedClaims,
    });
  }

  observations.sort((a, b) => a.weekEnded.localeCompare(b.weekEnded));

  if (observations.length === 0) {
    throw new Error("DOL UI claims response contained no usable national weekly observations.");
  }

  return {
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

export { DOL_UI_CLAIMS_URL };
