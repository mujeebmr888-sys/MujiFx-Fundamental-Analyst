/**
 * LAYER 6 — INFLATION ASSESSMENT ENGINE
 * Deterministic implementation of the approved inflation methodology.
 * No AI, network calls, database access, or invented data.
 */
import type {
  InflationAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

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

const FED_TARGET_YOY_PCT = 2.0;
const TARGET_BAND_PP = 0.5; // provisional/configurable design threshold

type MomentumPattern = "short_term_stronger" | "short_term_weaker" | "mixed" | "insufficient";

function toSourceRef(row: InflationHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

function realRows(rows: InflationHistoryRow[]): InflationHistoryRow[] {
  return rows.filter((row) => row.actual !== null);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function annualizedChange(latest: number, past: number, monthsBack: number): number | null {
  if (past === 0) return null;
  return round(((latest / past) ** (12 / monthsBack) - 1) * 100);
}

function momentumPattern(three: number | null, six: number | null, yoy: number | null): MomentumPattern {
  if (three === null || six === null || yoy === null) return "insufficient";
  if (three > six && six > yoy) return "short_term_stronger";
  if (three < six && six < yoy) return "short_term_weaker";
  return "mixed";
}

function buildMomentum(rows: InflationHistoryRow[], label: string) {
  const real = realRows(rows);
  const latest = real[0];
  const calculations: AssessmentCalculation[] = [];

  const mom = latest?.actual !== null && latest?.actual !== undefined && latest.previous !== null && latest.previous !== 0
    ? round(((latest.actual / latest.previous) - 1) * 100)
    : null;
  calculations.push({
    label: `${label}: month-over-month % change`,
    formula: "((latest.actual / latest.previous) - 1) * 100",
    result: mom,
    unavailableReason: mom === null ? "Latest release or previous value unavailable." : undefined,
  });

  const three = latest?.actual !== null && latest?.actual !== undefined && real[3]?.actual !== null && real[3]?.actual !== undefined
    ? annualizedChange(latest.actual, real[3].actual, 3)
    : null;
  const six = latest?.actual !== null && latest?.actual !== undefined && real[6]?.actual !== null && real[6]?.actual !== undefined
    ? annualizedChange(latest.actual, real[6].actual, 6)
    : null;
  const yoy = latest?.actual !== null && latest?.actual !== undefined && real[12]?.actual !== null && real[12]?.actual !== undefined
    ? annualizedChange(latest.actual, real[12].actual, 12)
    : null;

  for (const item of [
    ["3-month annualized momentum", 3, three],
    ["6-month annualized momentum", 6, six],
    ["YoY change", 12, yoy],
  ] as const) {
    calculations.push({
      label: `${label}: ${item[0]}`,
      formula: `((latest / value_${item[1]}mo_ago) ^ (12/${item[1]}) - 1) * 100`,
      result: item[2],
      unavailableReason: item[2] === null ? `Need at least ${item[1] + 1} stored releases; have ${real.length}.` : undefined,
    });
  }

  return { real, latest, mom, three, six, yoy, pattern: momentumPattern(three, six, yoy), calculations };
}

export function generateInflationAssessment(input: InflationEngineInput): InflationAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "No inflation-expectations series is integrated yet.",
    "Services/shelter persistence is unavailable without component-level data.",
    "True component-level inflation breadth is unavailable; headline-vs-core comparison is not substituted for it.",
    "The approved methodology requires persistence to support a Strong/Weak assessment but does not specify a fixed release-count threshold for persistence, so persistence is reported as evidence rather than converted into an invented threshold.",
  ];

  const series = [
    { key: "cpi", label: "CPI", rows: input.cpi },
    { key: "coreCpi", label: "Core CPI", rows: input.coreCpi },
    { key: "pce", label: "PCE", rows: input.pce },
    { key: "corePce", label: "Core PCE", rows: input.corePce },
    { key: "ppi", label: "PPI", rows: input.ppi },
  ] as const;

  const m: Record<string, ReturnType<typeof buildMomentum>> = {};

  for (const item of series) {
    const built = buildMomentum(item.rows, item.label);
    m[item.key] = built;
    if (!built.latest) {
      dataLimitations.push(`${item.label}: no real releases stored yet.`);
      continue;
    }
    facts.push({ label: `${item.label} (latest)`, value: built.latest.actual, periodCovered: built.latest.period_covered, source: toSourceRef(built.latest) });
    if (built.latest.previous !== null) {
      facts.push({ label: `${item.label} (previous)`, value: built.latest.previous, source: toSourceRef(built.latest) });
    }
    calculations.push(...built.calculations);
  }

  const corePceYoy = m.corePce?.yoy ?? null;
  let level: "Elevated" | "Near target" | "Below target" | "Insufficient data" = "Insufficient data";
  if (corePceYoy !== null) {
    const distance = round(corePceYoy - FED_TARGET_YOY_PCT);
    calculations.push({ label: "Distance from Fed target (Core PCE YoY - 2.0%)", formula: "Core PCE YoY - 2.0", result: distance });
    level = corePceYoy > FED_TARGET_YOY_PCT + TARGET_BAND_PP
      ? "Elevated"
      : corePceYoy < FED_TARGET_YOY_PCT - TARGET_BAND_PP
        ? "Below target"
        : "Near target";
    interpretations.push({
      label: "Core PCE distance from target",
      rule: `Elevated if Core PCE YoY > ${FED_TARGET_YOY_PCT + TARGET_BAND_PP}%; Below target if < ${FED_TARGET_YOY_PCT - TARGET_BAND_PP}%; otherwise Near target. The ±${TARGET_BAND_PP}pp band is provisional/configurable, not an official Fed tolerance band.`,
      result: level,
      isProvisionalThreshold: true,
    });
    evidence.push(`Core PCE YoY = ${corePceYoy}% → ${level} vs the ${FED_TARGET_YOY_PCT}% target.`);
  } else {
    dataLimitations.push("Core PCE YoY requires at least 13 real monthly releases and is currently unavailable.");
  }

  const cpi3 = m.cpi?.three ?? null;
  const cpi6 = m.cpi?.six ?? null;
  const cpiYoy = m.cpi?.yoy ?? null;
  const cpiPattern = m.cpi?.pattern ?? "insufficient";
  if (cpiPattern !== "insufficient") {
    const label = cpiPattern === "short_term_stronger"
      ? "Short-term momentum stronger than medium-term and YoY"
      : cpiPattern === "short_term_weaker"
        ? "Short-term momentum weaker than medium-term and YoY"
        : "Mixed/stable across horizons";
    interpretations.push({
      label: "CPI momentum direction",
      rule: "Compare 3-month annualized momentum with 6-month annualized momentum and YoY; this is a horizon comparison, not a second-derivative acceleration calculation.",
      result: label,
    });
    evidence.push(`CPI momentum: 3mo=${cpi3}%, 6mo=${cpi6}%, YoY=${cpiYoy}% → ${label}.`);
  }

  // Persistence is exposed, but no arbitrary persistence threshold is invented.
  const cpiReal = m.cpi?.real ?? [];
  const cpiPositiveMomStreak = (() => {
    let count = 0;
    for (const row of cpiReal) {
      if (row.previous === null || row.actual === null) break;
      if (row.actual > row.previous) count++;
      else break;
    }
    return count;
  })();
  calculations.push({
    label: "CPI: consecutive positive MoM releases",
    formula: "Count consecutive most-recent CPI releases where actual > previous",
    result: cpiPositiveMomStreak,
  });
  if (cpiPositiveMomStreak > 0) {
    evidence.push(`CPI has ${cpiPositiveMomStreak} consecutive positive month-over-month index moves; this is persistence evidence, not an acceleration measure.`);
  }

  const ppi3 = m.ppi?.three ?? null;
  if (cpi3 !== null && ppi3 !== null && Math.sign(cpi3) !== Math.sign(ppi3)) {
    conflictingEvidence.push(`CPI 3-month annualized momentum (${cpi3}%) and PPI 3-month annualized momentum (${ppi3}%) point in different directions.`);
  }

  // Assessment follows only explicit approved level + momentum rules.
  // Because persistence has no approved numeric threshold, mixed momentum
  // cannot be upgraded to Strong merely because the level is elevated.
  let assessment: InflationAssessment["assessment"] = "Moderate";
  if (level !== "Insufficient data" && cpiPattern !== "insufficient") {
    if (level === "Elevated" && cpiPattern === "short_term_stronger") assessment = "Strong";
    else if (level === "Below target" && cpiPattern === "short_term_weaker") assessment = "Weak";
  }

  const cpiHistory = m.cpi?.real.length ?? 0;
  const corePceHistory = m.corePce?.real.length ?? 0;
  const full12Month = cpiHistory >= 13 && corePceHistory >= 13;
  const cpiDirection = cpiPattern;
  const corePceDirection = m.corePce?.pattern ?? "insufficient";
  const sameDirection = cpiDirection !== "insufficient" && cpiDirection === corePceDirection;

  let confidence: ConfidenceLevel;
  if (cpiHistory < 3 || corePceHistory < 3) confidence = "Insufficient data";
  else if (full12Month && sameDirection) confidence = "High";
  else confidence = "Medium";

  interpretations.push({
    label: "Overall Inflation assessment rule",
    rule: "Strong = elevated Core PCE level plus CPI momentum running stronger across horizons; Weak = below-target Core PCE plus CPI momentum running weaker; Moderate = near-target or mixed/disagreeing evidence. Persistence is shown but not given an invented numeric threshold.",
    result: assessment,
  });
  interpretations.push({
    label: "Inflation confidence rule",
    rule: "High requires full 12-month CPI and Core PCE history with both momentum classifications pointing the same way; Medium applies to sufficient 3–6 month evidence or disagreement; Insufficient data applies when fewer than 3 releases exist for a relevant series.",
    result: confidence,
  });

  if (full12Month && sameDirection) evidence.push(`CPI and Core PCE have full 12-month history and the same momentum classification (${cpiDirection}).`);
  else if (full12Month) conflictingEvidence.push(`CPI momentum classification (${cpiDirection}) and Core PCE momentum classification (${corePceDirection}) do not both point the same way for High-confidence confirmation.`);

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
