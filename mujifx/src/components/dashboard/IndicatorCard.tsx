import type { IndicatorMeta } from "@/config/indicators";

interface IndicatorRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  source_name: string;
  available: boolean;
  unavailable_reason: string | null;
}

export default function IndicatorCard({
  meta,
  row,
}: {
  meta: IndicatorMeta;
  row: IndicatorRow | undefined;
}) {
  const momChange =
    row?.actual != null && row?.previous != null
      ? Math.round((row.actual - row.previous) * 1000) / 1000
      : null;

  const trendColor =
    momChange === null
      ? "text-slate-500"
      : momChange > 0
      ? "text-emerald-400"
      : momChange < 0
      ? "text-red-400"
      : "text-slate-400";

  const trendArrow = momChange === null ? "" : momChange > 0 ? "▲" : momChange < 0 ? "▼" : "→";

  return (
    <div className="border border-slate-800 rounded-lg p-5 bg-slate-900/50">
      <div className="text-xs text-slate-400 mb-1">{meta.label}</div>

      {row && row.available && row.actual !== null ? (
        <>
          <div className="text-2xl font-semibold">
            {row.actual}
            {meta.unitSuffix && (
              <span className="text-base text-slate-400 ml-1">
                {meta.unitSuffix}
              </span>
            )}
          </div>
          {momChange !== null && (
            <div className={`text-xs mt-1 ${trendColor}`}>
              {trendArrow} {momChange > 0 ? "+" : ""}
              {momChange} vs previous
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-2 truncate">
            {row.period_covered} · {row.source_name}
          </div>
        </>
      ) : (
        <div className="text-slate-600 text-sm italic">
          Data unavailable / source not verified.
        </div>
      )}
    </div>
  );
}
