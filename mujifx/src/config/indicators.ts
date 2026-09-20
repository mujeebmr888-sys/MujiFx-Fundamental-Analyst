import type { IndicatorId } from "@/types/economic-data";

export interface IndicatorMeta {
  label: string;
  category: "Inflation" | "Employment" | "Growth" | "Federal Reserve" | "Market";
  unitSuffix?: string; // shown after the number, e.g. "%"
}

export const INDICATOR_META: Record<IndicatorId, IndicatorMeta> = {
  CPI: { label: "CPI (Index)", category: "Inflation" },
  CORE_CPI: { label: "Core CPI (Index)", category: "Inflation" },
  PCE: { label: "PCE (Index)", category: "Inflation" },
  CORE_PCE: { label: "Core PCE (Index)", category: "Inflation" },
  PPI: { label: "PPI (Index)", category: "Inflation" },

  NFP: { label: "Nonfarm Payrolls", category: "Employment", unitSuffix: "K" },
  UNEMPLOYMENT_RATE: {
    label: "Unemployment Rate",
    category: "Employment",
    unitSuffix: "%",
  },
  AVG_HOURLY_EARNINGS: {
    label: "Avg Hourly Earnings",
    category: "Employment",
    unitSuffix: "$",
  },
  INITIAL_JOBLESS_CLAIMS: {
    label: "Initial Jobless Claims",
    category: "Employment",
  },
  CONTINUING_CLAIMS: { label: "Continuing Claims", category: "Employment" },
  JOLTS: { label: "JOLTS Job Openings", category: "Employment" },
  SAHM_RULE: {
    label: "Sahm Rule (Recession Indicator)",
    category: "Employment",
    unitSuffix: "pp",
  },

  GDP: { label: "GDP", category: "Growth", unitSuffix: "B$" },
  GDP_GROWTH_RATE: {
    label: "Real GDP Growth (Annualized)",
    category: "Growth",
    unitSuffix: "%",
  },
  RETAIL_SALES: { label: "Retail Sales", category: "Growth", unitSuffix: "M$" },
  INDUSTRIAL_PRODUCTION: {
    label: "Industrial Production (Index)",
    category: "Growth",
  },
  ISM_MANUFACTURING: { label: "ISM Manufacturing", category: "Growth" },
  ISM_SERVICES: { label: "ISM Services", category: "Growth" },

  FED_FUNDS_RATE: {
    label: "Federal Funds Rate",
    category: "Federal Reserve",
    unitSuffix: "%",
  },

  // Same-day fact: the FOMC's announced target-range UPPER bound
  // (FRED series DFEDTARU). Unlike FED_FUNDS_RATE above (a MONTHLY
  // average that cannot be published until the month ends), this updates
  // the same business day a rate decision is announced -- which is what a
  // trader checking the site daily actually needs. See monetary-policy.ts
  // for how the two are combined without one overriding the other.
  FED_TARGET_RANGE_UPPER: {
    label: "FOMC Target Range (Upper Bound)",
    category: "Federal Reserve",
    unitSuffix: "%",
  },

  TREASURY_2Y: { label: "2-Year Treasury Yield", category: "Market", unitSuffix: "%" },
  TREASURY_10Y: {
    label: "10-Year Treasury Yield",
    category: "Market",
    unitSuffix: "%",
  },
  BROAD_DOLLAR_INDEX: { label: "US Broad Dollar Index", category: "Market" },
  VIX: { label: "VIX (Volatility Index)", category: "Market" },
};

export const CATEGORY_ORDER: IndicatorMeta["category"][] = [
  "Inflation",
  "Employment",
  "Growth",
  "Federal Reserve",
  "Market",
];
