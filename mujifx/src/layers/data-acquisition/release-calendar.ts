/**
 * STEP 13K — AUTHORITATIVE RELEASE-DATE RESOLVER
 *
 * Resolves publication dates from official BLS/BEA release calendars.
 * Observation dates are never used as release-date fallbacks.
 *
 * This is intentionally fail-soft: if an official calendar cannot be
 * fetched or parsed, the caller receives null and the observation remains
 * explicitly unverified.
 */

import type { IndicatorId } from "@/types/economic-data";

const BLS_SCHEDULE_URL = "https://www.bls.gov/schedule/2026/";
const BEA_SCHEDULE_URL = "https://www.bea.gov/news/schedule/full";

let blsSchedulePromise: Promise<string | null> | null = null;
let beaSchedulePromise: Promise<string | null> | null = null;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        "user-agent": "MUJIFX-Fundamental-Analyst/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return null;
    return stripHtml(await response.text());
  } catch {
    return null;
  }
}

function getBlsSchedule(): Promise<string | null> {
  if (!blsSchedulePromise) {
    blsSchedulePromise = fetchText(BLS_SCHEDULE_URL);
  }
  return blsSchedulePromise;
}

function getBeaSchedule(): Promise<string | null> {
  if (!beaSchedulePromise) {
    beaSchedulePromise = fetchText(BEA_SCHEDULE_URL);
  }
  return beaSchedulePromise;
}

function monthName(month: string): string | null {
  const index = Number(month);
  if (!Number.isInteger(index) || index < 1 || index > 12) return null;
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][index - 1];
}

function normalizeDate(month: string, day: string, year: string): string {
  const monthNumber = String(
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ].indexOf(month) + 1
  ).padStart(2, "0");

  return `${year}-${monthNumber}-${day.padStart(2, "0")}`;
}

/**
 * Find a BLS release date for an exact release title/observation month.
 * The official calendar contains entries such as:
 * "April 10, 2026 ... Consumer Price Index for March 2026".
 */
function parseBlsReleaseDate(
  schedule: string,
  releaseTitle: "Consumer Price Index" | "Employment Situation",
  observationPeriod: string
): string | null {
  const [year, month] = observationPeriod.split("-");
  const observedMonthName = monthName(month);
  if (!year || !observedMonthName) return null;

  const escapedTitle = releaseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedMonth = observedMonthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const pattern = new RegExp(
    `(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(\\d{4})[\\s\\S]{0,350}?${escapedTitle}\\s+for\\s+${escapedMonth}\\s+${year}`,
    "i"
  );

  const match = pattern.exec(schedule);
  if (!match) return null;

  return normalizeDate(match[1], match[2], match[3]);
}

function quarterLabel(period: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return null;

  const month = Number(match[2]);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${match[1]} Quarter ${quarter}`;
}

/**
 * BEA GDP has multiple releases per quarter. For the CURRENT authoritative
 * plane we attach the latest official scheduled GDP release for that quarter.
 * This is not a substitute for a full vintage history.
 */
function parseBeaGdpReleaseDate(
  schedule: string,
  observationPeriod: string
): string | null {
  const label = quarterLabel(observationPeriod);
  if (!label) return null;

  const pattern = new RegExp(
    `(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})\\s+\\d{1,2}:\\d{2}\\s+AM[\\s\\S]{0,450}?GDP\\s+(?:\\(Advance Estimate\\)|\\(Second Estimate\\)|\\(Third Estimate\\))[^|]*?${label.replace(" ", "\\s+")}`,
    "gi"
  );

  let latest: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(schedule))) {
    const yearMatch = schedule.slice(Math.max(0, match.index - 80), match.index).match(/(20\d{2})/);
    const year = yearMatch?.[1];
    if (year) latest = normalizeDate(match[1], match[2], year);
  }

  return latest;
}

function parseBeaPceReleaseDate(
  schedule: string,
  observationPeriod: string
): string | null {
  const [year, month] = observationPeriod.split("-");
  const observedMonthName = monthName(month);
  if (!year || !observedMonthName) return null;

  const pattern = new RegExp(
    `(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})\\s+\\d{1,2}:\\d{2}\\s+AM[\\s\\S]{0,450}?Personal Income and Outlays,\\s+${observedMonthName}\\s+${year}`,
    "i"
  );

  const match = pattern.exec(schedule);
  if (!match) return null;

  const yearMatch = schedule.slice(Math.max(0, match.index - 80), match.index).match(/(20\d{2})/);
  if (!yearMatch) return null;

  return normalizeDate(match[1], match[2], yearMatch[1]);
}

export async function resolveVerifiedReleaseDate(
  indicator: IndicatorId,
  periodCovered: string
): Promise<string | null> {
  const period = periodCovered.slice(0, 7);

  if (indicator === "CPI" || indicator === "CORE_CPI") {
    const schedule = await getBlsSchedule();
    return schedule
      ? parseBlsReleaseDate(schedule, "Consumer Price Index", period)
      : null;
  }

  if (
    indicator === "NFP" ||
    indicator === "UNEMPLOYMENT_RATE" ||
    indicator === "AVG_HOURLY_EARNINGS"
  ) {
    const schedule = await getBlsSchedule();
    return schedule
      ? parseBlsReleaseDate(schedule, "Employment Situation", period)
      : null;
  }

  if (indicator === "PCE" || indicator === "CORE_PCE") {
    const schedule = await getBeaSchedule();
    return schedule ? parseBeaPceReleaseDate(schedule, period) : null;
  }

  if (indicator === "GDP_GROWTH_RATE") {
    const schedule = await getBeaSchedule();
    return schedule ? parseBeaGdpReleaseDate(schedule, period) : null;
  }

  // Fed H.15 remains intentionally unverified here because its daily
  // publication semantics do not map cleanly to the monthly-average
  // observation without a dedicated source-level rule.
  return null;
}

export async function enrichWithVerifiedReleaseDate<
  T extends { indicator: IndicatorId; periodCovered: string }
>(observation: T): Promise<T & {
  sourceReleaseDate: string | null;
  sourceReleaseDateVerified: boolean;
}> {
  const sourceReleaseDate = await resolveVerifiedReleaseDate(
    observation.indicator,
    observation.periodCovered
  );

  return {
    ...observation,
    sourceReleaseDate,
    sourceReleaseDateVerified: Boolean(sourceReleaseDate),
  };
}
