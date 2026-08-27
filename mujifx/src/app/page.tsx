import SideNav from "@/components/dashboard/SideNav";
import IndicatorCard from "@/components/dashboard/IndicatorCard";
import FundamentalBiasCard from "@/components/dashboard/FundamentalBiasCard";
import { getLatestForIndicators } from "@/layers/historical-database/database";
import { computeUsdFundamentalScore } from "@/layers/fundamental-scoring/scoring";
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
