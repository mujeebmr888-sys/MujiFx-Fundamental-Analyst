import SideNav from "@/components/dashboard/SideNav";

export default function DashboardPage() {
  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-semibold mb-2">USD Fundamental Research</h1>
        <p className="text-slate-400 max-w-2xl mb-8">
          Institutional-style macro research. This is analysis, not trade signals.
        </p>

        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/50">
          <p className="text-slate-400 text-sm">
            Foundation build — no live indicator cards are wired up yet on this
            page. The data pipeline (FRED → normalization → database → scoring)
            is being built layer by layer so that nothing shown here is ever
            hardcoded or fabricated.
          </p>
        </div>
      </main>
    </div>
  );
}
