import type { FundamentalScore } from "@/types/economic-data";
import { INDICATOR_META } from "@/config/indicators";

const BIAS_STYLES: Record<
  FundamentalScore["overallBias"],
  { label: string; color: string; bg: string }
> = {
  bullish: { label: "Bullish", color: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-900" },
  bearish: { label: "Bearish", color: "text-red-400", bg: "bg-red-950/40 border-red-900" },
  neutral: { label: "Neutral", color: "text-slate-300", bg: "bg-slate-900/50 border-slate-800" },
  mixed: { label: "Mixed / Conflicting", color: "text-amber-400", bg: "bg-amber-950/30 border-amber-900" },
};

export default function FundamentalBiasCard({ score }: { score: FundamentalScore }) {
  const style = BIAS_STYLES[score.overallBias];

  return (
    <div className={`border rounded-lg p-6 mb-10 ${style.bg}`}>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          USD Fundamental Bias
        </h2>
        <span className="text-xs text-slate-500">
          Rules-based score, not a trade signal
        </span>
      </div>

      <div className="flex items-baseline gap-3 mb-4">
        <span className={`text-3xl font-bold ${style.color}`}>{style.label}</span>
        <span className="text-slate-500 text-sm">score: {score.score} / 10</span>
      </div>

      <div className="space-y-1.5">
        {score.breakdown.map((item) => (
          <div key={item.indicator} className="text-xs text-slate-400 flex gap-2">
            <span className="text-slate-600 shrink-0">
              [{INDICATOR_META[item.indicator]?.label ?? item.indicator}]
            </span>
            <span>{item.rationale}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-600 mt-4 italic">
        This score mechanically combines a few widely-known macro
        relationships from data already shown below. It does not predict
        price movement, incorporate every relevant factor, or account for
        market positioning — treat it as a structured summary, not advice.
      </p>
    </div>
  );
}
