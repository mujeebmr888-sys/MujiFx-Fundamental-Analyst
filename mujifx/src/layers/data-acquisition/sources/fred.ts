/**
 * LAYER 1: DATA ACQUISITION
 * Talks to the real FRED API. Does not interpret or score anything.
 * If the request fails or data is missing, returns available:false —
 * never fabricates a number.
 */

import type { EconomicDataPoint, IndicatorId } from "@/types/economic-data";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

// Maps our internal indicator IDs to FRED's official series IDs.
// See docs/DATA_SOURCES.md for the full mapping and rationale.
const FRED_SERIES_MAP: Partial<Record<IndicatorId, string>> = {
  CPI: "CPIAUCSL",
  CORE_CPI: "CPILFESL",
  PCE: "PCEPI", // Personal Consumption Expenditures: Chain-type Price Index (the price index, NOT the PCE dollar-level series "PCE")
  CORE_PCE: "PCEPILFE",
  PPI: "PPIACO",
  NFP: "PAYEMS",
  UNEMPLOYMENT_RATE: "UNRATE",
  AVG_HOURLY_EARNINGS: "CES0500000003",
  INITIAL_JOBLESS_CLAIMS: "ICSA",
  CONTINUING_CLAIMS: "CCSA",
  JOLTS: "JTSJOL",
  SAHM_RULE: "SAHMREALTIME", // FRED's own pre-calculated Sahm Rule — never recomputed in our code
  GDP: "GDP",
  GDP_GROWTH_RATE: "A191RL1Q225SBEA", // BEA's own pre-computed Real GDP % change, SAAR — used as-is, never re-annualized
  RETAIL_SALES: "RSAFS",
  INDUSTRIAL_PRODUCTION: "INDPRO",
  FED_FUNDS_RATE: "FEDFUNDS",
  TREASURY_2Y: "DGS2",
  TREASURY_10Y: "DGS10",
  BROAD_DOLLAR_INDEX: "DTWEXBGS",
  VIX: "VIXCLS", // CBOE VIX distributed through FRED — stored as retrieved, no additional calculation
};

// Exported so the sync-all route can loop over every mapped indicator
// without hardcoding the list a second time.
export const ALL_FRED_INDICATORS = Object.keys(
  FRED_SERIES_MAP
) as IndicatorId[];

export async function fetchLatestFromFred(
  indicator: IndicatorId
): Promise<EconomicDataPoint> {
  const seriesId = FRED_SERIES_MAP[indicator];
  const apiKey = process.env.FRED_API_KEY;

  const baseReturn = {
    indicator,
    releaseDate: new Date().toISOString(),
    periodCovered: "",
    previous: null,
    consensusForecast: null, // FRED does not provide consensus forecasts
    mujifxEstimate: null,
    actual: null,
    unit: "",
    source: {
      name: `FRED (series ${seriesId ?? "UNMAPPED"})`,
      url: "https://fred.stlouisfed.org/",
      tier: "TIER_1_OFFICIAL" as const,
      retrievedAt: new Date().toISOString(),
    },
  };

  if (!seriesId) {
    return {
      ...baseReturn,
      available: false,
      unavailableReason: `No FRED series mapped for indicator "${indicator}". See docs/DATA_SOURCES.md.`,
    };
  }

  if (!apiKey) {
    return {
      ...baseReturn,
      available: false,
      unavailableReason:
        "FRED_API_KEY is not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html",
    };
  }

  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=2`;
    const res = await fetch(url);

    if (!res.ok) {
      return {
        ...baseReturn,
        available: false,
        unavailableReason: `FRED API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const observations = data?.observations ?? [];

    if (observations.length === 0) {
      return {
        ...baseReturn,
        available: false,
        unavailableReason: "FRED API returned no observations for this series.",
      };
    }

    const latest = observations[0];
    const prior = observations[1];

    return {
      ...baseReturn,
      periodCovered: latest.date,
      releaseDate: latest.date,
      actual: latest.value === "." ? null : parseFloat(latest.value),
      previous: prior && prior.value !== "." ? parseFloat(prior.value) : null,
      unit: "as published by FRED (see series notes)",
      available: latest.value !== ".",
      unavailableReason:
        latest.value === "." ? "FRED marked this observation as missing (.)." : undefined,
    };
  } catch (err) {
    return {
      ...baseReturn,
      available: false,
      unavailableReason: `Network/parse error calling FRED: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * ONE-TIME BACKFILL DEPTH PER INDICATOR — used only by the new backfill
 * route, never by fetchLatestFromFred/ALL_FRED_INDICATORS/the daily
 * /api/sync/all cron, which continue completely unchanged.
 *
 * Each number is the exact minimum the corresponding assessment engine's
 * own calculation code requires (verified by inspecting each engine),
 * matching the same already-approved depths used by /api/assessment/usd:
 *
 *   CPI/CORE_CPI/PCE/CORE_PCE/PPI/NFP/UNEMPLOYMENT_RATE/
 *   AVG_HOURLY_EARNINGS/RETAIL_SALES/INDUSTRIAL_PRODUCTION: 13
 *     (YoY / 12-release calculations read index 12)
 *   INITIAL_JOBLESS_CLAIMS: 8 (4-week avg vs prior 4-week avg, index 7)
 *   CONTINUING_CLAIMS/JOLTS: 4 (3-release trend, index 3)
 *   SAHM_RULE: 1 — the engine minimum. Employment.ts only ever reads
 *     `sahmReal[0]`; no historical trend is computed for Sahm there.
 *   GDP_GROWTH_RATE: engine minimum is 2 (growth.ts's confidence logic
 *     checks `.length < 2` before allowing above "Low"). 8 is used here
 *     as an IMPLEMENTATION BUFFER (not a stricter engine requirement) —
 *     roughly 2 years of quarterly data, matching the same buffer already
 *     used by /api/assessment/usd's read-side depth, so backfill and read
 *     stay consistent with each other.
 *   FED_FUNDS_RATE: 4 (3-release change, with graceful fallback)
 *   TREASURY_2Y/TREASURY_10Y: 10 (date-alignment buffer for the 10Y-2Y
 *     spread trend, which matches by period_covered rather than index)
 *   BROAD_DOLLAR_INDEX/VIX: 4 (plain trend, index 3)
 */
export const INDICATOR_BACKFILL_DEPTH: Partial<Record<IndicatorId, number>> = {
  CPI: 13,
  CORE_CPI: 13,
  PCE: 13,
  CORE_PCE: 13,
  PPI: 13,
  NFP: 13,
  UNEMPLOYMENT_RATE: 13,
  AVG_HOURLY_EARNINGS: 13,
  INITIAL_JOBLESS_CLAIMS: 8,
  CONTINUING_CLAIMS: 4,
  JOLTS: 4,
  SAHM_RULE: 1,
  GDP_GROWTH_RATE: 8, // engine minimum is 2 — see comment above
  RETAIL_SALES: 13,
  INDUSTRIAL_PRODUCTION: 13,
  FED_FUNDS_RATE: 4,
  TREASURY_2Y: 10,
  TREASURY_10Y: 10,
  BROAD_DOLLAR_INDEX: 4,
  VIX: 4,
};

/**
 * LAYER 1 (bulk/backfill variant) — fetches up to `depth` historical
 * observations for ONE indicator. Used only by the new one-time backfill
 * route. Does NOT modify or replace fetchLatestFromFred above, which the
 * daily /api/sync/all cron continues to use completely unchanged
 * (limit=2, single latest point).
 *
 * CHRONOLOGICAL "previous" MAPPING: each returned point's `previous` is
 * the FRED observation immediately OLDER than it in the SAME fetched
 * batch — the identical adjacency rule fetchLatestFromFred already uses
 * for its single latest/prior pair (observations[0] vs observations[1]),
 * just applied at every index instead of only the newest one. This is
 * why `depth + 1` observations are requested from FRED: the oldest of
 * the `depth` points we actually return still needs one more, even-older
 * observation available to correctly compute ITS OWN `previous`.
 *
 * DATA INTEGRITY: observations FRED marks as missing (".") are skipped
 * entirely — never inserted, never interpolated, never fabricated. If a
 * point's own "previous" observation happens to be missing, that point's
 * `previous` is `null` — matching fetchLatestFromFred's existing
 * behavior exactly, not a new rule.
 */
export async function fetchHistoryFromFred(
  indicator: IndicatorId,
  depth: number
): Promise<EconomicDataPoint[]> {
  const seriesId = FRED_SERIES_MAP[indicator];
  const apiKey = process.env.FRED_API_KEY;
  if (!seriesId || !apiKey) return [];

  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${
      depth + 1
    }`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const observations: Array<{ date: string; value: string }> = data?.observations ?? [];

    const points: EconomicDataPoint[] = [];
    for (let i = 0; i < Math.min(depth, observations.length); i++) {
      const obs = observations[i];
      if (obs.value === ".") continue; // FRED-marked missing — skip, never fabricate

      const priorObs = observations[i + 1];
      const previous =
        priorObs && priorObs.value !== "." ? parseFloat(priorObs.value) : null;

      points.push({
        indicator,
        releaseDate: obs.date,
        periodCovered: obs.date,
        previous,
        consensusForecast: null,
        mujifxEstimate: null,
        actual: parseFloat(obs.value),
        unit: "as published by FRED (see series notes)",
        available: true,
        source: {
          name: `FRED (series ${seriesId})`,
          url: "https://fred.stlouisfed.org/",
          tier: "TIER_1_OFFICIAL",
          retrievedAt: new Date().toISOString(),
        },
      });
    }
    return points;
  } catch {
    return [];
  }
}
