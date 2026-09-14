/**
 * EMPLOYMENT SAHM BRIDGE
 *
 * Derives the Sahm Rule stress input from the authoritative BLS unemployment
 * history already stored by MUJIFX. This avoids treating a separate FRED
 * SAHM series as a permanent source/archive while keeping the approved
 * Sahm Rule formula explicit and deterministic.
 */
import {
  generateEmploymentAssessment,
  type EmploymentEngineInput,
  type EmploymentHistoryRow,
} from "@/layers/fundamental-scoring/employment";
import type { EmploymentAssessment } from "@/types/assessment";

const SAHM_TRIGGER_PP = 0.5;

function average(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function deriveSahmRow(rows: EmploymentHistoryRow[]): EmploymentHistoryRow | null {
  const usable = rows.filter((row) => row.actual !== null);

  // Current 3-month average plus the 12 previous 3-month averages requires
  // 15 monthly observations. Never approximate the missing history.
  if (usable.length < 15) return null;

  const currentThreeMonthAverage = average(
    usable.slice(0, 3).map((row) => row.actual as number)
  );

  if (currentThreeMonthAverage === null) return null;

  const previousTwelveAverages: number[] = [];
  for (let offset = 1; offset <= 12; offset += 1) {
    const window = usable.slice(offset, offset + 3);
    if (window.length < 3) return null;
    const value = average(window.map((row) => row.actual as number));
    if (value === null) return null;
    previousTwelveAverages.push(value);
  }

  const minimumPreviousAverage = Math.min(...previousTwelveAverages);
  const sahmValue = currentThreeMonthAverage - minimumPreviousAverage;
  const latest = usable[0];

  return {
    actual: Math.round(sahmValue * 1000) / 1000,
    previous: null,
    period_covered: latest.period_covered,
    release_date: latest.release_date,
    source_name: latest.source_name,
    source_url: latest.source_url,
    source_tier: latest.source_tier,
    retrieved_at: latest.retrieved_at,
  };
}

export function generateEmploymentAssessmentFromBls(
  input: EmploymentEngineInput
): EmploymentAssessment {
  const derivedSahm = deriveSahmRow(input.unemploymentRate);

  return generateEmploymentAssessment({
    ...input,
    // The legacy input remains part of the interface for compatibility, but
    // the employment engine receives the deterministic BLS-derived value.
    sahmRule: derivedSahm ? [derivedSahm] : [],
  });
}

export { SAHM_TRIGGER_PP };
