/**
 * LAYER 6 — EMPLOYMENT ASSESSMENT ENGINE
 * Deterministic implementation of the approved employment methodology.
 */
import type {
  EmploymentAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

export interface EmploymentHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface EmploymentEngineInput {
  nfp: EmploymentHistoryRow[];
  unemploymentRate: EmploymentHistoryRow[];
  avgHourlyEarnings: EmploymentHistoryRow[];
  initialClaims: EmploymentHistoryRow[];
  continuingClaims: EmploymentHistoryRow[];
  jolts: EmploymentHistoryRow[];
  sahmRule: EmploymentHistoryRow[];
}

const WAGE_GROWTH_BENCHMARK_PCT = 3.5;
const SAHM_RECESSION_TRIGGER = 0.5;

function toSourceRef(row: EmploymentHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

function real(rows: EmploymentHistoryRow[]): EmploymentHistoryRow[] {
  return rows.filter((row) => row.actual !== null);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function average(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function pctChange(latest: number, past: number): number | null {
  return past === 0 ? null : round(((latest / past) - 1) * 100);
}

function levelChange(rows: EmploymentHistoryRow[], releasesBack: number): number | null {
  if (rows.length <= releasesBack) return null;
  const latest = rows[0].actual;
  const past = rows[releasesBack].actual;
  return latest === null || past === null ? null : round(latest - past);
}

export function generateEmploymentAssessment(input: EmploymentEngineInput): EmploymentAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "Labor Force Participation Rate, ADP, and ISM employment sub-index are not in the pipeline yet.",
    "NFP revisions are not tracked — the database stores the latest value per period, not pre-revision history, so a revision trend cannot be computed yet.",
  ];
  const signals: Record<string, "supportive" | "weak" | "neutral" | null> = {};

  const nfpRows = real(input.nfp);
  if (nfpRows.length) {
    const latest = nfpRows[0];
    facts.push({ label: "Nonfarm Payrolls (level, latest)", value: latest.actual, periodCovered: latest.period_covered, source: toSourceRef(latest) });
    const gains = nfpRows.filter((r) => r.previous !== null).map((r) => round((r.actual as number) - (r.previous as number)));
    const recentPace = gains.length >= 3 ? average(gains.slice(0, 3)) : null;
    const longerPace = gains.length >= 12 ? average(gains.slice(0, 12)) : null;
    calculations.push({ label: "NFP: monthly payroll gain (latest)", formula: "latest.actual - latest.previous", result: gains[0] ?? null });
    calculations.push({ label: "NFP: recent payroll pace (3-month average gain)", formula: "average of the last 3 monthly payroll gains", result: recentPace, unavailableReason: recentPace === null ? `Need at least 3 monthly gains; have ${gains.length}.` : undefined });
    calculations.push({ label: "NFP: longer-term payroll pace (12-month average gain)", formula: "average of the last 12 monthly payroll gains", result: longerPace, unavailableReason: longerPace === null ? `Need at least 12 monthly gains; have ${gains.length}.` : undefined });
    if (recentPace !== null && longerPace !== null) {
      const label = recentPace > longerPace ? "Recent pace above longer-term pace" : recentPace < longerPace ? "Recent pace below longer-term pace" : "Recent pace roughly in line with longer-term pace";
      interpretations.push({ label: "NFP: recent pace vs longer-term pace", rule: "Compares the 3-month average payroll gain with the 12-month average payroll gain; no absolute payroll threshold is used.", result: label });
      evidence.push(`NFP: 3-month avg gain = ${recentPace}K, 12-month avg gain = ${longerPace}K → ${label}.`);
      signals.nfp = recentPace > longerPace ? "supportive" : recentPace < longerPace ? "weak" : "neutral";
    } else {
      dataLimitations.push(`NFP pace comparison unavailable: have ${gains.length} monthly gain(s), need at least 12 for the full comparison.`);
      signals.nfp = null;
    }
  } else {
    dataLimitations.push("NFP: no releases stored yet.");
    signals.nfp = null;
  }

  const unemploymentRows = real(input.unemploymentRate);
  if (unemploymentRows.length) {
    const latest = unemploymentRows[0];
    facts.push({ label: "Unemployment Rate (latest)", value: latest.actual, unit: "%", periodCovered: latest.period_covered, source: toSourceRef(latest) });
    const mom = latest.previous === null ? null : round((latest.actual as number) - latest.previous);
    calculations.push({ label: "Unemployment Rate: month-over-month change", formula: "latest.actual - latest.previous", result: mom });
    const changes = [3, 6, 12].filter((h) => h < unemploymentRows.length).map((h) => ({ h, change: levelChange(unemploymentRows, h) }));
    for (const item of changes) calculations.push({ label: `Unemployment Rate: change vs ${item.h} releases ago`, formula: `latest.actual - value_${item.h}_releases_ago`, result: item.change });
    const medium = changes.find((x) => x.h === 3)?.change ?? null;
    const long = changes.find((x) => x.h === 12)?.change ?? null;
    const primary = medium ?? mom;
    if (primary !== null) {
      const label = primary < 0 ? "Falling" : primary > 0 ? "Rising" : "Flat";
      interpretations.push({ label: "Unemployment Rate: level and medium-term trend", rule: "Uses the 3-release trend where available; falls back to latest MoM only when the 3-release trend is unavailable.", result: `${latest.actual}% — ${label}` });
      evidence.push(`Unemployment Rate: ${latest.actual}%, ${label.toLowerCase()} on the primary medium-term basis (3-release change=${medium ?? "n/a"}pp, latest MoM=${mom ?? "n/a"}pp).`);
      signals.unemployment = primary < 0 ? "supportive" : primary > 0 ? "weak" : "neutral";
    } else {
      dataLimitations.push("Unemployment Rate trend unavailable: no computable change over any available horizon.");
      signals.unemployment = null;
    }
    if (mom !== null && medium !== null && Math.sign(mom) !== 0 && Math.sign(medium) !== 0 && Math.sign(mom) !== Math.sign(medium)) conflictingEvidence.push(`Unemployment Rate: latest MoM move (${mom}pp) conflicts with the 3-release trend (${medium}pp).`);
    if (medium !== null && long !== null && Math.sign(medium) !== 0 && Math.sign(long) !== 0 && Math.sign(medium) !== Math.sign(long)) conflictingEvidence.push(`Unemployment Rate: 3-release trend (${medium}pp) conflicts with the 12-release trend (${long}pp).`);
  } else {
    dataLimitations.push("Unemployment Rate: no releases stored yet.");
    signals.unemployment = null;
  }

  const claimsRows = real(input.initialClaims);
  if (claimsRows.length) {
    const latest = claimsRows[0];
    facts.push({ label: "Initial Jobless Claims (latest weekly reading)", value: latest.actual, periodCovered: latest.period_covered, source: toSourceRef(latest) });
    if (claimsRows.length >= 4) {
      const current = average(claimsRows.slice(0, 4).map((r) => r.actual as number));
      calculations.push({ label: "Initial Claims: 4-week moving average", formula: "average of the last 4 stored weekly readings", result: current });
      if (claimsRows.length >= 8) {
        const prior = average(claimsRows.slice(4, 8).map((r) => r.actual as number));
        calculations.push({ label: "Initial Claims: prior 4-week moving average", formula: "average of stored weekly readings 5 through 8 releases back", result: prior });
        const label = current! < prior! ? "Falling" : current! > prior! ? "Rising" : "Flat";
        interpretations.push({ label: "Initial Claims: 4-week average trend", rule: "Compares the current 4-week moving average with the prior 4-week moving average.", result: label });
        evidence.push(`Initial Claims 4-week avg: ${current} (current) vs ${prior} (prior) → ${label}.`);
        signals.claims = label === "Falling" ? "supportive" : label === "Rising" ? "weak" : "neutral";
      } else {
        dataLimitations.push(`Initial Claims trend unavailable: need 8 stored weekly readings, have ${claimsRows.length}.`);
        signals.claims = null;
      }
    } else {
      dataLimitations.push(`Initial Claims: only ${claimsRows.length} weekly reading(s) stored — 4-week average not yet computable.`);
      signals.claims = null;
    }
  } else {
    dataLimitations.push("Initial Jobless Claims: no releases stored yet.");
    signals.claims = null;
  }

  const continuingRows = real(input.continuingClaims);
  if (continuingRows.length) {
    const latest = continuingRows[0];
    facts.push({ label: "Continuing Claims (latest)", value: latest.actual, periodCovered: latest.period_covered, source: toSourceRef(latest) });
    const latestChange = latest.previous === null ? null : round((latest.actual as number) - latest.previous);
    const trend3 = levelChange(continuingRows, 3);
    calculations.push({ label: "Continuing Claims: change vs previous release", formula: "latest.actual - latest.previous", result: latestChange });
    calculations.push({ label: "Continuing Claims: change over last 3 releases", formula: "latest.actual - value_3_releases_ago", result: trend3, unavailableReason: trend3 === null ? `Need 4 stored releases; have ${continuingRows.length}.` : undefined });
    if (trend3 !== null) {
      const label = trend3 < 0 ? "Falling" : trend3 > 0 ? "Rising" : "Flat";
      interpretations.push({ label: "Continuing Claims: 3-release trend", rule: "Primary signal uses the 3-release trend; latest change is context only.", result: label });
      evidence.push(`Continuing Claims: 3-release trend = ${label.toLowerCase()} (${trend3}), latest change = ${latestChange ?? "n/a"}.`);
      signals.continuingClaims = trend3 < 0 ? "supportive" : trend3 > 0 ? "weak" : "neutral";
    } else signals.continuingClaims = null;
  } else {
    dataLimitations.push("Continuing Claims: no releases stored yet.");
    signals.continuingClaims = null;
  }

  const joltsRows = real(input.jolts);
  if (joltsRows.length) {
    const latest = joltsRows[0];
    facts.push({ label: "JOLTS Job Openings (latest)", value: latest.actual, periodCovered: latest.period_covered, source: toSourceRef(latest) });
    const latestChange = latest.previous === null ? null : round((latest.actual as number) - latest.previous);
    const trend3 = levelChange(joltsRows, 3);
    calculations.push({ label: "JOLTS: change vs previous release", formula: "latest.actual - latest.previous", result: latestChange });
    calculations.push({ label: "JOLTS: change over last 3 releases", formula: "latest.actual - value_3_releases_ago", result: trend3, unavailableReason: trend3 === null ? `Need 4 stored releases; have ${joltsRows.length}.` : undefined });
    if (trend3 !== null) {
      const label = trend3 > 0 ? "Rising" : trend3 < 0 ? "Falling" : "Flat";
      interpretations.push({ label: "JOLTS: 3-release trend", rule: "Uses the 3-release change as the primary JOLTS signal.", result: label });
      evidence.push(`JOLTS: 3-release trend = ${label.toLowerCase()} (${trend3}), latest change = ${latestChange ?? "n/a"}.`);
      signals.jolts = trend3 > 0 ? "supportive" : trend3 < 0 ? "weak" : "neutral";
    } else signals.jolts = null;
  } else {
    dataLimitations.push("JOLTS: no releases stored yet.");
    signals.jolts = null;
  }

  const wagesRows = real(input.avgHourlyEarnings);
  if (wagesRows.length) {
    const latest = wagesRows[0];
    facts.push({ label: "Average Hourly Earnings (latest)", value: latest.actual, unit: "$", periodCovered: latest.period_covered, source: toSourceRef(latest) });
    const yearAgo = wagesRows[12]?.actual ?? null;
    const yoy = yearAgo === null ? null : pctChange(latest.actual as number, yearAgo);
    calculations.push({ label: "Average Hourly Earnings: YoY % change", formula: "((latest.actual / value_12_releases_ago) - 1) * 100", result: yoy, unavailableReason: yoy === null ? `Need 13 stored releases; have ${wagesRows.length}.` : undefined });
    if (yoy !== null) {
      const label = yoy > WAGE_GROWTH_BENCHMARK_PCT ? "Above benchmark" : yoy < WAGE_GROWTH_BENCHMARK_PCT ? "Below benchmark" : "At benchmark";
      interpretations.push({ label: "Wages: YoY growth vs provisional benchmark", rule: `Provisional design benchmark: ${WAGE_GROWTH_BENCHMARK_PCT}% YoY; not an official Fed threshold.`, result: label, isProvisionalThreshold: true });
      evidence.push(`Average Hourly Earnings YoY = ${yoy}% → ${label}.`);
      signals.wages = yoy > WAGE_GROWTH_BENCHMARK_PCT ? "supportive" : yoy < WAGE_GROWTH_BENCHMARK_PCT ? "weak" : "neutral";
    } else signals.wages = null;
  } else {
    dataLimitations.push("Average Hourly Earnings: no releases stored yet.");
    signals.wages = null;
  }

  const sahmRows = real(input.sahmRule);
  const sahmTriggered = sahmRows.length > 0 && (sahmRows[0].actual as number) >= SAHM_RECESSION_TRIGGER;
  if (sahmRows.length) {
    const latest = sahmRows[0];
    facts.push({ label: "Sahm Rule indicator (latest)", value: latest.actual, unit: "pp", periodCovered: latest.period_covered, source: toSourceRef(latest) });
    interpretations.push({ label: "Sahm Rule: recession/stress signal", rule: `Sahm Rule trigger is ≥ ${SAHM_RECESSION_TRIGGER}pp. It is supporting stress evidence, not a standalone override.`, result: sahmTriggered ? "Recession-level stress signaled" : "Below recession-signal threshold" });
  } else {
    dataLimitations.push("Sahm Rule is not yet wired into the authoritative data-acquisition pipeline; this evidence input is unavailable, not fabricated.");
  }

  const nfpState = signals.nfp;
  const uState = signals.unemployment;
  const claimsState = signals.claims;
  const contState = signals.continuingClaims;
  const joltsState = signals.jolts;
  const wagesState = signals.wages;
  const coreComputable = nfpState !== null && uState !== null && claimsState !== null && contState !== null && joltsState !== null;
  const supportiveOrNeutral = (s: "supportive" | "weak" | "neutral" | null) => s === "supportive" || s === "neutral";
  const strong = coreComputable && nfpState === "supportive" && supportiveOrNeutral(uState) && supportiveOrNeutral(claimsState) && supportiveOrNeutral(contState) && supportiveOrNeutral(joltsState) && wagesState === "supportive" && !sahmTriggered && conflictingEvidence.length === 0;
  const weakBroad = nfpState === "weak" && uState === "weak" && joltsState === "weak" && (claimsState === "weak" || contState === "weak");
  const weakStress = sahmTriggered && (nfpState === "weak" || uState === "weak");

  let assessment: EmploymentAssessment["assessment"];
  let reason: string;
  if (strong) {
    assessment = "Strong";
    reason = "Strong pattern matched: payroll pace, unemployment, claims, continuing claims, JOLTS, and wages are supportive or stable as specified, with no Sahm stress or major contradiction.";
  } else if (weakBroad) {
    assessment = "Weak";
    reason = "Weak broad-deterioration pattern matched: NFP, unemployment, and JOLTS are weak with deterioration in at least one claims series.";
  } else if (weakStress) {
    assessment = "Weak";
    reason = "Weak stress-combination pattern matched: Sahm stress is paired with NFP or unemployment deterioration.";
  } else {
    assessment = "Moderate";
    const reasons: string[] = [];
    if (!coreComputable) reasons.push("not all core employment signals are computable");
    if (conflictingEvidence.length) reasons.push("conflicting evidence is present");
    if (sahmTriggered) reasons.push("Sahm stress is present without the full Weak stress pattern");
    if (!reasons.length) reasons.push("evidence is mixed and no named Strong or Weak pattern is fully matched");
    reason = `Moderate because ${reasons.join("; ")}.`;
  }

  interpretations.push({
    label: "Overall Employment assessment rule (evidence-pattern matrix)",
    rule: "Strong requires the full named supportive/stable combination; Weak requires either broad deterioration or Sahm stress paired with NFP/unemployment deterioration; all other cases are Moderate. No weighted score or vote count is used.",
    result: `${assessment} — ${reason}`,
  });
  if (wagesState) evidence.push(`Wages: ${wagesState} versus the provisional benchmark.`);
  if (sahmTriggered) conflictingEvidence.push("Sahm Rule has crossed its recession-signal threshold; it does not independently set the assessment.");

  const requiredDepths = [nfpRows.length, unemploymentRows.length, wagesRows.length, claimsRows.length, continuingRows.length, joltsRows.length];
  const minimumDepth = Math.min(...requiredDepths);
  const fullHistory = nfpRows.length >= 13 && unemploymentRows.length >= 13 && wagesRows.length >= 13 && claimsRows.length >= 8 && continuingRows.length >= 4 && joltsRows.length >= 4;
  let confidence: ConfidenceLevel;
  if (minimumDepth < 3) confidence = "Insufficient data";
  else if (fullHistory && conflictingEvidence.length === 0 && coreComputable) confidence = "High";
  else confidence = "Medium";

  return { category: "Employment", asOf, facts, calculations, interpretations, assessment, confidence, evidence, conflictingEvidence, dataLimitations };
}
