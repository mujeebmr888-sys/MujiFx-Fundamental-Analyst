/**
 * LAYER 6 — EMPLOYMENT ASSESSMENT ENGINE
 *
 * Implements the Employment section of docs/methodology_fundamental_scoring.md
 * EXACTLY. Deterministic only — no AI, no invented indicators, no new data
 * sources. Pure function: takes already-fetched history rows as input (same
 * pattern as inflation.ts / forecast-engine/forecast.ts) so this file has
 * no direct database or network dependency.
 *
 * NOTE ON SAHM_RULE: the IndicatorId "SAHM_RULE" already exists in the type
 * system, but FRED's SAHMREALTIME series is NOT YET wired into the
 * data-acquisition layer (that would be a data-pipeline change, out of
 * scope for this step). This engine accepts a `sahmRule` history array so
 * it's ready the moment that series is added, but today it will correctly
 * report "not yet integrated" rather than pretending data exists.
 */

import type {
  EmploymentAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

/** Minimal shape this engine needs from a stored release row (newest-first arrays, matching getIndicatorHistory's ordering). */
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
  /** Not yet wired into the data pipeline — pass [] until FRED SAHMREALTIME is added. */
  sahmRule: EmploymentHistoryRow[];
}

/**
 * PROVISIONAL, CONFIGURABLE DESIGN THRESHOLD.
 * NOT an official Fed number — derived from a commonly cited analyst rule
 * of thumb (2% inflation target + ~1.5% long-run productivity growth).
 * See methodology doc, Section 2.
 */
const WAGE_GROWTH_BENCHMARK_PCT = 3.5;

/**
 * This IS the Sahm Rule's own official defining trigger (not a threshold
 * we invented) — FRED/Claudia Sahm define the recession signal as the
 * indicator crossing 0.50 percentage points.
 */
const SAHM_RECESSION_TRIGGER = 0.5;

function toSourceRef(row: EmploymentHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

/** Only real releases — defensively excludes forecast placeholder rows (actual: null) that can share this table. */
function realReleasesOnly(rows: EmploymentHistoryRow[]): EmploymentHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/** YoY-style percentage change, same general formula used in inflation.ts, reproduced locally to keep this engine independent. */
function pctChange(latest: number, past: number): number | null {
  if (past === 0) return null;
  return round(((latest / past) - 1) * 100);
}

/** Simple level trend over `releasesBack` releases: current level minus the level that many releases ago. Requires that many real releases — never invents missing observations. */
function levelChangeOver(rows: EmploymentHistoryRow[], releasesBack: number): number | null {
  if (rows.length <= releasesBack) return null;
  const latest = rows[0].actual;
  const past = rows[releasesBack].actual;
  if (latest === null || past === null) return null;
  return round(latest - past);
}

export function generateEmploymentAssessment(
  input: EmploymentEngineInput
): EmploymentAssessment {
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

  // Signals tally used ONLY at the end to weigh evidence together — never
  // a numeric weighted score. "neutral" = computed but flat/stable (a real
  // reading, not missing data). "null" = not yet computable (insufficient
  // data) — the two are kept strictly distinct.
  const signals: Record<string, "supportive" | "weak" | "neutral" | null> = {};

  // ===================== 1. NFP =====================
  const nfpReal = realReleasesOnly(input.nfp);
  if (nfpReal.length > 0) {
    const latest = nfpReal[0];
    facts.push({
      label: "Nonfarm Payrolls (level, latest)",
      value: latest.actual,
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });

    // Monthly payroll gain per release = that release's own actual - previous
    // (each stored row already carries its own prior-period value).
    const gains = nfpReal
      .filter((r) => r.actual !== null && r.previous !== null)
      .map((r) => round((r.actual as number) - (r.previous as number)));

    calculations.push({
      label: "NFP: monthly payroll gain (latest)",
      formula: "latest.actual - latest.previous",
      result: gains[0] ?? null,
    });

    const recentPace = gains.length >= 3 ? average(gains.slice(0, 3)) : null;
    const longerTermPace = gains.length >= 12 ? average(gains.slice(0, 12)) : null;

    calculations.push({
      label: "NFP: recent payroll pace (3-month average gain)",
      formula: "average of the last 3 monthly payroll gains",
      result: recentPace,
      unavailableReason: recentPace === null ? `Need at least 3 monthly gains; have ${gains.length}.` : undefined,
    });
    calculations.push({
      label: "NFP: longer-term payroll pace (12-month average gain)",
      formula: "average of the last 12 monthly payroll gains",
      result: longerTermPace,
      unavailableReason: longerTermPace === null ? `Need at least 12 monthly gains; have ${gains.length}.` : undefined,
    });

    if (recentPace !== null && longerTermPace !== null) {
      const paceLabel =
        recentPace > longerTermPace
          ? "Recent pace above longer-term pace"
          : recentPace < longerTermPace
          ? "Recent pace below longer-term pace"
          : "Recent pace roughly in line with longer-term pace";
      interpretations.push({
        label: "NFP: recent pace vs longer-term pace",
        rule: "Compares the average monthly payroll gain over the last 3 releases to the average over the last 12 releases. This is a relative trend-of-trend comparison, NOT a calculated acceleration rate, and does NOT use an absolute 'X thousand jobs = strong' threshold.",
        result: paceLabel,
      });
      evidence.push(`NFP: 3-month avg gain = ${recentPace}K, 12-month avg gain = ${longerTermPace}K → ${paceLabel}.`);
      signals.nfp = recentPace > longerTermPace ? "supportive" : recentPace < longerTermPace ? "weak" : null;
    } else {
      dataLimitations.push(`NFP pace comparison unavailable: have ${gains.length} monthly gain(s), need at least 12 for the full comparison.`);
      signals.nfp = null;
    }
  } else {
    dataLimitations.push("NFP: no releases stored yet.");
    signals.nfp = null;
  }

  // ===================== 2. Unemployment Rate =====================
  const uRateReal = realReleasesOnly(input.unemploymentRate);
  if (uRateReal.length > 0) {
    const latest = uRateReal[0];
    facts.push({
      label: "Unemployment Rate (latest)",
      value: latest.actual,
      unit: "%",
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });

    const mom =
      latest.actual !== null && latest.previous !== null ? round(latest.actual - latest.previous) : null;
    calculations.push({
      label: "Unemployment Rate: month-over-month change",
      formula: "latest.actual - latest.previous",
      result: mom,
    });

    // Trend over whatever history is available (up to 12 releases back).
    const horizonsAvailable = [3, 6, 12].filter((h) => uRateReal[h]?.actual !== null);
    const trendReadings = horizonsAvailable.map((h) => ({
      months: h,
      change: round((latest.actual as number) - (uRateReal[h].actual as number)),
    }));
    trendReadings.forEach((t) => {
      calculations.push({
        label: `Unemployment Rate: change vs ${t.months} releases ago`,
        formula: `latest.actual - value_${t.months}_releases_ago`,
        result: t.change,
      });
    });

    const shortTerm = mom;
    const mediumTerm = trendReadings.find((t) => t.months === 3)?.change ?? null;
    const longTerm = trendReadings.find((t) => t.months === 12)?.change ?? null;

    // Primary signal uses the medium-term (3-release) trend where available,
    // specifically so a single noisy monthly print doesn't drive the signal
    // on its own — falls back to the MoM change only if 3-release history
    // isn't available yet.
    const primaryChange = mediumTerm ?? shortTerm;

    if (primaryChange !== null) {
      const trendLabel = primaryChange < 0 ? "Falling" : primaryChange > 0 ? "Rising" : "Flat";
      interpretations.push({
        label: "Unemployment Rate: level and medium-term trend",
        rule: "Primary signal uses the 3-release trend where available (falling back to the latest month-over-month change only if 3-release history isn't available yet) — this avoids a single noisy monthly print driving the signal by itself. Longer 6/12-release readings are shown as additional calculations for context.",
        result: `${latest.actual}% — ${trendLabel} (medium-term basis)`,
      });
      evidence.push(
        `Unemployment Rate: ${latest.actual}%, ${trendLabel.toLowerCase()} on a medium-term basis (3-release change=${mediumTerm ?? "n/a"}pp, latest MoM=${shortTerm ?? "n/a"}pp).`
      );
      signals.unemployment = primaryChange < 0 ? "supportive" : primaryChange > 0 ? "weak" : null;
    } else {
      dataLimitations.push("Unemployment Rate trend unavailable: no computable change over any available horizon.");
      signals.unemployment = null;
    }

    // Surface disagreement between short-term and medium-term movement,
    // and between medium-term and longer-term movement, rather than
    // letting the latest print alone speak for the broader trend.
    if (
      shortTerm !== null &&
      mediumTerm !== null &&
      Math.sign(shortTerm) !== 0 &&
      Math.sign(mediumTerm) !== 0 &&
      Math.sign(shortTerm) !== Math.sign(mediumTerm)
    ) {
      conflictingEvidence.push(
        `Unemployment Rate: the latest month-over-month move (${shortTerm}pp) points the opposite direction from the 3-release medium-term trend (${mediumTerm}pp) — the short-term move may not reflect the broader trend.`
      );
    }
    if (
      mediumTerm !== null &&
      longTerm !== null &&
      Math.sign(mediumTerm) !== 0 &&
      Math.sign(longTerm) !== 0 &&
      Math.sign(mediumTerm) !== Math.sign(longTerm)
    ) {
      conflictingEvidence.push(
        `Unemployment Rate: the 3-release medium-term trend (${mediumTerm}pp) points the opposite direction from the 12-release longer-term trend (${longTerm}pp).`
      );
    }
  } else {
    dataLimitations.push("Unemployment Rate: no releases stored yet.");
    signals.unemployment = null;
  }

  // ===================== 3. Initial Jobless Claims (4-week moving average) =====================
  const claimsReal = realReleasesOnly(input.initialClaims);
  if (claimsReal.length > 0) {
    const latest = claimsReal[0];
    facts.push({
      label: "Initial Jobless Claims (latest weekly reading)",
      value: latest.actual,
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });

    if (claimsReal.length >= 4) {
      const last4 = claimsReal.slice(0, 4).map((r) => r.actual as number);
      const fourWeekAvg = average(last4);
      calculations.push({
        label: "Initial Claims: 4-week moving average",
        formula: "average of the last 4 stored weekly readings",
        result: fourWeekAvg,
      });
      dataLimitations.push(
        "4-week moving average assumes the last 4 stored readings are consecutive weeks with no gaps — not independently verified against a calendar."
      );

      if (claimsReal.length >= 8) {
        const prior4 = claimsReal.slice(4, 8).map((r) => r.actual as number);
        const priorFourWeekAvg = average(prior4);
        calculations.push({
          label: "Initial Claims: prior 4-week moving average (weeks 5-8 back)",
          formula: "average of stored weekly readings 5 through 8 releases back",
          result: priorFourWeekAvg,
        });
        if (fourWeekAvg !== null && priorFourWeekAvg !== null) {
          const trendLabel = fourWeekAvg < priorFourWeekAvg ? "Falling" : fourWeekAvg > priorFourWeekAvg ? "Rising" : "Flat";
          interpretations.push({
            label: "Initial Claims: 4-week average trend",
            rule: "Compares the current 4-week moving average to the prior 4-week moving average (weeks 5-8 back). 4-week averaging follows standard BLS/DOL practice because weekly claims are volatile.",
            result: trendLabel,
          });
          evidence.push(`Initial Claims 4-week avg: ${fourWeekAvg} (current) vs ${priorFourWeekAvg} (prior) → ${trendLabel}.`);
          signals.claims = trendLabel === "Falling" ? "supportive" : trendLabel === "Rising" ? "weak" : "neutral";
        }
      } else {
        dataLimitations.push(`Initial Claims trend unavailable: need 8 stored weekly readings to compare two 4-week averages, have ${claimsReal.length}.`);
        signals.claims = null;
      }
    } else {
      dataLimitations.push(`Initial Claims: only ${claimsReal.length} weekly reading(s) stored — 4-week average not yet computable (need 4). Not invented.`);
      signals.claims = null;
    }
  } else {
    dataLimitations.push("Initial Jobless Claims: no releases stored yet.");
    signals.claims = null;
  }

  // ===================== Continuing Claims (3-release trend as primary; latest change as short-term context; not a 4-week-average convention) =====================
  const contClaimsReal = realReleasesOnly(input.continuingClaims);
  if (contClaimsReal.length > 0) {
    const latest = contClaimsReal[0];
    facts.push({
      label: "Continuing Claims (latest)",
      value: latest.actual,
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });
    const mom = latest.actual !== null && latest.previous !== null ? round(latest.actual - latest.previous) : null;
    calculations.push({
      label: "Continuing Claims: change vs previous release (short-term context)",
      formula: "latest.actual - latest.previous",
      result: mom,
    });

    const trend3 = levelChangeOver(contClaimsReal, 3);
    calculations.push({
      label: "Continuing Claims: change over last 3 releases (primary trend)",
      formula: "latest.actual - value_3_releases_ago",
      result: trend3,
      unavailableReason: trend3 === null ? `Need 4 stored releases; have ${contClaimsReal.length}. Not inferred from a shorter window.` : undefined,
    });

    if (trend3 !== null) {
      const trendLabel = trend3 < 0 ? "Falling" : trend3 > 0 ? "Rising" : "Flat";
      interpretations.push({
        label: "Continuing Claims: 3-release trend (primary)",
        rule: "Primary signal uses the change over the last 3 stored releases rather than a single period-over-period move, so one noisy reading doesn't drive the signal alone. The latest single-period change is shown separately as short-term context, not used to set the signal on its own. Not a 4-week-average convention — that specifically applies to Initial Claims due to its higher weekly volatility.",
        result: `${trendLabel}${mom !== null ? ` (short-term context: latest change ${mom >= 0 ? "+" : ""}${mom})` : ""}`,
      });
      evidence.push(`Continuing Claims: 3-release trend = ${trendLabel.toLowerCase()} (${trend3}), short-term latest change = ${mom ?? "n/a"}.`);
      signals.continuingClaims = trend3 < 0 ? "supportive" : trend3 > 0 ? "weak" : "neutral";
    } else {
      dataLimitations.push(`Continuing Claims: 3-release trend not yet computable (have ${contClaimsReal.length} stored release(s), need 4) — not inferred from the single latest change.`);
      signals.continuingClaims = null;
    }
  } else {
    dataLimitations.push("Continuing Claims: no releases stored yet.");
    signals.continuingClaims = null;
  }

  // ===================== 4. JOLTS (3-release trend as primary; latest change as short-term context) =====================
  const joltsReal = realReleasesOnly(input.jolts);
  if (joltsReal.length > 0) {
    const latest = joltsReal[0];
    facts.push({
      label: "JOLTS Job Openings (latest)",
      value: latest.actual,
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });
    const mom = latest.actual !== null && latest.previous !== null ? round(latest.actual - latest.previous) : null;
    calculations.push({
      label: "JOLTS: change vs previous release (short-term context)",
      formula: "latest.actual - latest.previous",
      result: mom,
    });

    const trend3 = levelChangeOver(joltsReal, 3);
    calculations.push({
      label: "JOLTS: change over last 3 releases (primary trend)",
      formula: "latest.actual - value_3_releases_ago",
      result: trend3,
      unavailableReason: trend3 === null ? `Need 4 stored releases; have ${joltsReal.length}. Not inferred from a shorter window.` : undefined,
    });

    if (trend3 !== null) {
      const trendLabel = trend3 > 0 ? "Rising" : trend3 < 0 ? "Falling" : "Flat";
      interpretations.push({
        label: "JOLTS: 3-release trend (primary)",
        rule: "Primary signal uses the change over the last 3 stored releases rather than a single period-over-period move, so one noisy reading doesn't drive the signal alone. The latest single-period change is shown separately as short-term context.",
        result: `${trendLabel}${mom !== null ? ` (short-term context: latest change ${mom >= 0 ? "+" : ""}${mom})` : ""}`,
      });
      evidence.push(`JOLTS: 3-release trend = ${trendLabel.toLowerCase()} (${trend3}), short-term latest change = ${mom ?? "n/a"}.`);
      signals.jolts = trend3 > 0 ? "supportive" : trend3 < 0 ? "weak" : "neutral";
    } else {
      dataLimitations.push(`JOLTS: 3-release trend not yet computable (have ${joltsReal.length} stored release(s), need 4) — not inferred from the single latest change.`);
      signals.jolts = null;
    }
  } else {
    dataLimitations.push("JOLTS: no releases stored yet.");
    signals.jolts = null;
  }

  // ===================== 5. Wages (Average Hourly Earnings) =====================
  const wagesReal = realReleasesOnly(input.avgHourlyEarnings);
  if (wagesReal.length > 0) {
    const latest = wagesReal[0];
    facts.push({
      label: "Average Hourly Earnings (latest)",
      value: latest.actual,
      unit: "$",
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });

    const yearAgoRow = wagesReal[12];
    const yoy =
      latest.actual !== null && yearAgoRow?.actual !== null && yearAgoRow?.actual !== undefined
        ? pctChange(latest.actual, yearAgoRow.actual)
        : null;
    calculations.push({
      label: "Average Hourly Earnings: YoY % change",
      formula: "((latest.actual / value_12_releases_ago) - 1) * 100",
      result: yoy,
      unavailableReason: yoy === null ? `Need 13 stored releases; have ${wagesReal.length}.` : undefined,
    });

    if (yoy !== null) {
      const vsBenchmark = yoy > WAGE_GROWTH_BENCHMARK_PCT ? "Above benchmark" : yoy < WAGE_GROWTH_BENCHMARK_PCT ? "Below benchmark" : "At benchmark";
      interpretations.push({
        label: "Wages: YoY growth vs provisional benchmark",
        rule: `Provisional design benchmark: ${WAGE_GROWTH_BENCHMARK_PCT}% YoY (2% inflation target + ~1.5% long-run productivity growth — a commonly cited analyst rule of thumb, NOT an official Fed threshold; adjustable).`,
        result: vsBenchmark,
        isProvisionalThreshold: true,
      });
      evidence.push(`Average Hourly Earnings YoY = ${yoy}% → ${vsBenchmark} (provisional ${WAGE_GROWTH_BENCHMARK_PCT}% benchmark).`);
      signals.wages = yoy > WAGE_GROWTH_BENCHMARK_PCT ? "supportive" : yoy < WAGE_GROWTH_BENCHMARK_PCT ? "weak" : null;
    } else {
      dataLimitations.push("Wages vs benchmark comparison unavailable: insufficient YoY history.");
      signals.wages = null;
    }
  } else {
    dataLimitations.push("Average Hourly Earnings: no releases stored yet.");
    signals.wages = null;
  }

  // ===================== 6. Sahm Rule (recession/stress evidence ONLY — never gates the assessment) =====================
  const sahmReal = realReleasesOnly(input.sahmRule);
  if (sahmReal.length > 0) {
    const latest = sahmReal[0];
    facts.push({
      label: "Sahm Rule indicator (latest)",
      value: latest.actual,
      unit: "pp",
      periodCovered: latest.period_covered,
      source: toSourceRef(latest),
    });
    const isTriggered = (latest.actual as number) >= SAHM_RECESSION_TRIGGER;
    interpretations.push({
      label: "Sahm Rule: recession/stress signal",
      rule: `Sahm Rule's own official trigger: indicator ≥ ${SAHM_RECESSION_TRIGGER} signals a recession has historically begun. This is the rule's defined threshold, not a value we invented. Used as high-severity stress evidence — it does NOT by itself set Weak or Strong, but if triggered it materially caps an otherwise-Strong evidence-hierarchy result down to Moderate (see the Overall Assessment section below), rather than being noted only in passing.`,
      result: isTriggered ? "Recession-level stress signaled" : "Below recession-signal threshold",
    });
  } else {
    dataLimitations.push(
      "Sahm Rule (FRED SAHMREALTIME) is not yet wired into the data-acquisition pipeline — this evidence input is currently unavailable, not fabricated."
    );
  }

  // ===================== FINAL ASSESSMENT: explicit evidence-pattern rule matrix =====================
  // NOT a vote count, NOT a weighted score, and NOT a "majority of inputs"
  // rule. No comparison in this section counts how many signals agree —
  // every pattern below is a fixed, named, deterministic combination of
  // SPECIFIC indicators. No single indicator (including the Sahm Rule)
  // acts as a standalone override — each pattern is a conjunction/
  // combination of multiple named conditions.

  const nfpState = signals.nfp; // "supportive" | "weak" | null
  const uState = signals.unemployment;
  const claimsState = signals.claims;
  const contClaimsState = signals.continuingClaims;
  const joltsState = signals.jolts;
  const wagesState = signals.wages;
  const sahmTriggered = sahmReal.length > 0 && (sahmReal[0].actual as number) >= SAHM_RECESSION_TRIGGER;
  const sahmComputable = sahmReal.length > 0;
  const hadPriorContradiction = conflictingEvidence.length > 0; // e.g. short-term vs medium-term unemployment disagreement, flagged earlier

  const allCoreAndConfirmingComputable =
    nfpState !== null && uState !== null && claimsState !== null && contClaimsState !== null && joltsState !== null;

  // ---- Named pattern: STRONG ----
  // Every condition below must hold — this mirrors the seven-bullet example
  // structure exactly (all conditions required, not "most of them"). Per
  // the methodology's own wording, Unemployment/Claims/Continuing
  // Claims/JOLTS explicitly allow "stable" as well as their improving
  // direction (stable/falling for Unemployment and Claims, stable/rising
  // for JOLTS) — a genuinely flat/neutral reading is a real, distinctly
  // labeled state (not conflated with "supportive"), but IS permitted by
  // these specific OR-conditions because the methodology says so
  // explicitly. NFP and Wages have no such "stable" allowance and must be
  // strictly supportive.
  //   1. NFP recent pace stronger than longer-term pace (strict)
  //   2. Unemployment stable/falling on a medium-term basis
  //   3. Initial Claims stable/falling
  //   4. Continuing Claims stable/falling
  //   5. JOLTS stable/rising
  //   6. Wages supportive (above the provisional benchmark) (strict)
  //   7. No recession-level Sahm stress
  //   8. No major contradictory evidence already flagged (e.g. short-term
  //      vs medium-term unemployment disagreement)
  const isSupportiveOrNeutral = (s: "supportive" | "weak" | "neutral" | null) => s === "supportive" || s === "neutral";
  const matchesStrongPattern =
    allCoreAndConfirmingComputable &&
    nfpState === "supportive" &&
    isSupportiveOrNeutral(uState) &&
    isSupportiveOrNeutral(claimsState) &&
    isSupportiveOrNeutral(contClaimsState) &&
    isSupportiveOrNeutral(joltsState) &&
    wagesState === "supportive" &&
    !sahmTriggered &&
    !hadPriorContradiction;

  // ---- Named pattern: WEAK-A (broad deterioration) ----
  // Mirrors "broad deterioration across labor indicators": every one of
  // NFP, Unemployment, JOLTS, and at least one of the two Claims series
  // must show deterioration together. "neutral" does NOT satisfy "weak"
  // here — a flat reading is not deterioration.
  const matchesWeakBroadDeterioration =
    nfpState === "weak" &&
    uState === "weak" &&
    joltsState === "weak" &&
    (claimsState === "weak" || contClaimsState === "weak");

  // ---- Named pattern: WEAK-B (stress combined with deterioration) ----
  // Mirrors "meaningful recession/stress evidence combined with
  // deterioration": the Sahm Rule alone never decides this — it must be
  // paired with at least one other deteriorating condition (NFP or
  // Unemployment) to match this pattern.
  const matchesWeakStressCombination = sahmTriggered && (nfpState === "weak" || uState === "weak");

  let assessment: EmploymentAssessment["assessment"];
  let assessmentReason: string;

  if (matchesStrongPattern) {
    assessment = "Strong";
    assessmentReason =
      "Matches the Strong pattern: NFP pace, Unemployment, Claims, Continuing Claims, and JOLTS all read supportive, wages are above the provisional benchmark, no recession-level Sahm stress, and no contradictory evidence was flagged elsewhere.";
  } else if (matchesWeakBroadDeterioration) {
    assessment = "Weak";
    assessmentReason =
      "Matches the Weak (broad deterioration) pattern: NFP pace, Unemployment, and JOLTS all read weak, together with deterioration in Initial and/or Continuing Claims.";
  } else if (matchesWeakStressCombination) {
    assessment = "Weak";
    assessmentReason =
      "Matches the Weak (stress-combined) pattern: the Sahm Rule has crossed its recession-signal threshold together with deterioration in NFP pace and/or Unemployment — the Sahm Rule alone never triggers this; it must be paired with at least one other deteriorating core signal.";
  } else {
    assessment = "Moderate";
    const reasons: string[] = [];
    if (!allCoreAndConfirmingComputable) {
      reasons.push("not all of NFP/Unemployment/Claims/Continuing Claims/JOLTS are computable yet");
    }
    if (nfpState !== null && uState !== null && nfpState !== uState) {
      reasons.push(`NFP (${nfpState}) and Unemployment (${uState}) point in different directions`);
    }
    if (hadPriorContradiction) {
      reasons.push("a contradiction was already flagged elsewhere (e.g. short-term vs medium-term unemployment disagreement)");
    }
    if (sahmTriggered && !matchesWeakBroadDeterioration && !matchesWeakStressCombination) {
      reasons.push("Sahm Rule stress is present without a broader deteriorating pattern to combine with");
    }
    if (reasons.length === 0) {
      reasons.push("evidence is resilient but mixed across indicators — no single named pattern (Strong or Weak) is fully matched");
    }
    assessmentReason = `Does not fully match the Strong or Weak pattern: ${reasons.join("; ")}.`;
  }

  interpretations.push({
    label: "Overall Employment assessment rule (evidence-pattern matrix)",
    rule: "The assessment is decided by matching NAMED, fixed combinations of specific indicators — never by counting how many signals agree and never by a weighted score. STRONG requires ALL of: NFP pace supportive (strict), Unemployment stable-or-falling, Claims stable-or-falling, Continuing Claims stable-or-falling, JOLTS stable-or-rising, Wages supportive (strict), no Sahm stress, no prior contradiction. A flat/neutral reading is a distinct, real state (not conflated with 'supportive') that the methodology explicitly permits within Unemployment/Claims/Continuing Claims/JOLTS for Strong, but 'neutral' never counts toward the Weak pattern. WEAK matches either 'broad deterioration' (NFP + Unemployment + JOLTS weak, plus at least one Claims series weak) or 'stress combination' (Sahm triggered together with NFP or Unemployment weak — Sahm alone never qualifies). MODERATE is everything else, with the specific reason stated.",
    result: `${assessment} — ${assessmentReason}`,
  });

  if (wagesState) {
    evidence.push(`Wages: ${wagesState} vs the provisional benchmark (one of the named conditions for the Strong pattern).`);
  }

  if (sahmTriggered) {
    conflictingEvidence.push(
      `Sahm Rule has crossed its recession-signal threshold. On its own this never decides the assessment — it only contributes to a Weak result when paired with NFP or Unemployment deterioration (see the 'stress combination' pattern), and it disqualifies the Strong pattern by itself.`
    );
  }

  // ---- Confidence ----
  const computableCoreConfirming = [nfpState, uState, claimsState, contClaimsState, joltsState].filter((s) => s !== null).length;
  const computableTotal = computableCoreConfirming + (wagesState !== null ? 1 : 0) + (sahmComputable ? 1 : 0);

  let confidence: ConfidenceLevel;
  if (computableTotal === 0) {
    confidence = "Insufficient data";
  } else if (computableCoreConfirming === 5) {
    confidence = "High";
  } else if (computableCoreConfirming >= 3) {
    confidence = "Medium";
  } else {
    confidence = "Low";
  }

  return {
    category: "Employment",
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
