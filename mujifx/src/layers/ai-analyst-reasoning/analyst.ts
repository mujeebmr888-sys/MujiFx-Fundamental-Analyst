/**
 * LAYER 7: AI ANALYST REASONING
 *
 * Turns the structured assessment Layers 1-6 already produced into written
 * analyst commentary, following the reasoning chain from the spec:
 *   DATA -> what changed -> why -> economic implications -> Fed implications
 *   -> market expectations -> market pricing -> cross-asset confirmation
 *   -> contradictions -> risks -> final assessment
 *
 * ---------------------------------------------------------------------
 * REWIRED (fixed bug)
 * ---------------------------------------------------------------------
 * This layer used to be handed the LEGACY quick score from scoring.ts -
 * a single -10..+10 number built from month-over-month moves of a few
 * series, two of which were index levels that rise almost every month.
 * The written note therefore described a number the rest of the system
 * does not consider authoritative, and had no access to the category
 * engines' evidence, contradictions or confidence.
 *
 * It is now handed the orchestrator's UsdFundamentalAssessment: the real
 * engine output, including every category's own label, confidence,
 * evidence, conflicting evidence and stated data limitations. The model
 * writes prose ABOUT that structure - it does not produce any verdict of
 * its own, and every label it can mention already exists in the input.
 *
 * The model is explicitly instructed never to invent data, never issue
 * buy/sell language, and never claim certainty. If output fails
 * validation, nothing is saved rather than showing a malformed or
 * unverifiable result.
 */

import type { AnalystAssessment, DataSourceRef } from "@/types/economic-data";
import type { UsdFundamentalAssessment } from "@/types/assessment";

export interface AnalystInput {
  assessment: UsdFundamentalAssessment;
  /**
   * The raw latest observations already verified by Layer 1-3, so the
   * model can name actual numbers instead of speaking only in labels.
   * Every entry must be a real stored row - never a placeholder.
   */
  indicatorFacts: Array<{
    label: string;
    actual: number | null;
    previous: number | null;
    periodCovered: string;
    /** The provenance actually stored with the row - never synthesised. */
    source: DataSourceRef;
  }>;
}

const SYSTEM_INSTRUCTIONS = `You are a macro/fundamental research analyst writing an internal briefing about the US Dollar (USD).

You are summarising an assessment that has ALREADY been produced by a deterministic rules engine. Your job is to explain it in plain English - not to reach your own verdict.

STRICT RULES - violating any of these makes your output unusable:
1. Use ONLY the data and assessment given to you below. Never invent, estimate, or assume any number, date, or category label that isn't provided.
2. NEVER give trading advice, a buy/sell recommendation, a price target, or any actionable trade instruction.
3. NEVER claim certainty about future data releases or price movements. Use hedged language ("suggests", "may indicate", "is consistent with") not definitive language ("will", "guarantees").
4. NEVER contradict or override the engine's overall condition or any category label. If you think the data points elsewhere, say so in "contradictions" - do not change the verdict.
5. The listed conflicting evidence MUST appear in your "contradictions" field. Do not smooth it over or force a one-sided narrative. If the engine listed no conflicts, say that plainly.
6. Reflect the stated confidence honestly. If confidence is Low or "Insufficient data", say the picture is provisional and why.
7. Risk Environment is context only. Do not translate Risk-Off into USD strength or Risk-On into USD weakness.
8. Frame everything as an assessment of current conditions ("USD fundamental condition assessed as X"), never as a prediction ("the USD will rise").

Structure your response as JSON with exactly these keys (all string values, plain text, no markdown):
whatChanged, whyItChanged, economicImplications, centralBankImplications, marketExpectationsVsPricing, crossAssetConfirmation, contradictions, risks, finalAssessment

Each value should be 1-3 sentences. Return ONLY the JSON object, nothing else.`;

/** Renders one category's engine output as plain text for the prompt. */
function describeCategory(
  name: string,
  category: {
    assessment: string;
    confidence: string;
    evidence: string[];
    conflictingEvidence: string[];
    dataLimitations: string[];
  }
): string {
  const lines = [`${name}: ${category.assessment} (confidence: ${category.confidence})`];
  for (const item of category.evidence) lines.push(`    supporting: ${item}`);
  for (const item of category.conflictingEvidence) lines.push(`    conflicting: ${item}`);
  for (const item of category.dataLimitations) lines.push(`    limitation: ${item}`);
  return lines.join("\n");
}

export async function generateAnalystAssessment(
  input: AnalystInput
): Promise<AnalystAssessment | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // AI commentary is an optional layer. Do not turn a missing optional
    // credential into a production error for the core data pipeline.
    return null;
  }

  const { assessment } = input;
  const c = assessment.categories;

  const categoryBlock = [
    describeCategory("Inflation", c.inflation),
    describeCategory("Employment", c.employment),
    describeCategory("Growth", c.growth),
    describeCategory("Monetary Policy", c.monetaryPolicy),
    describeCategory("Market Pricing", c.marketPricing),
    describeCategory("Risk Environment (CONTEXT ONLY)", c.riskEnvironment),
  ].join("\n\n");

  const factBlock =
    input.indicatorFacts.length > 0
      ? input.indicatorFacts
          .map(
            (f) =>
              `- ${f.label}: actual=${f.actual ?? "N/A"}, previous=${f.previous ?? "N/A"}, period=${f.periodCovered}, source=${f.source.name}`
          )
          .join("\n")
      : "No stored observations available. Do not invent any numbers; describe the assessment in qualitative terms only.";

  const orchestrationBlock = [
    `Overall USD Fundamental Condition: ${assessment.overallCondition}`,
    `Overall confidence: ${assessment.confidence}`,
    `Decision rule applied: ${assessment.rationale}`,
    "",
    "Supporting evidence at the overall level:",
    ...assessment.evidence.map((e) => `- ${e}`),
    "",
    "Conflicting evidence at the overall level (MUST be reflected in your contradictions field):",
    ...(assessment.conflictingEvidence.length > 0
      ? assessment.conflictingEvidence.map((e) => `- ${e}`)
      : ["- none recorded"]),
    "",
    "Overall data limitations:",
    ...assessment.dataLimitations.map((e) => `- ${e}`),
  ].join("\n");

  const prompt = `${SYSTEM_INSTRUCTIONS}

=== ENGINE ASSESSMENT (authoritative - do not override) ===
${orchestrationBlock}

=== CATEGORY ENGINE OUTPUT ===
${categoryBlock}

=== VERIFIED LATEST OBSERVATIONS ===
${factBlock}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini API error:", res.status, await res.text());
      return null;
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini returned no text.");
      return null;
    }

    const parsed = JSON.parse(text);

    const requiredKeys = [
      "whatChanged",
      "whyItChanged",
      "economicImplications",
      "centralBankImplications",
      "marketExpectationsVsPricing",
      "crossAssetConfirmation",
      "contradictions",
      "risks",
      "finalAssessment",
    ];
    for (const key of requiredKeys) {
      if (typeof parsed[key] !== "string" || parsed[key].trim().length === 0) {
        console.error(`Gemini response missing/invalid key: ${key}`);
        return null;
      }
    }

    // Reject trade-signal language outright rather than publishing it and
    // hoping nobody notices. This is a research product, not a signal feed.
    const combined = requiredKeys.map((k) => parsed[k]).join(" ").toLowerCase();
    const bannedPhrases = [
      "buy usd",
      "sell usd",
      "go long",
      "go short",
      "price target",
      "entry point",
      "stop loss",
      "take profit",
      "recommend buying",
      "recommend selling",
    ];
    const violation = bannedPhrases.find((phrase) => combined.includes(phrase));
    if (violation) {
      console.error(`Gemini output contained trade-signal language ("${violation}") - discarded.`);
      return null;
    }

    return {
      currency: "USD",
      generatedAt: new Date().toISOString(),
      whatChanged: parsed.whatChanged,
      whyItChanged: parsed.whyItChanged,
      economicImplications: parsed.economicImplications,
      centralBankImplications: parsed.centralBankImplications,
      marketExpectationsVsPricing: parsed.marketExpectationsVsPricing,
      crossAssetConfirmation: parsed.crossAssetConfirmation,
      contradictions: parsed.contradictions,
      risks: parsed.risks,
      finalAssessment: parsed.finalAssessment,
      // Deduplicated by source URL so the note carries real, checkable
      // provenance for every number it was allowed to see.
      sourcesUsed: Array.from(
        new Map(input.indicatorFacts.map((f) => [f.source.url, f.source])).values()
      ),
      disclaimer:
        "This is AI-generated commentary describing a deterministic rules-based assessment. It is not financial advice, not a trade signal, and not a guarantee of future outcomes.",
    };
  } catch (err) {
    console.error("Analyst assessment generation failed:", err);
    return null;
  }
}
