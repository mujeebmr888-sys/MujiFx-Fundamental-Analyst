import SideNav from "@/components/dashboard/SideNav";
import IndicatorCard from "@/components/dashboard/IndicatorCard";
import FundamentalBiasCard from "@/components/dashboard/FundamentalBiasCard";
import { getLatestForIndicators } from "@/layers/historical-database/database";
import { computeUsdFundamentalScore } from "@/layers/fundamental-scoring/scoring";
import { buildUsdAssessment } from "@/layers/assessment-pipeline/build-usd-assessment";
import { CATEGORY_ROUTES } from "@/config/assessment-categories";
import Link from "next/link";
import {
  INDICATOR_META,
  CATEGORY_ORDER,
} from "@/config/indicators";
import type { IndicatorId } from "@/types/economic-data";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function DashboardPage() {
  const allIndicators = Object.keys(INDICATOR_META) as IndicatorId[];

  let latestByIndicator: Awaited<
    ReturnType<typeof getLatestForIndicators>
  > | null = null;
  let debugError: string | null = null;

  try {
    latestByIndicator = await getLatestForIndicators(allIndicators);
  } catch (err) {
    debugError = err instanceof Error ? err.message : String(err);
  }

  // Build a simple indicator -> month-over-month change map for scoring.
  const momChangeByIndicator = new Map<IndicatorId, number | null>();
  if (latestByIndicator) {
    for (const [id, row] of latestByIndicator.entries()) {
      const momChange =
        row.actual != null && row.previous != null
          ? Math.round((row.actual - row.previous) * 1000) / 1000
          : null;
      momChangeByIndicator.set(id as IndicatorId, momChange);
    }
  }
  const fundamentalScore = computeUsdFundamentalScore(momChangeByIndicator);

  // The authoritative read. The legacy score card below is a quick gauge
  // only; where the two differ, this is the one that counts.
  let engine: Awaited<ReturnType<typeof buildUsdAssessment>> | null = null;
  let engineError: string | null = null;
  try {
    engine = await buildUsdAssessment();
  } catch (err) {
    engineError = err instanceof Error ? err.message : String(err);
  }

  const CONDITION_COLOR: Record<string, string> = {
    Strong: "text-emerald-400",
    Moderate: "text-amber-400",
    Neutral: "text-slate-300",
    Weak: "text-red-400",
  };

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-semibold mb-2">USD Fundamental Research</h1>
        <p className="text-slate-400 max-w-2xl mb-8">
          Institutional-style macro research, updated automatically once a day
          from official U.S. government sources. This is analysis, not trade
          signals.
        </p>

        {debugError && (
          <div className="mb-6 max-w-lg border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Debug info: {debugError}
          </div>
        )}

        {engineError && (
          <div className="mb-6 max-w-2xl border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Assessment engine error: {engineError}
          </div>
        )}

        {engine && (
          <div className="border border-slate-800 rounded-lg bg-slate-900/40 p-6 mb-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
                Overall USD Fundamental Condition
              </h2>
              <Link
                href="/usd"
                className="text-xs text-slate-500 hover:text-slate-300 underline decoration-dotted"
              >
                {"full reasoning chain ->"}
              </Link>
            </div>

            <div className="flex flex-wrap items-baseline gap-3 mb-4">
              <span
                className={`text-3xl font-bold ${
                  CONDITION_COLOR[engine.assessment.overallCondition] ??
                  "text-slate-200"
                }`}
              >
                {engine.assessment.overallCondition}
              </span>
              <span className="text-sm text-slate-500">
                confidence: {engine.assessment.confidence}
              </span>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              {engine.assessment.rationale}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CATEGORY_ROUTES.map((cat) => (
                <Link
                  key={cat.slug}
                  href={`/usd/${cat.slug}`}
                  className="border border-slate-800 rounded px-3 py-2 hover:border-slate-600 hover:bg-slate-900 transition-colors"
                >
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {cat.title}
                  </div>
                  <div className="text-sm font-semibold text-slate-100">
                    {engine!.assessment.categories[cat.key].assessment}
                  </div>
                </Link>
              ))}
            </div>

            {engine.assessment.conflictingEvidence.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <p className="text-[11px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">
                  Conflicting evidence
                </p>
                <ul className="space-y-1">
                  {engine.assessment.conflictingEvidence.map((item, i) => (
                    <li key={i} className="text-xs text-amber-200/80 leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {latestByIndicator && <FundamentalBiasCard score={fundamentalScore} />}

        {CATEGORY_ORDER.map((category) => {
          const indicatorsInCategory = allIndicators.filter(
            (id) => INDICATOR_META[id].category === category
          );

          return (
            <section key={category} className="mb-10">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                {category}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {indicatorsInCategory.map((id) => (
                  <IndicatorCard
                    key={id}
                    meta={INDICATOR_META[id]}
                    row={latestByIndicator?.get(id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
