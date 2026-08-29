/**
 * LAYER 6 — INFLATION ASSESSMENT ENGINE
 *
 * Implements the Inflation section of docs/methodology_fundamental_scoring.md
 * EXACTLY. Deterministic only — no AI, no invented indicators, no new data
 * sources. Every threshold used is a named, provisional constant (never
 * described as economic fact). Pure function: takes already-fetched
 * history rows as input (same pattern as forecast-engine/forecast.ts) so
 * this file has no direct database or network dependency.
 */

import type {
  InflationAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

/** Minimal shape this engine needs from a stored release row (newest-first arrays, matching getIndicatorHistory's ordering). */
export interface InflationHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface InflationEngineInput {
  cpi: InflationHistoryRow[];
  coreCpi: InflationHistoryRow[];
  pce: InflationHistoryRow[];
  corePce: InflationHistoryRow[];
  ppi: InflationHistoryRow[];
}

/**
 * PROVISIONAL, CONFIGURABLE DESIGN THRESHOLDS.
 * These are NOT economic facts — they are documented starting points this
 * engine uses until you choose to tune them. See methodology doc, Section 1.
 */
const FED_TARGET_YOY_PCT = 2.0; // Fed's officially stated target, on Core PCE
const TARGET_BAND_PP = 0.5; // provisional tolerance band around the target

function toSourceRef(row: InflationHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

/** Only real releases — defensively excludes forecast placeholder rows (actual: null) that can share this table. */
function realReleasesOnly(rows: InflationHistoryRow[]): InflationHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

/**
 * General annualized-change formula, used for 3-month, 6-month, and YoY
 * momentum alike (YoY is just this formula with monthsBack = 12, which
 * collapses to the plain percentage change — no extra annualization is
 * applied on top of it).
 * Formula: ((latest / valueMonthsBackAgo) ^ (12 / monthsBack) - 1) * 100
 */
function annualizedChange(
  latest: number,
  past: number,
  monthsBack: number
): number | null {
  if (past === 0) return null;
  return round(((latest / past) ** (12 / monthsBack) - 1) * 100);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Counts how many of the most recent releases have moved in the SAME
 * direction (sign) as the latest one. This is a SIGN-ONLY streak — e.g.
 * three consecutive readings of +0.5%, +0.4%, +0.3% count as a streak of
 * 3, even though inflation is clearly decelerating in that example. This
 * function must NEVER be treated as evidence of accelerating or
 * persistent inflation on its own — it only reports "how many releases in
 * a row have been the same sign," nothing more.
 */
function consecutiveMomDirection(rows: InflationHistoryRow[]): number {
  const changes: number[] = [];
  for (const row of rows) {
    if (row.actual !== null && row.previous !== null) {
      changes.push(row.actual - row.previous);
    }
  }
  if (changes.length === 0) return 0;
  const latestSign = Math.sign(changes[0]);
  if (latestSign === 0) return 1;
  let streak = 0;
  for (const c of changes) {
    if (Math.sign(c) === latestSign) streak++;
    else break;
  }
  return streak;
}

/** Builds the momentum calculations (MoM, 3mo/6mo annualized, YoY) for one series, from its own history. Returns null results with a reason where history is too short — never fabricated. */
function buildSeriesMomentum(rows: InflationHistoryRow[], label: string) {
  const real = realReleasesOnly(rows);
  const calcs: AssessmentCalculation[] = [];

  const latest = real[0];

  // MoM: uses the stored `previous` field directly on the latest row.
  const mom =
    latest && latest.actual !== null && latest.previous !== null
      ? round(latest.actual - latest.previous)
      : null;
  calcs.push({
    label: `${label}: month-over-month change`,
    formula: "latest.actual - latest.previous",
    result: mom,
    unavailableReason: mom === null ? "Latest release or its previous value not available." : undefined,
  });

  const monthsBackOptions: Array<{ key: string; months: number }> = [
    { key: "3-month annualized momentum", months: 3 },
    { key: "6-month annualized momentum", months: 6 },
    { key: "YoY change", months: 12 },
  ];

  const results: Record<string, number | null> = {};

  for (const { key, months } of monthsBackOptions) {
    const pastRow = real[months]; // index `months` back from latest (index 0)
    const value =
      latest && pastRow && latest.actual !== null && pastRow.actual !== null
        ? annualizedChange(latest.actual, pastRow.actual, months)
        : null;
    results[key] = value;
    calcs.push({
      label: `${label}: ${key}`,
      formula: `((latest / value_${months}mo_ago) ^ (12/${months}) - 1) * 100`,
      result: value,
      unavailableReason:
        value === null
          ? `Need at least ${months + 1} stored releases; have ${real.length}.`
          : undefined,
    });
  }

  const streak = consecutiveMomDirection(real);
  calcs.push({
    label: `${label}: consecutive MoM direction (sign only)`,
    formula: "Count of most recent consecutive releases with the same sign of MoM change as the latest release",
    result: streak,
    unavailableReason: streak === 0 ? "Not enough releases to determine direction." : undefined,
  });

  return { calcs, mom, threeMoAnn: results["3-month annualized momentum"], sixMoAnn: results["6-month annualized momentum"], yoy: results["YoY change"], streak, latest };
}

export function generateInflationAssessment(
  input: InflationEngineInput
): InflationAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "No inflation-expectations series (e.g. breakeven rates) is integrated yet.",
    "Services/shelter persistence is not available without component-level data.",
  ];

  const seriesList: Array<{ key: string; label: string; rows: InflationHistoryRow[] }> = [
    { key: "cpi", label: "CPI", rows: input.cpi },
    { key: "coreCpi", label: "Core CPI", rows: input.coreCpi },
    { key: "pce", label: "PCE", rows: input.pce },
    { key: "corePce", label: "Core PCE", rows: input.corePce },
    { key: "ppi", label: "PPI", rows: input.ppi },
  ];

  const momentumBySeries: Record<string, ReturnType<typeof buildSeriesMomentum>> = {};

  for (const s of seriesList) {
    const real = realReleasesOnly(s.rows);
    if (real.length === 0) {
      dataLimitations.push(`${s.label}: no releases stored yet.`);
      continue;
    }
    const latest = real[0];
    facts.push({
      label: `${s.label} (latest)`,
      value: latest.actual,
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });
    if (latest.previous !== null) {
      facts.push({
        label: `${s.label} (previous release)`,
        value: latest.previous,
        source: toSourceRef(latest),
      });
    }

    const momentum = buildSeriesMomentum(s.rows, s.label);
    momentumBySeries[s.key] = momentum;
    calculations.push(...momentum.calcs);

    if (real.length < 3) {
      dataLimitations.push(
        `${s.label}: only ${real.length} release(s) stored — momentum not yet computable.`
      );
    }
  }

  // --- Distance from target (Core PCE YoY vs the provisional band) ---
  const corePceYoy = momentumBySeries["corePce"]?.yoy ?? null;
  let levelLabel = "Insufficient data";
  if (corePceYoy !== null) {
    const distance = round(corePceYoy - FED_TARGET_YOY_PCT);
    calculations.push({
      label: "Distance from Fed target (Core PCE YoY - 2.0%)",
      formula: "Core PCE YoY - 2.0",
      result: distance,
    });
    if (corePceYoy > FED_TARGET_YOY_PCT + TARGET_BAND_PP) levelLabel = "Elevated";
    else if (corePceYoy < FED_TARGET_YOY_PCT - TARGET_BAND_PP) levelLabel = "Below target";
    else levelLabel = "Near target";

    interpretations.push({
      label: "Level (distance from target)",
      rule: `Provisional band: Elevated if Core PCE YoY > ${FED_TARGET_YOY_PCT + TARGET_BAND_PP}%, Below target if < ${FED_TARGET_YOY_PCT - TARGET_BAND_PP}%, else Near target. This ±${TARGET_BAND_PP}pp band is a configurable design choice, not an official Fed rule.`,
      result: levelLabel,
      isProvisionalThreshold: true,
    });
    evidence.push(`Core PCE YoY = ${corePceYoy}% → ${levelLabel} vs the ${FED_TARGET_YOY_PCT}% target (±${TARGET_BAND_PP}pp provisional band).`);
  } else {
    dataLimitations.push("Distance-from-target unavailable: Core PCE YoY requires 13 stored releases, not yet available.");
  }

  // --- Momentum comparison across horizons (using CPI, the more timely monthly series) ---
  // NOTE: this compares 3mo-annualized vs 6mo-annualized vs YoY readings —
  // it is NOT a calculated rate of acceleration (that would require a
  // second-derivative-style computation we don't perform here). Labeled
  // descriptively rather than as "Accelerating"/"Decelerating" to avoid
  // overclaiming what the comparison actually measures.
  const cpi3mo = momentumBySeries["cpi"]?.threeMoAnn ?? null;
  const cpi6mo = momentumBySeries["cpi"]?.sixMoAnn ?? null;
  const cpiYoy = momentumBySeries["cpi"]?.yoy ?? null;
  let momentumPattern: "short_term_stronger" | "short_term_weaker" | "mixed" | "insufficient" = "insufficient";
  let momentumLabel = "Insufficient data";
  if (cpi3mo !== null && cpi6mo !== null && cpiYoy !== null) {
    if (cpi3mo > cpi6mo && cpi6mo > cpiYoy) {
      momentumPattern = "short_term_stronger";
      momentumLabel = "Short-term momentum stronger than medium-term and YoY";
    } else if (cpi3mo < cpi6mo && cpi6mo < cpiYoy) {
      momentumPattern = "short_term_weaker";
      momentumLabel = "Short-term momentum weaker than medium-term and YoY";
    } else {
      momentumPattern = "mixed";
      momentumLabel = "Mixed/Stable across horizons";
    }

    interpretations.push({
      label: "Momentum comparison across horizons (CPI)",
      rule: "Compares 3-month annualized vs 6-month annualized vs YoY readings. This shows which horizon is currently running hottest/coolest — it is a horizon comparison, not a calculated acceleration rate.",
      result: momentumLabel,
    });
    evidence.push(`CPI horizon comparison: 3mo=${cpi3mo}%, 6mo=${cpi6mo}%, YoY=${cpiYoy}% → ${momentumLabel}.`);
  } else {
    dataLimitations.push("Momentum comparison unavailable: CPI needs at least 13 stored releases to compute 3mo/6mo/YoY together.");
  }

  // --- Consecutive MoM direction (CPI) — sign-only, explicitly NOT evidence of accelerating/decelerating inflation ---
  const cpiStreak = momentumBySeries["cpi"]?.streak ?? 0;
  if (cpiStreak > 0) {
    interpretations.push({
      label: "Consecutive MoM direction (CPI)",
      rule: "Number of consecutive most-recent releases with the same SIGN of month-over-month change as the latest release. This is a sign-only count — e.g. three consecutive positive-but-shrinking readings (+0.5%, +0.4%, +0.3%) would count as a streak of 3 even though inflation is decelerating. NOT used as evidence of accelerating or persistent inflation.",
      result: `${cpiStreak} consecutive release(s) with the same MoM sign`,
    });
  }

  // --- Component-level breadth: not available yet, not approximated ---
  dataLimitations.push("Component-level inflation breadth unavailable.");
  const coreCpiYoy = momentumBySeries["coreCpi"]?.yoy ?? null; // still used below for confidence cross-check only, NOT for breadth

  // --- Conflicting evidence: CPI vs PPI momentum direction ---
  const ppi3mo = momentumBySeries["ppi"]?.threeMoAnn ?? null;
  if (cpi3mo !== null && ppi3mo !== null && Math.sign(cpi3mo) !== Math.sign(ppi3mo)) {
    conflictingEvidence.push(
      `CPI 3-month annualized momentum (${cpi3mo}%) and PPI 3-month annualized momentum (${ppi3mo}%) point in different directions — PPI is a leading indicator for future consumer prices, so this divergence is worth monitoring rather than resolving mechanically.`
    );
  }

  // --- Final ASSESSMENT: level and momentum-comparison weighed together.
  // NOTE: consecutive-MoM-direction (streak) is intentionally NOT used
  // here — it is a sign-only count, not a valid measure of accelerating
  // or persistent inflation, per the correction above. ---
  let assessment: InflationAssessment["assessment"] = "Moderate";
  let confidence: ConfidenceLevel = "Insufficient data";

  if (levelLabel !== "Insufficient data" && momentumPattern !== "insufficient") {
    const shortTermStrongerOrElevatedStable =
      momentumPattern === "short_term_stronger" ||
      (momentumPattern === "mixed" && levelLabel === "Elevated");
    const shortTermWeaker = momentumPattern === "short_term_weaker";

    if (levelLabel === "Elevated" && shortTermStrongerOrElevatedStable) {
      assessment = "Strong";
    } else if (levelLabel === "Below target" && shortTermWeaker) {
      assessment = "Weak";
    } else {
      assessment = "Moderate";
    }

    const bothTwelveMonths =
      realReleasesOnly(input.cpi).length >= 13 && realReleasesOnly(input.corePce).length >= 13;
    const seriesAgree = coreCpiYoy !== null && cpiYoy !== null && Math.sign(coreCpiYoy) === Math.sign(cpiYoy);

    if (bothTwelveMonths && seriesAgree) confidence = "High";
    else if (realReleasesOnly(input.cpi).length >= 3) confidence = "Medium";
    else confidence = "Insufficient data";

    interpretations.push({
      label: "Overall Inflation assessment rule",
      rule: 'Strong = Elevated level AND short-term momentum stronger than medium-term/YoY (or mixed while already elevated). Weak = Below-target level AND short-term momentum weaker than medium-term/YoY. Moderate = near target, or level/momentum comparison disagree. Consecutive-MoM-direction is informational only and does not drive this rule.',
      result: assessment,
    });
  } else {
    dataLimitations.push(
      "Overall Inflation assessment is 'Insufficient data' pending confidence: level and/or momentum comparison could not both be computed yet."
    );
  }

  return {
    category: "Inflation",
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
