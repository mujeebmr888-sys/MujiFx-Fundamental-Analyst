import SideNav from "@/components/dashboard/SideNav";
import { getLatestAnalystAssessment } from "@/layers/historical-database/database";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
        {title}
      </h3>
      <p className="text-slate-200 leading-relaxed">{text}</p>
    </div>
  );
}

export default async function ResearchPage() {
  let assessment = null;
  let debugError: string | null = null;

  try {
    assessment = await getLatestAnalystAssessment();
  } catch (err) {
    debugError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">USD Research Note</h1>
        <p className="text-slate-400 mb-8">
          AI-generated commentary summarizing everything else on this
          dashboard, following a fixed analyst framework. Generated
          automatically once a day — not trading advice.
        </p>

        {debugError && (
          <div className="mb-6 border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Debug info: {debugError}
          </div>
        )}

        {!assessment ? (
          <div className="text-slate-600 text-sm italic">
            No research note yet — check back after the next automatic sync
            (runs once daily), or run <code>/api/sync/all</code> manually to
            generate one now.
          </div>
        ) : (
          <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/50">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
              <div>
                <span className="text-sm text-slate-400">Overall bias: </span>
                <span className="font-semibold">{assessment.fundamental_bias}</span>
                <span className="text-sm text-slate-500 ml-2">
                  (score: {assessment.fundamental_score}/10)
                </span>
              </div>
              <span className="text-xs text-slate-500">
                {new Date(assessment.generated_at).toLocaleString()}
              </span>
            </div>

            <Section title="What Changed" text={assessment.what_changed} />
            <Section title="Why It Changed" text={assessment.why_it_changed} />
            <Section
              title="Economic Implications"
              text={assessment.economic_implications}
            />
            <Section
              title="Central Bank Implications"
              text={assessment.central_bank_implications}
            />
            <Section
              title="Market Expectations vs. Pricing"
              text={assessment.market_expectations_vs_pricing}
            />
            <Section
              title="Cross-Asset Confirmation"
              text={assessment.cross_asset_confirmation}
            />
            <Section title="Contradictions" text={assessment.contradictions} />
            <Section title="Risks" text={assessment.risks} />
            <Section title="Final Assessment" text={assessment.final_assessment} />

            <p className="text-xs text-slate-600 italic mt-6 pt-4 border-t border-slate-800">
              {assessment.disclaimer}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
