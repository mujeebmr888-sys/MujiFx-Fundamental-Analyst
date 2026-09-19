/**
 * /usd/[category] - one category engine's full assessment.
 *
 * Covers inflation, employment, growth, fed (monetary policy), market
 * (market pricing) and risk (risk environment). The SideNav already linked
 * to five of these routes before they existed, so every one of those links
 * returned a 404.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import SideNav from "@/components/dashboard/SideNav";
import AssessmentView from "@/components/dashboard/AssessmentView";
import { buildUsdAssessment } from "@/layers/assessment-pipeline/build-usd-assessment";
import { findCategoryRoute } from "@/config/assessment-categories";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Deliberately NO generateStaticParams: these pages read live database
// state on every request. Prerendering them at build time would serve a
// frozen assessment from whenever the deploy happened, which for a macro
// research page is worse than useless.
export const dynamicParams = true;

export default async function CategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const route = findCategoryRoute(params.category);
  if (!route) notFound();

  let result: Awaited<ReturnType<typeof buildUsdAssessment>> | null = null;
  let error: string | null = null;

  try {
    result = await buildUsdAssessment();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const category = result?.assessment.categories[route.key];

  return (
    <div className="flex">
      <SideNav />
      <main className="flex-1 p-8 max-w-4xl">
        <Link
          href="/usd"
          className="text-xs text-slate-500 hover:text-slate-300 mb-3 inline-block"
        >
          ← Overall USD condition
        </Link>
        <h1 className="text-2xl font-semibold mb-2">{route.title}</h1>
        <p className="text-slate-400 mb-8 leading-relaxed">{route.blurb}</p>

        {error && (
          <div className="mb-6 border border-red-900 rounded-lg p-4 bg-red-950/30 text-red-300 text-xs font-mono">
            Assessment could not be generated: {error}
          </div>
        )}

        {category && (
          <AssessmentView
            title={category.category}
            label={category.assessment}
            assessment={category}
          />
        )}

        {route.key === "riskEnvironment" && category && (
          <p className="text-xs text-slate-500 mt-6 leading-relaxed border border-slate-800 rounded p-4">
            This category is reported as context only. It is deliberately
            excluded from the four orchestration rules and from the overall
            confidence calculation, because the dollar&apos;s relationship
            with risk sentiment depends on relative monetary policy, global
            growth, liquidity and capital flows - none of which this system
            models.
          </p>
        )}
      </main>
    </div>
  );
}
