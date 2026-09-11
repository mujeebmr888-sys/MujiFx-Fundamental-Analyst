/**
 * LAYER 6 — GROWTH ASSESSMENT ENGINE
 *
 * Deterministic only. No AI, no weighted score, no invented indicators.
 * Implements the approved Growth methodology:
 *   GDP growth vs ~1.8% potential-growth benchmark
 *   + Retail Sales 3-release trend
 *   + Industrial Production 3-release trend
 *   -> Strong / Weak / Moderate evidence-pattern assessment.
 */

import type {
  GrowthAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

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
  /** BEA Real GDP growth rate, already published as annualized QoQ %. Used as-is. */
  gdpGrowthRate: GrowthHistoryRow[];
  retailSales: GrowthHistoryRow[];
  industrialProduction: GrowthHistoryRow[];
}

/** Provisional/configurable benchmark based on CBO's long-run potential-growth estimate. */
const GDP_POTENTIAL_GROWTH_BENCHMARK_PCT = 1.8;

function toSourceRef(row: GrowthHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

function realReleasesOnly(rows: GrowthHistoryRow[]): GrowthHistoryRow[] {
  return rows.filter((row) => row.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pctChangeOver(rows: GrowthHistoryRow[], releasesBack: number): number | null {
  if (rows.length <= releasesBack) return null;
  const latest = rows[0].actual;
  const past = rows[releasesBack].actual;
  if (latest === null || past === null || past === 0) return null;
  return round(((latest / past) - 1) * 100);
}

function trendLabel(v: number | null): "Rising" | "Falling" | "Flat" | null {
  if (v === null) return null;
  if (v > 0) return "Rising";
  if (v < 0) return "Falling";
  return "Flat";
}

function buildMonthlyTrend(rows: GrowthHistoryRow[], label: string) {
  const real = realReleasesOnly(rows);
  const calcs: AssessmentCalculation[] = [];

  const latestChange =
    real[0] && real[0].actual !== null && real[0].previous !== null
      ? round(real[0].actual - real[0].previous)
      : null;

  calcs.push({
    label: `${label}: change vs previous release (short-term context)`,
    formula: "latest.actual - latest.previous",
    result: latestChange,
  });

  const horizons = [3, 6, 12] as const;
  const trends: Record<"3" | "6" | "12", number | null> = {
    "3": null,
    "6": null,
    "12": null,
  };

  for (const releasesBack of horizons) {
    const value = pctChangeOver(real, releasesBack);
    trends[String(releasesBack) as "3" | "6" | "12"] = value;
    calcs.push({
      label: `${label}: percentage change over last ${releasesBack} releases`,
      formula: `((latest.actual / value_${releasesBack}_releases_ago) - 1) * 100`,
      result: value,
      unavailableReason:
        value === null
          ? `Need ${releasesBack + 1} stored releases with a non-zero denominator; have ${real.length}.`
          : undefined,
    });
  }

  return {
    real,
    latestChange,
    trend3: trends["3"],
    trend6: trends["6"],
    trend12: trends["12"],
    calcs,
  };
}

export function generateGrowthAssessment(input: GrowthEngineInput): GrowthAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "Housing-market data, consumer sentiment, and ISM Manufacturing/Services are not part of the approved Growth pipeline yet; they are not approximated here.",
  ];

  // ================= GDP =================
  const gdpReal = realReleasesOnly(input.gdpGrowthRate);
  let gdpLatest: number | null = null;
  let gdpState: "Above potential" | "Below potential" | "At/near benchmark" | "Insufficient data" = "Insufficient data";

  if (gdpReal.length === 0) {
    dataLimitations.push("GDP growth: no real observation is available in this run.");
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
      if (gdpLatest > GDP_POTENTIAL_GROWTH_BENCHMARK_PCT) {
        gdpState = "Above potential";
      } else if (gdpLatest < GDP_POTENTIAL_GROWTH_BENCHMARK_PCT) {
        gdpState = "Below potential";
      } else {
        gdpState = "At/near benchmark";
      }

      interpretations.push({
        label: "GDP growth vs potential",
        rule: `Use the provisional/configurable ~${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}% long-run potential-growth benchmark. Above the benchmark = above potential; below the benchmark = below potential. No additional tolerance band is applied.`,
        result: gdpState,
        isProvisionalThreshold: true,
      });

      evidence.push(
        `GDP growth = ${gdpLatest}% annualized QoQ, ${gdpState.toLowerCase()} the ~${GDP_POTENTIAL_GROWTH_BENCHMARK_PCT}% potential-growth benchmark.`
      );
    }
  }

  // ================= Retail Sales =================
  const retail = buildMonthlyTrend(input.retailSales, "Retail Sales");
  calculations.push(...retail.calcs);

  if (retail.real.length === 0) {
    dataLimitations.push("Retail Sales: no real observations are available.");
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
      rule: "Use the direction of the last 3 stored releases. The latest single-period change is context only.",
      result: `${retail3Label}${retail.latestChange !== null ? ` (latest change: ${retail.latestChange >= 0 ? "+" : ""}${retail.latestChange})` : ""}`,
    });
    evidence.push(`Retail Sales 3-release trend = ${retail3Label.toLowerCase()}.`);
  } else {
    dataLimitations.push(`Retail Sales: 3-release trend requires 4 stored observations; have ${retail.real.length}.`);
  }

  if (retail6Label) {
    interpretations.push({
      label: "Retail Sales: 6-release trend",
      rule: "Medium-term confirmation only; it does not override the primary 3-release trend mechanically.",
      result: retail6Label,
    });
  }

  if (retail12Label) {
    interpretations.push({
      label: "Retail Sales: 12-release context",
      rule: "Longer-term context where sufficient history exists.",
      result: retail12Label,
    });
  }

  if (retail3Label && retail6Label && retail3Label !== retail6Label && retail3Label !== "Flat" && retail6Label !== "Flat") {
    conflictingEvidence.push(
      `Retail Sales: 3-release trend (${retail3Label}) and 6-release trend (${retail6Label}) disagree.`
    );
  }

  // ================= Industrial Production =================
  const indProd = buildMonthlyTrend(input.industrialProduction, "Industrial Production");
  calculations.push(...indProd.calcs);

  if (indProd.real.length === 0) {
    dataLimitations.push("Industrial Production: no real observations are available.");
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
      rule: "Use the direction of the last 3 stored releases. The latest single-period change is context only.",
      result: `${indProd3Label}${indProd.latestChange !== null ? ` (latest change: ${indProd.latestChange >= 0 ? "+" : ""}${indProd.latestChange})` : ""}`,
    });
    evidence.push(`Industrial Production 3-release trend = ${indProd3Label.toLowerCase()}.`);
  } else {
    dataLimitations.push(`Industrial Production: 3-release trend requires 4 stored observations; have ${indProd.real.length}.`);
  }

  if (indProd6Label) {
    interpretations.push({
      label: "Industrial Production: 6-release trend",
      rule: "Medium-term confirmation only; it does not override the primary 3-release trend mechanically.",
      result: indProd6Label,
    });
  }

  if (indProd12Label) {
    interpretations.push({
      label: "Industrial Production: 12-release context",
      rule: "Longer-term context where sufficient history exists.",
      result: indProd12Label,
    });
  }

  if (indProd3Label && indProd6Label && indProd3Label !== indProd6Label && indProd3Label !== "Flat" && indProd6Label !== "Flat") {
    conflictingEvidence.push(
      `Industrial Production: 3-release trend (${indProd3Label}) and 6-release trend (${indProd6Label}) disagree.`
    );
  }

  // ================= FINAL ASSESSMENT =================
  const retailState =
    retail3Label === "Rising" ? "supportive" : retail3Label === "Falling" ? "weak" : retail3Label === "Flat" ? "neutral" : null;
  const indProdState =
    indProd3Label === "Rising" ? "supportive" : indProd3Label === "Falling" ? "weak" : indProd3Label === "Flat" ? "neutral" : null;

  const bothMonthlySupportive = retailState === "supportive" && indProdState === "supportive";
  const bothMonthlyWeak = retailState === "weak" && indProdState === "weak";
  const hadContradiction = conflictingEvidence.length > 0;

  const matchesStrongPattern =
    gdpState === "Above potential" && bothMonthlySupportive && !hadContradiction;
  const matchesWeakPattern =
    gdpState === "Below potential" && bothMonthlyWeak;

  let assessment: GrowthAssessment["assessment"];
  let assessmentReason: string;

  if (matchesStrongPattern) {
    assessment = "Strong";
    assessmentReason =
      "GDP growth is above the potential-growth benchmark, both primary monthly activity trends are rising, and no contradiction is flagged.";
  } else if (matchesWeakPattern) {
    assessment = "Weak";
    assessmentReason =
      "GDP growth is below the potential-growth benchmark and both primary monthly activity trends are falling.";
  } else {
    assessment = "Moderate";
    const reasons: string[] = [];
    if (gdpState === "Insufficient data") reasons.push("GDP growth is unavailable");
    if (retailState === null || indProdState === null) reasons.push("one or both primary monthly trends are unavailable");
    if (gdpState === "At/near benchmark") reasons.push("GDP growth is at the potential-growth benchmark");
    if (gdpState === "Above potential" && !bothMonthlySupportive) reasons.push("monthly activity does not fully confirm GDP strength");
    if (gdpState === "Below potential" && !bothMonthlyWeak) reasons.push("monthly activity does not fully confirm GDP weakness");
    if (hadContradiction) reasons.push("medium-term trend horizons contain conflicting evidence");
    if (reasons.length === 0) reasons.push("evidence is mixed or otherwise does not match the Strong/Weak pattern");
    assessmentReason = `Does not fully match the Strong or Weak pattern: ${reasons.join("; ")}.`;
  }

  interpretations.push({
    label: "Overall Growth assessment rule (evidence-pattern matrix)",
    rule: "STRONG = GDP growth above the potential-growth benchmark AND Retail Sales 3-release trend rising AND Industrial Production 3-release trend rising AND no contradiction flagged. WEAK = GDP growth below the benchmark AND both 3-release monthly trends falling. MODERATE = everything else. No weighted score or majority vote is used.",
    result: `${assessment} — ${assessmentReason}`,
  });

  // ================= CONFIDENCE =================
  const gdpReleaseCount = gdpReal.length;
  const monthlyComputable = [retailState, indProdState].filter((state) => state !== null).length;
  let confidence: ConfidenceLevel;

  if (gdpReleaseCount === 0 && monthlyComputable === 0) {
    confidence = "Insufficient data";
  } else if (gdpReleaseCount < 2) {
    confidence = monthlyComputable > 0 ? "Low" : "Insufficient data";
    dataLimitations.push(
      `Confidence capped at Low: only ${gdpReleaseCount} GDP release(s) are stored; at least 2 GDP releases are required before confidence can exceed Low.`
    );
  } else {
    // Approved methodology caps Growth confidence at Medium until more GDP history exists.
    confidence = monthlyComputable === 2 ? "Medium" : "Low";
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
