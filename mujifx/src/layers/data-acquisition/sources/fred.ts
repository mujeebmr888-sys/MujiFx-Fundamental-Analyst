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
  PCE: "PCE",
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
