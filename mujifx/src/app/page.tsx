import SideNav from "@/components/dashboard/SideNav";
import { getLatestDataPoint } from "@/layers/historical-database/database";

export const dynamic = "force-dynamic"; // always read fresh data, never cache
export const fetchCache = "force-no-store"; // never reuse a cached network response
export const revalidate = 0;

export default async function DashboardPage() {
  let cpi = null;
  let debugError: string | null = null;

  try {
    cpi = await getLatestDataPoint("CPI");
  } catch (err) {
    // Safe to show: this only touches the public anon-key client, which
    // never has access to secrets. Helps diagnose connection issues.
    debugError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-semibold mb-2">USD Fundamental Research</h1>
        <p className="text-slate-400 max-w-2xl mb-8">
          Institutional-style macro research. This is analysis, not trade signals.
        </p>

        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/50 max-w-sm">
          <div className="text-sm text-slate-400 mb-1">CPI (latest)</div>
          {cpi ? (
            <>
              <div className="text-3xl font-semibold">{cpi.actual}</div>
              <div className="text-xs text-slate-500 mt-2">
                Period: {cpi.period_covered} · Source: {cpi.source_name}
              </div>
            </>
          ) : (
            <div className="text-slate-500 text-sm">
              No data yet — visit <code>/api/sync/cpi</code> once to run the
              first pipeline sync, or the database isn't connected yet.
            </div>
          )}
        </div>

        {debugError && (
          <div className="mt-4 max-w-lg border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Debug info: {debugError}
          </div>
        )}
      </main>
    </div>
  );
}
