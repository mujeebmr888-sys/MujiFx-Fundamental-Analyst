import SideNav from "@/components/dashboard/SideNav";
import { getLatestForIndicators } from "@/layers/historical-database/database";
import { INDICATOR_META } from "@/config/indicators";
import type { IndicatorId } from "@/types/economic-data";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const FORECAST_INDICATORS: IndicatorId[] = ["CPI", "PPI", "NFP", "GDP"];

export default async function ForecastsPage() {
  let latestByIndicator: Awaited<
    ReturnType<typeof getLatestForIndicators>
  > | null = null;
  let debugError: string | null = null;

  try {
    latestByIndicator = await getLatestForIndicators(FORECAST_INDICATORS);
  } catch (err) {
    debugError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">MUJIFX Forecasts</h1>
        <p className="text-slate-400 mb-8">
          MUJIFX&apos;s own model estimates for upcoming major releases,
          based on recent trend. These are not guaranteed predictions and do
          not reflect any external market consensus.
        </p>

        {debugError && (
          <div className="mb-6 border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Debug info: {debugError}
          </div>
        )}

        <div className="space-y-4">
          {FORECAST_INDICATORS.map((id) => {
            const row = latestByIndicator?.get(id);
            const hasForecast = row && row.mujifx_estimate !== null;

            return (
              <div
                key={id}
                className="border border-slate-800 rounded-lg p-5 bg-slate-900/50"
              >
                <div className="text-sm font-medium mb-1">
                  {INDICATOR_META[id].label}
                </div>

                {hasForecast ? (
                  <>
                    <div className="text-2xl font-semibold">
                      {row!.mujifx_estimate}
                      <span className="text-sm text-slate-400 ml-2">
                        (range: {row!.mujifx_estimate_low} to{" "}
                        {row!.mujifx_estimate_high})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Confidence:{" "}
                      <span className="font-medium">
                        {row!.mujifx_confidence}
                      </span>{" "}
                      · For period: {row!.period_covered}
                    </div>
                    <p className="text-sm text-slate-400 mt-3">
                      {row!.mujifx_rationale}
                    </p>
                    <p className="text-xs text-slate-500 mt-2 italic">
                      {row!.mujifx_risks}
                    </p>
                  </>
                ) : (
                  <div className="text-slate-600 text-sm italic">
                    No forecast yet — check back after the next automatic
                    sync, or after a few more monthly releases have
                    accumulated (the model needs at least 3 past releases).
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
