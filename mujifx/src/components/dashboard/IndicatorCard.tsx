import type { IndicatorMeta } from "@/config/indicators";

interface IndicatorRow {
  actual: number | null;
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
