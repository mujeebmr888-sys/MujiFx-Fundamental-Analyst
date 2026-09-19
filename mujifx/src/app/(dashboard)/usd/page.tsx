/**
 * /usd - OVERALL USD FUNDAMENTAL CONDITION
 *
 * This page was missing entirely: the six category engines and the
 * orchestrator existed and were correct, but nothing in the UI ever
 * rendered them, so the "brain" of the app was unreachable outside a raw
 * JSON endpoint. The homepage instead showed only the legacy quick score.
 */
import Link from "next/link";
import SideNav from "@/components/dashboard/SideNav";
import AssessmentView from "@/components/dashboard/AssessmentView";
import { buildUsdAssessment } from "@/layers/assessment-pipeline/build-usd-assessment";
import { CATEGORY_ROUTES } from "@/config/assessment-categories";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const CONDITION_COLOR: Record<string, string> = {
  Strong: "text-emerald-400",
  Moderate: "text-amber-400",
  Neutral: "text-slate-300",
  Weak: "text-red-400",
};

export default async function UsdOverallPage() {
  let result: Awaited<ReturnType<typeof buildUsdAssessment>> | null = null;
  let error: string | null = null;

  try {
    result = await buildUsdAssessment();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8 max-w-4xl">
        <h1 className="text-2xl font-semibold mb-2">
          Overall USD Fundamental Condition
        </h1>
        <p className="text-slate-400 mb-8 leading-relaxed">
          Produced by six independent category engines combined under four
          named, deterministic rules - not an average of scores and not a
          weighted point system. Where categories disagree, the
          disagreement is reported rather than resolved.
        </p>

        {error && (
          <div className="mb-6 border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Assessment could not be generated: {error}
          </div>
        )}

        {result && result.readErrors.length > 0 && (
          <div className="mb-6 border border-amber-900 rounded-lg p-4 bg-amber-950/20 text-amber-300 text-xs">
            <p className="font-semibold mb-1">
              Some indicator histories could not be read:
            </p>
            <ul className="list-disc list-inside space-y-0.5 font-mono">
              {result.readErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <p className="mt-2 not-italic">
              The affected categories fall back to lower confidence rather
              than guessing - see their data limitations below.
            </p>
          </div>
        )}

        {result && (
          <>
            <div className="border border-slate-800 rounded-lg bg-slate-900/40 p-6 mb-8">
              <div className="flex flex-wrap items-baseline gap-3 mb-5">
                <span
                  className={`text-4xl font-bold ${
                    CONDITION_COLOR[result.assessment.overallCondition] ??
                    "text-slate-200"
                  }`}
                >
                  {result.assessment.overallCondition}
                </span>
                <span className="text-sm text-slate-500">
                  confidence: {result.assessment.confidence}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {CATEGORY_ROUTES.map((cat) => {
                  const category = result!.assessment.categories[cat.key];
                  return (
                    <Link
                      key={cat.slug}
                      href={`/usd/${cat.slug}`}
                      className="border border-slate-800 rounded p-3 hover:border-slate-600 hover:bg-slate-900 transition-colors"
                    >
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">
                        {cat.title}
                      </div>
                      <div className="font-semibold text-slate-100">
                        {category.assessment}
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {category.confidence}
                      </div>
                    </Link>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-600 mt-4">
                Risk Environment is shown for context only. It is excluded
                from the decision rules and from the confidence calculation -
                Risk-Off is not mechanically converted into USD strength.
              </p>
            </div>

            <AssessmentView
              title="Orchestration detail"
              label={result.assessment.overallCondition}
              rationale={result.assessment.rationale}
              assessment={result.assessment}
            />
          </>
        )}
      </main>
    </div>
  );
}
