/**
 * STEP 13J — FEDERAL RESERVE FUNDS RATE SOURCE PILOT
 *
 * Isolated, read-only adapter for the Federal Reserve Board H.15 monthly
 * effective federal funds rate. It intentionally does NOT write to the
 * production database and does NOT replace the existing FRED transport yet.
 *
 * Source of record: Federal Reserve Board H.15, series RIFSPFF_N.M.
 * The preview endpoint is an official Fed DDP endpoint and exposes the
 * monthly observation date/value pairs without requiring an API key.
 */

const FED_H15_PREVIEW_URL =
  "https://www.federalreserve.gov/datadownload/Preview.aspx";

export const FED_FUNDS_H15_SERIES_ID = "RIFSPFF_N.M";

export interface FedFundsObservation {
  period: string;
  value: number;
}

export interface FedFundsPilotResult {
  seriesId: typeof FED_FUNDS_H15_SERIES_ID;
  description: string;
  unit: "Percent_Per_Year";
  observations: FedFundsObservation[];
  retrievedAt: string;
}

/**
 * Fetch the official H.15 monthly effective federal funds rate.
 *
 * The H.15 monthly series is a monthly average and is intentionally kept
 * separate from the FOMC target range. MUJIFX stores the published rate as-is.
 */
export async function fetchFedFundsPilot(): Promise<FedFundsPilotResult> {
  const url = new URL(FED_H15_PREVIEW_URL);
  url.searchParams.set("pi", "400");
  url.searchParams.set(
    "preview",
    `H15/H15/${FED_FUNDS_H15_SERIES_ID}`
  );
  url.searchParams.set("rel", "H15");

  const res = await fetch(url.toString(), {
    headers: { Accept: "text/html" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Federal Reserve H.15 returned HTTP ${res.status}.`);
  }

  const html = await res.text();
  const observations = parseH15MonthlyPreview(html);

  if (observations.length === 0) {
    throw new Error(
      `Federal Reserve H.15 returned no parseable observations for ${FED_FUNDS_H15_SERIES_ID}.`
    );
  }

  return {
    seriesId: FED_FUNDS_H15_SERIES_ID,
    description: "Federal funds effective rate",
    unit: "Percent_Per_Year",
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Parse the compact HTML table emitted by the Fed H.15 preview page.
 * Only YYYY-MM/value pairs are accepted; labels and unrelated series are
 * ignored. This keeps the pilot read-only and avoids any inferred dates.
 */
export function parseH15MonthlyPreview(html: string): FedFundsObservation[] {
  const text = html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\\s+/g, " ")
    .trim();

  const observations: FedFundsObservation[] = [];
  const pattern = /(?<period>\\d{4}-\\d{2})\\s+(?<value>\\d+(?:\\.\\d+)?)/g;

  for (const match of text.matchAll(pattern)) {
    const period = match.groups?.period;
    const rawValue = match.groups?.value;
    if (!period || !rawValue) continue;

    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;

    observations.push({ period, value });
  }

  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.period)) return false;
    seen.add(observation.period);
    return true;
  });
}
