import Link from "next/link";
import { CATEGORY_ROUTES } from "@/config/assessment-categories";

/**
 * Nav items are derived from CATEGORY_ROUTES rather than hardcoded, so a
 * link can no longer point at a page that doesn't exist - which was the
 * case for /usd, /usd/inflation, /usd/employment, /usd/growth, /usd/fed
 * and /usd/market, all of which previously 404'd.
 */
const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "USD Condition", href: "/usd" },
  ...CATEGORY_ROUTES.map((c) => ({ label: c.title, href: `/usd/${c.slug}` })),
  { label: "Forecasts", href: "/usd/forecasts" },
  { label: "Research Note", href: "/usd/research" },
];

export default function SideNav() {
  return (
    <nav className="w-56 shrink-0 border-r border-slate-800 min-h-screen p-4">
      <div className="text-sm font-semibold tracking-wide text-slate-400 mb-6">
        MUJIFX RESEARCH
      </div>
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block px-3 py-2 rounded text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
