import SideNav from "@/components/dashboard/SideNav";
import { getLatestDataPoint } from "@/layers/historical-database/database";

export const dynamic = "force-dynamic"; // always read fresh data, never cache

export default async function DashboardPage() {
  const cpi = await getLatestDataPoint("CPI").catch(() => null);

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
      </main>
    </div>
  );
}
