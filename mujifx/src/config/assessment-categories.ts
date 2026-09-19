/**
 * Maps the URL slug for each category page/endpoint to the key it has on
 * UsdFundamentalAssessment.categories. Kept in one place so the nav, the
 * pages and the API route can never disagree about what "/usd/fed" means.
 */
import type { UsdFundamentalAssessment } from "@/types/assessment";

export interface CategoryRoute {
  slug: string;
  key: keyof UsdFundamentalAssessment["categories"];
  title: string;
  blurb: string;
}

export const CATEGORY_ROUTES: CategoryRoute[] = [
  {
    slug: "inflation",
    key: "inflation",
    title: "Inflation",
    blurb:
      "CPI, Core CPI, PCE, Core PCE and PPI, read against the Fed's 2% target and their own recent momentum.",
  },
  {
    slug: "employment",
    key: "employment",
    title: "Employment",
    blurb:
      "Payrolls, unemployment rate, average hourly earnings, jobless claims and JOLTS, plus the Sahm Rule derived from stored BLS history.",
  },
  {
    slug: "growth",
    key: "growth",
    title: "Growth",
    blurb:
      "Real GDP growth, retail sales and industrial production.",
  },
  {
    slug: "fed",
    key: "monetaryPolicy",
    title: "Monetary Policy",
    blurb:
      "The Fed's stance implied by the effective funds rate against the inflation, employment and growth reads.",
  },
  {
    slug: "market",
    key: "marketPricing",
    title: "Market Pricing",
    blurb:
      "What the 2y/10y curve and the broad dollar index are actually pricing — the confirmation check against the macro picture.",
  },
  {
    slug: "risk",
    key: "riskEnvironment",
    title: "Risk Environment",
    blurb:
      "Context only. Never mechanically converted into a USD bullish or bearish read.",
  },
];

export function findCategoryRoute(slug: string): CategoryRoute | undefined {
  return CATEGORY_ROUTES.find((c) => c.slug === slug);
}
