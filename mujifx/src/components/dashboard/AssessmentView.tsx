/**
 * Renders ONE category assessment (or the overall condition) with its full
 * traceable chain intact:
 *   FACT → CALCULATION → INTERPRETATION → ASSESSMENT → CONFIDENCE →
 *   EVIDENCE → CONFLICTING EVIDENCE → DATA LIMITATIONS
 *
 * Nothing is collapsed into a single opaque sentence — the point of the
 * engines is that every label is checkable, so the UI shows the formula
 * and the rule text alongside the result.
 */

import type {
  AssessmentCalculation,
  AssessmentFact,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";

const LABEL_STYLES: Record<string, string> = {
  Strong: "text-emerald-400",
  Hawkish: "text-emerald-400",
  Moderate: "text-amber-400",
  Neutral: "text-slate-300",
  "Risk-On": "text-emerald-400",
  "Risk-Off": "text-red-400",
  Weak: "text-red-400",
  Dovish: "text-red-400",
};

const CONFIDENCE_STYLES: Record<ConfidenceLevel, string> = {
  High: "text-emerald-400 border-emerald-900 bg-emerald-950/30",
  Medium: "text-amber-400 border-amber-900 bg-amber-950/30",
  Low: "text-orange-400 border-orange-900 bg-orange-950/30",
  "Insufficient data": "text-slate-400 border-slate-700 bg-slate-900/50",
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-slate-600 italic">{text}</p>;
}

function Bullets({ items, tone }: { items: string[]; tone?: "warn" }) {
  if (items.length === 0) return <EmptyNote text="None recorded." />;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={`text-sm leading-relaxed pl-3 border-l-2 ${
            tone === "warn"
              ? "border-amber-800 text-amber-200/90"
              : "border-slate-800 text-slate-300"
          }`}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export interface AssessmentLike {
  asOf: string;
  facts: AssessmentFact[];
  calculations: AssessmentCalculation[];
  interpretations: AssessmentInterpretation[];
  confidence: ConfidenceLevel;
  evidence: string[];
  conflictingEvidence: string[];
  dataLimitations: string[];
}

export default function AssessmentView({
  title,
  label,
  assessment,
  rationale,
}: {
  title: string;
  /** The category's own verdict word, e.g. "Strong" / "Hawkish" / "Risk-Off". */
  label: string;
  assessment: AssessmentLike;
  /** Only the orchestrator has one — which named rule fired and why. */
  rationale?: string;
}) {
  const labelColor = LABEL_STYLES[label] ?? "text-slate-200";

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4 mb-6 border-b border-slate-800">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
            {title}
          </h2>
          <span className={`text-2xl font-bold ${labelColor}`}>{label}</span>
        </div>
        <span
          className={`text-[11px] px-2 py-1 rounded border ${CONFIDENCE_STYLES[assessment.confidence]}`}
        >
          Confidence: {assessment.confidence}
        </span>
      </div>

      {rationale && (
        <p className="text-sm text-slate-200 leading-relaxed mb-6">{rationale}</p>
      )}

      <Block title="Facts (as retrieved, uninterpreted)">
        {assessment.facts.length === 0 ? (
          <EmptyNote text="No raw facts at this layer — its inputs are the category assessments themselves." />
        ) : (
          <div className="space-y-1.5">
            {assessment.facts.map((fact, i) => (
              <div key={i} className="text-sm text-slate-300 flex flex-wrap gap-x-2">
                <span className="text-slate-500">{fact.label}:</span>
                <span className="font-medium">
                  {fact.value ?? "unavailable"}
                  {fact.unit ? ` ${fact.unit}` : ""}
                </span>
                {fact.periodCovered && (
                  <span className="text-slate-600 text-xs self-center">
                    ({fact.periodCovered})
                  </span>
                )}
                {fact.source?.url && (
                  
                    href={fact.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs self-center text-slate-500 hover:text-slate-300 underline decoration-dotted"
                  >
                    {fact.source.name}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Calculations (formula shown so they're checkable)">
        {assessment.calculations.length === 0 ? (
          <EmptyNote text="None." />
        ) : (
          <div className="space-y-2">
            {assessment.calculations.map((calc, i) => (
              <div key={i} className="text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <span className="text-slate-400">{calc.label}:</span>
                  <span className="font-medium text-slate-100">
                    {calc.result ?? "unavailable"}
                  </span>
                </div>
                <code className="block text-[11px] text-slate-600 font-mono mt-0.5">
                  {calc.formula}
                </code>
                {calc.unavailableReason && (
                  <p className="text-[11px] text-amber-500/80 mt-0.5">
                    {calc.unavailableReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Interpretations (the exact rule applied)">
        {assessment.interpretations.length === 0 ? (
          <EmptyNote text="None." />
        ) : (
          <div className="space-y-2.5">
            {assessment.interpretations.map((interp, i) => (
              <div key={i} className="text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <span className="text-slate-400">{interp.label}:</span>
                  <span className="font-medium text-slate-100">{interp.result}</span>
                  {interp.isProvisionalThreshold && (
                    <span className="text-[10px] self-center px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      provisional threshold
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {interp.rule}
                </p>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Supporting evidence">
        <Bullets items={assessment.evidence} />
      </Block>

      <Block title="Conflicting evidence (never hidden)">
        <Bullets items={assessment.conflictingEvidence} tone="warn" />
      </Block>

      <Block title="Data limitations">
        <Bullets items={assessment.dataLimitations} />
      </Block>

      <p className="text-[11px] text-slate-600 pt-4 border-t border-slate-800">
        Generated {new Date(assessment.asOf).toLocaleString()}. This is an
        analytical assessment of current conditions, not a forecast of price
        movement and not a trade signal.
      </p>
    </div>
  );
}
