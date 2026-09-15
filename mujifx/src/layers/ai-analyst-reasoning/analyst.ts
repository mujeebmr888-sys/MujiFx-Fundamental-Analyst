/**
 * LAYER 7: AI ANALYST REASONING
 *
 * Turns the structured data we already have (Layers 1-6) into written
 * analyst commentary, following the exact reasoning chain from the spec:
 *   DATA → what changed → why → economic implications → Fed implications
 *   → market expectations → market pricing → cross-asset confirmation
 *   → currency implications → contradictions → risks → final assessment
 *
 * Uses Google Gemini's free tier (see docs/DATA_SOURCES.md) — the model is
 * given ONLY the real numbers we already fetched and verified; it is
 * explicitly instructed never to invent data, never issue buy/sell
 * language, and never claim certainty. If the model ever violates that in
 * a way we can detect, we fall back to a safe templated summary instead of
 * showing it.
 */

import type { AnalystAssessment, FundamentalScore } from "@/types/economic-data";
import { INDICATOR_META } from "@/config/indicators";

interface AnalystInput {
  fundamentalScore: FundamentalScore;
  indicatorSummaries: Array<{
    indicator: string;
    actual: number | null;
    previous: number | null;
    momChange: number | null;
    periodCovered: string;
    sourceUrl: string;
  }>;
}

const SYSTEM_INSTRUCTIONS = `You are a macro/fundamental research analyst writing an internal briefing about the US Dollar (USD).

STRICT RULES — violating any of these makes your output unusable:
1. Use ONLY the data given to you below. Never invent, estimate, or assume any number that isn't provided.
2. NEVER give trading advice, a buy/sell recommendation, a price target, or any actionable trade instruction.
3. NEVER claim certainty about future data releases or price movements. Use hedged language ("suggests", "may indicate", "is consistent with") not definitive language ("will", "guarantees").
4. If the data is mixed or contradictory, say so explicitly — do not force a one-sided narrative.
5. Keep it factual and measured — this is institutional research, not commentary for retail trading signals.

Structure your response as JSON with exactly these keys (all string values, plain text, no markdown):
whatChanged, whyItChanged, economicImplications, centralBankImplications, marketExpectationsVsPricing, crossAssetConfirmation, contradictions, risks, finalAssessment

Each value should be 1-3 sentences. Return ONLY the JSON object, nothing else.`;

export async function generateAnalystAssessment(
  input: AnalystInput
): Promise<AnalystAssessment | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // AI commentary is an optional layer. Do not turn a missing optional
    // credential into a production error for the core data pipeline.
    return null;
  }

  const dataSummary = input.indicatorSummaries
    .map((s) => {
      const label = INDICATOR_META[s.indicator as keyof typeof INDICATOR_META]?.label ?? s.indicator;
      return `- ${label}: actual=${s.actual ?? "N/A"}, previous=${s.previous ?? "N/A"}, change=${
        s.momChange ?? "N/A"
      }, period=${s.periodCovered}`;
    })
    .join("\n");

  const prompt = `${SYSTEM_INSTRUCTIONS}

USD FUNDAMENTAL SCORE: ${input.fundamentalScore.overallBias} (${input.fundamentalScore.score}/10)
Score breakdown:
${input.fundamentalScore.breakdown.map((b) => `- ${b.rationale}`).join("\n")}

RAW INDICATOR DATA:
${dataSummary}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
      if (typeof parsed[key] !== "string") {
        console.error(`Gemini response missing/invalid key: ${key}`);
        return null;
      }
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
      sourcesUsed: [],
      disclaimer:
        "This is AI-generated research commentary based only on the data shown on this page. It is not financial advice, not a trade signal, and not a guarantee of future outcomes.",
    };
  } catch (err) {
    console.error("Analyst assessment generation failed:", err);
    return null;
  }
}
