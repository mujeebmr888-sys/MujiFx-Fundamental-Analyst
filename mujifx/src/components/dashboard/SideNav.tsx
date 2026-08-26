const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "USD", href: "/usd" },
  { label: "Inflation", href: "/usd/inflation" },
  { label: "Employment", href: "/usd/employment" },
  { label: "Growth", href: "/usd/growth" },
  { label: "Federal Reserve", href: "/usd/fed" },
  { label: "Market", href: "/usd/market" },
  { label: "Forecasts", href: "/usd/forecasts" },
  { label: "Research", href: "/usd/research" },
];

export default function SideNav() {
  return (
    <nav className="w-56 shrink-0 border-r border-slate-800 h-screen p-4">
      <div className="text-sm font-semibold tracking-wide text-slate-400 mb-6">
        MUJIFX RESEARCH
      </div>
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="block px-3 py-2 rounded text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
