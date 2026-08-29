/**
 * LAYER 6 — GROWTH ASSESSMENT ENGINE
 *
 * Implements the Growth section of docs/methodology_fundamental_scoring.md
 * EXACTLY. Deterministic only — no AI, no invented indicators, no new data
 * sources. Pure function: takes already-fetched history rows as input (same
 * pattern as inflation.ts and employment.ts) so this file has no direct
 * database or network dependency.
 *
 * GDP_GROWTH_RATE (FRED A191RL1Q225SBEA — BEA's own already-annualized
 * Real GDP % change series) is a reserved indicator ID in the type system
 * but is NOT yet wired into the data-acquisition pipeline
 * (src/layers/data-acquisition/sources/fred.ts) — per instructions, this
 * step does not touch the pipeline. This engine accepts a `gdpGrowthRate`
 * input array and, if it's empty, honestly reports it as a data limitation
 * rather than fabricating a value or deriving growth from the GDP level
 * series.
 */

import type {
  GrowthAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

/** Minimal shape this engine needs from a stored release row (newest-first arrays, matching getIndicatorHistory's ordering). */
export interface GrowthHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface GrowthEngineInput {
  /** FRED A191RL1Q225SBEA — already a published, already-annualized QoQ % change. Used AS-IS, never re-derived from a GDP level series. */
  gdpGrowthRate: GrowthHistoryRow[];
  retailSales: GrowthHistoryRow[];
  industrialProduction: GrowthHistoryRow[];
}

/**
 * PROVISIONAL, CONFIGURABLE DESIGN BENCHMARK (not an immutable economic
 * law). ~1.8% is CBO's own published estimate of long-run US potential
 * GDP growth — a citable source, but CBO revises this periodically, so
 * this constant is kept adjustable. See methodology doc, Section 3.
 */
const GDP_POTENTIAL_GROWTH_BENCHMARK_PCT = 1.8;

/**
 * PROVISIONAL, CONFIGURABLE DESIGN THRESHOLD (not an economic fact). A
 * tolerance band around the potential-growth benchmark so a reading
 * essentially at the benchmark reads as "Near potential" rather than being
 * forced into "Above" or "Below" by a razor-thin comparison. This band
 * width is our own design choice, not a published CBO or BEA figure.
 */
const GDP_NEAR_POTENTIAL_BAND_PP = 0.3;

function toSourceRef(row: GrowthHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

/** Only real releases — defensively excludes forecast placeholder rows (actual: null) that can share this table. */
function realReleasesOnly(rows: GrowthHistoryRow[]): GrowthHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Percentage change over `releasesBack` releases: ((latest/past) - 1) * 100. More comparable across indicators with different units/scales than a raw level difference. Safely reports unavailable rather than inventing a value when the past observation is missing or zero (undefined percentage change). */
function pctChangeOver(rows: GrowthHistoryRow[], releasesBack: number): number | null {
  if (rows.length <= releasesBack) return null;
  const latest = rows[0].actual;
  const past = rows[releasesBack].actual;
  if (latest === null || past === null || past === 0) return null;
  return round(((latest / past) - 1) * 100);
}

/**
 * Computes 3-release, 6-release, and (where available) 12-release trend
 * readings for a monthly-cadence series (Retail Sales, Industrial
 * Production), each labeled Rising/Falling/Flat, plus a short-term (latest
 * MoM) context reading. Never invents a trend from fewer releases than
 * required.
 */
function buildMonthlyTrend(rows: GrowthHistoryRow[], label: string) {
  const real = realReleasesOnly(rows);
  const calcs: AssessmentCalculation[] = [];

  const mom =
    real[0] && real[0].actual !== null && real[0].previous !== null
      ? round((real[0].actual as number) - (real[0].previous as number))
      : null;
  calcs.push({
    label: `${label}: change vs previous release (short-term context)`,
    formula: "latest.actual - latest.previous",
    result: mom,
  });

  const horizons: Array<{ key: "3" | "6" | "12"; releasesBack: number }> = [
    { key: "3", releasesBack: 3 },
    { key: "6", releasesBack: 6 },
    { key: "12", releasesBack: 12 },
  ];

  const trends: Record<"3" | "6" | "12", number | null> = { "3": null, "6": null, "12": null };
  for (const h of horizons) {
    const value = pctChangeOver(real, h.releasesBack);
    trends[h.key] = value;
    calcs.push({
      label: `${label}: percentage change over last ${h.releasesBack} releases`,
      formula: `((latest.actual / value_${h.releasesBack}_releases_ago) - 1) * 100`,
      result: value,
      unavailableReason:
        value === null
          ? `Need ${h.releasesBack + 1} stored releases with a non-zero denominator; have ${real.length}.`
          : undefined,
    });
  }

  return { mom, trend3: trends["3"], trend6: trends["6"], trend12: trends["12"], calcs, real };
}

function trendLabel(v: number | null): "Rising" | "Falling" | "Flat" | null {
  if (v === null) return null;
  if (v > 0) return "Rising";
  if (v < 0) return "Falling";
  return "Flat";
}

export function generateGrowthAssessment(input: GrowthEngineInput): GrowthAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "No housing-market data, consumer sentiment data, or ISM Manufacturing/Services data in the pipeline yet — those are future milestones, not approximated here.",
  ];

  // ================= GDP (quarterly, already-annualized, used AS-IS) =================
  const gdpReal = realReleasesOnly(input.gdpGrowthRate);
  let gdpLatest: number | null = null;
  let gdpLevelLabel: "Above potential" | "Near potential" | "Below potential" | "Insufficient data" = "Insufficient data";

  if (gdpReal.length === 0) {
    dataLimitations.push(
      "GDP growth rate (FRED A191RL1Q225SBEA): not yet wired into the data-acquisition pipeline — no data available this run. Not derived from the GDP level series, per instructions."
    );
  } else {
    gdpLatest = gdpReal[0].actual;
    facts.push({
      label: "Real GDP growth, annualized QoQ (BEA, published as-is)",
      value: gdpLatest,
      periodCovered: gdpReal[0].period_covered,
      source: toSourceRef(gdpReal[0]),
    });
    calculations.push({
      label: "GDP growth vs potential-growth benchmark",
      formula: `published_GDP_growth_rate - ${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}`,
      result: gdpLatest !== null ? round(gdpLatest - GDP_POTENTIAL_GROWTH_BENCHMARK_PCT) : null,
    });

    if (gdpLatest !== null) {
      const upperBound = GDP_POTENTIAL_GROWTH_BENCHMARK_PCT + GDP_NEAR_POTENTIAL_BAND_PP;
      const lowerBound = GDP_POTENTIAL_GROWTH_BENCHMARK_PCT - GDP_NEAR_POTENTIAL_BAND_PP;
      gdpLevelLabel =
        gdpLatest > upperBound ? "Above potential" : gdpLatest < lowerBound ? "Below potential" : "Near potential";
      interpretations.push({
        label: "GDP growth vs potential",
        rule: `Provisional, configurable benchmark: ~${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}% (CBO's own published estimate of long-run US potential GDP growth — not an immutable economic law; CBO revises this periodically), with a provisional ±${GDP_NEAR_POTENTIAL_BAND_PP}pp tolerance band (our own design choice, not a published figure). Above ${upperBound}% = 'Above potential'; below ${lowerBound}% = 'Below potential'; in between (inclusive of exactly ${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}%) = 'Near potential'.`,
        result: gdpLevelLabel,
        isProvisionalThreshold: true,
      });
      evidence.push(`GDP growth = ${gdpLatest}% (annualized, published as-is) → ${gdpLevelLabel} vs the ${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}% ± ${GDP_NEAR_POTENTIAL_BAND_PP}pp provisional band.`);
    }
  }

  // ================= Retail Sales (monthly trend) =================
  const retail = buildMonthlyTrend(input.retailSales, "Retail Sales");
  calculations.push(...retail.calcs);
  if (retail.real.length === 0) {
    dataLimitations.push("Retail Sales: no releases stored yet.");
  } else {
    facts.push({
      label: "Retail Sales (latest)",
      value: retail.real[0].actual,
      periodCovered: retail.real[0].period_covered,
      source: toSourceRef(retail.real[0]),
    });
  }
  const retail3Label = trendLabel(retail.trend3);
  const retail6Label = trendLabel(retail.trend6);
  const retail12Label = trendLabel(retail.trend12);
  if (retail3Label) {
    interpretations.push({
      label: "Retail Sales: 3-release trend (primary)",
      rule: "Change over the last 3 stored releases, not a single period-over-period move or an absolute dollar threshold. Latest single-period change shown separately as short-term context.",
      result: `${retail3Label}${retail.mom !== null ? ` (short-term context: latest change ${retail.mom >= 0 ? "+" : ""}${retail.mom})` : ""}`,
    });
    evidence.push(`Retail Sales 3-release trend = ${retail3Label.toLowerCase()} (${retail.trend3}).`);
  } else {
    dataLimitations.push(`Retail Sales: 3-release trend not yet computable (have ${retail.real.length} stored release(s), need 4).`);
  }
  if (retail6Label) {
    interpretations.push({
      label: "Retail Sales: 6-release trend",
      rule: "Change over the last 6 stored releases — a medium-term confirmation of the 3-release trend.",
      result: retail6Label,
    });
  }
  if (retail12Label) {
    interpretations.push({
      label: "Retail Sales: 12-release context",
      rule: "Change over the last 12 stored releases, where sufficient history exists — longer-term context only.",
      result: retail12Label,
    });
  }
  if (retail3Label && retail6Label && retail3Label !== retail6Label && retail3Label !== "Flat" && retail6Label !== "Flat") {
    conflictingEvidence.push(
      `Retail Sales: the 3-release trend (${retail3Label}) and the 6-release trend (${retail6Label}) disagree — surfaced rather than resolved mechanically.`
    );
  }

  // ================= Industrial Production (monthly trend) =================
  const indProd = buildMonthlyTrend(input.industrialProduction, "Industrial Production");
  calculations.push(...indProd.calcs);
  if (indProd.real.length === 0) {
    dataLimitations.push("Industrial Production: no releases stored yet.");
  } else {
    facts.push({
      label: "Industrial Production (latest)",
      value: indProd.real[0].actual,
      periodCovered: indProd.real[0].period_covered,
      source: toSourceRef(indProd.real[0]),
    });
  }
  const indProd3Label = trendLabel(indProd.trend3);
  const indProd6Label = trendLabel(indProd.trend6);
  const indProd12Label = trendLabel(indProd.trend12);
  if (indProd3Label) {
    interpretations.push({
      label: "Industrial Production: 3-release trend (primary)",
      rule: "Change over the last 3 stored releases, not a single period-over-period move or an absolute index-level threshold. Latest single-period change shown separately as short-term context.",
      result: `${indProd3Label}${indProd.mom !== null ? ` (short-term context: latest change ${indProd.mom >= 0 ? "+" : ""}${indProd.mom})` : ""}`,
    });
    evidence.push(`Industrial Production 3-release trend = ${indProd3Label.toLowerCase()} (${indProd.trend3}).`);
  } else {
    dataLimitations.push(`Industrial Production: 3-release trend not yet computable (have ${indProd.real.length} stored release(s), need 4).`);
  }
  if (indProd6Label) {
    interpretations.push({
      label: "Industrial Production: 6-release trend",
      rule: "Change over the last 6 stored releases — a medium-term confirmation of the 3-release trend.",
      result: indProd6Label,
    });
  }
  if (indProd12Label) {
    interpretations.push({
      label: "Industrial Production: 12-release context",
      rule: "Change over the last 12 stored releases, where sufficient history exists — longer-term context only.",
      result: indProd12Label,
    });
  }
  if (indProd3Label && indProd6Label && indProd3Label !== indProd6Label && indProd3Label !== "Flat" && indProd6Label !== "Flat") {
    conflictingEvidence.push(
      `Industrial Production: the 3-release trend (${indProd3Label}) and the 6-release trend (${indProd6Label}) disagree — surfaced rather than resolved mechanically.`
    );
  }

  // ================= FINAL ASSESSMENT: deterministic evidence-pattern rules (no scoring, no voting) =================
  // Monthly-activity "supportive/weak/neutral" state is read from each
  // series' PRIMARY 3-release trend (never from a single period-over-period
  // move, and never from an absolute dollar/index threshold).
  const retailState: "supportive" | "weak" | "neutral" | null =
    retail3Label === "Rising" ? "supportive" : retail3Label === "Falling" ? "weak" : retail3Label === "Flat" ? "neutral" : null;
  const indProdState: "supportive" | "weak" | "neutral" | null =
    indProd3Label === "Rising" ? "supportive" : indProd3Label === "Falling" ? "weak" : indProd3Label === "Flat" ? "neutral" : null;

  const gdpAbove = gdpLevelLabel === "Above potential";
  const gdpBelow = gdpLevelLabel === "Below potential";
  const bothMonthlySupportive = retailState === "supportive" && indProdState === "supportive";
  const bothMonthlyWeak = retailState === "weak" && indProdState === "weak";
  const hadContradiction = conflictingEvidence.length > 0;

  const matchesStrongPattern =
    gdpLevelLabel !== "Insufficient data" && gdpAbove && bothMonthlySupportive && !hadContradiction;

  const matchesWeakPattern =
    gdpLevelLabel !== "Insufficient data" && gdpBelow && bothMonthlyWeak;

  let assessment: GrowthAssessment["assessment"];
  let assessmentReason: string;

  if (matchesStrongPattern) {
    assessment = "Strong";
    assessmentReason =
      "Matches the Strong pattern: GDP growth reads above the potential-growth benchmark, and both Retail Sales and Industrial Production 3-release trends are rising, with no contradiction flagged.";
  } else if (matchesWeakPattern) {
    assessment = "Weak";
    assessmentReason =
      "Matches the Weak pattern: GDP growth reads below the potential-growth benchmark (or contracting), and both Retail Sales and Industrial Production 3-release trends are falling.";
  } else {
    assessment = "Moderate";
    const reasons: string[] = [];
    if (gdpLevelLabel === "Insufficient data") reasons.push("GDP growth rate is not yet available");
    if (retailState === null || indProdState === null) reasons.push("Retail Sales and/or Industrial Production 3-release trend is not yet computable");
    if (gdpLevelLabel !== "Insufficient data" && !bothMonthlySupportive && !bothMonthlyWeak && retailState !== null && indProdState !== null) {
      reasons.push("Retail Sales and Industrial Production trends disagree with each other, or one/both are flat");
    }
    if (gdpLevelLabel === "Near potential") {
      reasons.push(`GDP growth is near the potential-growth benchmark (within the provisional ±${GDP_NEAR_POTENTIAL_BAND_PP}pp band)`);
    }
    if (gdpLevelLabel !== "Insufficient data" && ((gdpAbove && !bothMonthlySupportive) || (gdpBelow && !bothMonthlyWeak))) {
      reasons.push("GDP's direction is not confirmed by both monthly activity indicators");
    }
    if (hadContradiction) reasons.push("a contradiction was already flagged between Retail Sales/Industrial Production horizons");
    if (reasons.length === 0) reasons.push("evidence is near the potential-growth benchmark or otherwise mixed");
    assessmentReason = `Does not fully match the Strong or Weak pattern: ${reasons.join("; ")}.`;
  }

  interpretations.push({
    label: "Overall Growth assessment rule (evidence-pattern matrix)",
    rule: "Deterministic pattern match, never a weighted score, majority vote, or simple indicator count. STRONG = GDP growth above the potential-growth benchmark AND both Retail Sales and Industrial Production 3-release trends rising AND no contradiction flagged. WEAK = GDP growth below benchmark (or contracting) AND both Retail Sales and Industrial Production 3-release trends falling. MODERATE = everything else — mixed evidence, near-potential GDP growth, disagreement between GDP and the monthly indicators, or insufficient data — with the specific reason stated.",
    result: `${assessment} — ${assessmentReason}`,
  });

  // ================= CONFIDENCE =================
  // GDP is quarterly while Retail Sales/Industrial Production are monthly —
  // confidence is explicitly capped at Medium until at least 2 GDP releases
  // are stored, since a single GDP print has limited trend information on
  // its own.
  let confidence: ConfidenceLevel;
  const gdpReleaseCount = gdpReal.length;
  const monthlyComputable = [retailState, indProdState].filter((s) => s !== null).length;

  if (gdpReleaseCount === 0 && monthlyComputable === 0) {
    confidence = "Insufficient data";
  } else if (gdpReleaseCount < 2) {
    confidence = monthlyComputable > 0 ? "Low" : "Insufficient data";
    dataLimitations.push(
      `Confidence capped: only ${gdpReleaseCount} GDP release(s) stored — at least 2 are required before confidence can exceed 'Low', since a single quarterly print has limited trend information on its own.`
    );
  } else if (gdpReleaseCount >= 2 && monthlyComputable === 2) {
    confidence = "Medium"; // explicitly capped at Medium per instructions — GDP's quarterly cadence limits how far above Medium this engine will claim, even with plenty of monthly data.
  } else {
    confidence = "Low";
  }

  return {
    category: "Growth",
    asOf,
    facts,
    calculations,
    interpretations,
    assessment,
    confidence,
    evidence,
    conflictingEvidence,
    dataLimitations,
  };
}
