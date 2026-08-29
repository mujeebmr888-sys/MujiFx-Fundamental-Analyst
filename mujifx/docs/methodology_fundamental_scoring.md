# Fundamental Assessment Methodology (Approved Methodology)

This document specifies, category by category, exactly how each assessment
will be computed: which indicators feed it, what calculations are applied,
what thresholds trigger which label, why each threshold was chosen, how
confidence is determined, how conflicting evidence is handled, and what
data limitations exist today.

**Nothing in this document is decided by AI.** Every rule below is a fixed
threshold or formula written in code. AI is used later, only to translate
the *already-decided* structured result into prose.

Every category output will follow this shape:

```
{
  FACTS: [...],              // raw numbers actually retrieved
  CALCULATIONS: [...],       // derived numbers, each with its formula shown
  INTERPRETATIONS: [...],    // each calculation mapped to a rule-based label
  ASSESSMENT: "Strong" | "Moderate" | "Weak" | ...,
  CONFIDENCE: "High" | "Medium" | "Low" | "Insufficient data",
  EVIDENCE: [...],           // which indicators supported the assessment
  CONFLICTING_EVIDENCE: [...], // anything that pointed the other way
  DATA_LIMITATIONS: [...]    // what we don't have yet, stated honestly
}
```

---

## 1. INFLATION

**Indicators used (already in pipeline):** CPI, Core CPI, PCE, Core PCE, PPI

**Calculations:**
- **MoM change** — latest actual − previous actual (already built, Layer 4)
- **3-month annualized momentum** — `((latest / value_3_releases_ago)^(12/3) − 1) × 100`. This is the standard way inflation desks (e.g. Cleveland Fed, San Francisco Fed) report short-run inflation momentum — not something we invented.
- **6-month annualized momentum** — same formula over 6 releases. Also a standard published convention.
- **YoY change** — `(latest / value_12_releases_ago − 1) × 100`. Standard.
- **Distance from target** — YoY **Core PCE** − 2.0%. We use Core PCE specifically because that is the Fed's own officially stated target gauge (not CPI) — this is a documented fact about Fed policy, not our choice.
- **Momentum direction** — compare 3-month annualized vs 6-month annualized vs YoY to determine accelerating / decelerating / stable.

**Distance-from-target threshold — IMPORTANT CORRECTION:** the ±0.5pp band
is **not treated as an economic fact**. It is a **provisional, configurable
design threshold** (stored as a named constant, easy to change later) used
only as one input among several. The assessment does **not** hinge on this
single band — it weighs **level, momentum, persistence, and historical
context together**, so a reading just outside the band with clearly
decelerating momentum can still land as "Moderate" rather than mechanically
flipping to "Strong."

- "Elevated" (provisional threshold): YoY Core PCE > target + 0.5pp (i.e. > 2.5%)
- "Near target" (provisional threshold): within ±0.5pp of target (1.5%–2.5%)
- "Below target" (provisional threshold): YoY Core PCE < target − 0.5pp (< 1.5%)
- *Why 0.5pp as a starting point?* Several central banks (e.g. the Bank of
  England) use an explicit tolerance band before triggering special
  communication. We use this only as a **default, adjustable** starting
  point — not a claim about what the Fed itself treats as its tolerance.

**Interpretation → Assessment rule:** no single signal decides the outcome
by itself. **Level** (distance from the provisional target band),
**momentum** (accelerating/decelerating), and **persistence** (how many
consecutive releases have moved the same direction) are weighed together:
- **Strong** (elevated inflation pressure): level reads elevated AND
  momentum is accelerating or persistently holding high across multiple
  releases — a single elevated print with immediately decelerating
  momentum will NOT alone trigger "Strong"
- **Weak** (disinflation): level reads below-target AND momentum
  decelerating persistently
- **Moderate**: near target, or level and momentum/persistence disagree
  with each other

**Confidence:**
- High: full 12-month history available for both CPI and Core PCE, and both point the same direction
- Medium: only 3–6 months of history available, or CPI/PCE disagree
- Insufficient data: fewer than 3 stored releases for the relevant series

**Conflicting evidence handling:** If CPI momentum is accelerating while PPI (a leading indicator of future consumer prices) is decelerating, this is flagged explicitly as conflicting rather than averaged away.

**Data limitations (stated honestly, not invented):**
- No component-level breakdown (shelter, services-ex-shelter, energy, food) — "breadth" is therefore a coarse Headline-vs-Core comparison only, explicitly labeled as such, not true component breadth
- No inflation-expectations series yet (FRED does have free breakeven series like T5YIE/T10YIE — could be added in a future milestone, not this one)
- Services/shelter persistence: not available without component data — reported as unavailable, not guessed

---

## 2. EMPLOYMENT

**Indicators used:** NFP, Unemployment Rate, Avg Hourly Earnings, Initial Jobless Claims, Continuing Claims, JOLTS

**Calculations:**
- **NFP trend** — 3-month average payroll change vs 12-month average payroll change (trend-of-trend, relative, not an absolute "good number" — see note below)
- **Unemployment trend** — level change vs 3/6/12-month history
- **Sahm Rule spread (a separate, standalone evidence input — NOT the sole measure of employment strength)** — current 3-month average unemployment rate minus its own lowest 3-month average over the trailing 12 months. This is a well-known **recession/stress indicator** (FRED publishes it as series `SAHMREALTIME`) — it flags acute deterioration, but a *low* Sahm spread does not by itself mean employment is "Strong"; it sits alongside NFP, unemployment, claims, JOLTS, and wages as one more piece of evidence, weighed together rather than gating the outcome.
- **Claims trend** — 4-week moving average of Initial Claims vs its recent range (4-week averaging is standard BLS/DOL practice because weekly claims are volatile)
- **JOLTS trend** — job openings level, 3-month trend direction
- **Wage growth** — Avg Hourly Earnings YoY % vs a documented benchmark of ~3.5% (derived from 2% inflation target + ~1.5% long-run productivity growth — a commonly cited analyst rule of thumb, explicitly flagged as our assumption, not an official Fed number)

**Why NOT an absolute NFP threshold (e.g. "150K is strong"):** the "breakeven" payroll number needed to hold unemployment steady has shifted over time (population growth, immigration trends) and is itself debated among economists. Using a fixed number would be exactly the kind of arbitrary threshold you asked us to avoid. Using **relative trend** (3-month avg vs 12-month avg) avoids that problem.

**Interpretation → Assessment rule:** all five evidence inputs (NFP trend,
unemployment trend, Sahm spread, claims trend, JOLTS trend) are weighed
together — no single one, including Sahm, mechanically decides the label:
- **Strong**: majority of the inputs point to improving/tight labor
  conditions (NFP's recent pace running above its longer-term pace,
  unemployment stable/falling, claims
  low/falling, JOLTS stable/rising), AND the Sahm spread shows no
  recession-level stress
- **Weak**: majority of inputs point to deteriorating conditions, AND/OR
  the Sahm spread crosses its recession-signal level (reported as a
  strong contributing flag, not an automatic override)
- **Moderate**: inputs are mixed

**Confidence:** same High/Medium/Insufficient pattern as Inflation, based on how many months of history exist and whether sub-indicators agree.

**Conflicting evidence handling:** e.g. NFP strong but claims rising — flagged explicitly, not smoothed over.

**Data limitations:**
- No Labor Force Participation Rate, ADP, or ISM employment sub-index in the pipeline yet (would need new FRED series — future milestone)
- NFP revisions: BLS revises the prior 2 months every release; our database currently overwrites rather than preserving pre-revision values, so we cannot yet compute a "revision trend." Stated as a known limitation, not fabricated.

---

## 3. GROWTH

**Indicators used:** GDP (switched to BEA's own pre-computed growth-rate series — see calculation note below), Retail Sales, Industrial Production. (ISM Manufacturing/Services remain unavailable via free official API — documented previously in `docs/DATA_SOURCES.md`.)

**GDP calculation — CORRECTED to avoid double-annualizing:** the original proposal computed our own annualized growth rate from the raw GDP level series using `((latest/previous)^4 − 1) × 100`. On review, this risks confusion because FRED's level series (`GDP`/`GDPC1`) is itself expressed "at a Seasonally Adjusted Annual Rate" (SAAR) — the level is already scaled to represent an annual-equivalent figure. **To eliminate any risk of misapplying the annualization step, we will instead pull FRED series `A191RL1Q225SBEA` directly** — this is BEA's own **pre-computed, already-published** "Real GDP, Percent Change from Preceding Period, Quarterly, SAAR" series. This is the exact figure BEA itself reports as "GDP grew at an annual rate of X%." We do no transformation of our own on this number — it is used as-is, as a FACT sourced directly from BEA via FRED. This is both more accurate and simpler than deriving it ourselves.

**Calculations (Retail Sales / Industrial Production only):**
- **Retail Sales / Industrial Production trend** — 3-month trend vs 6-month/12-month trend direction (relative, same reasoning as Employment above)

**Threshold:**
- Benchmark GDP growth: ~1.8% (CBO's published estimate of long-run US potential GDP growth). Above potential = expansionary/"Strong"; near potential = "Moderate"; below = "Weak". *This number comes from the Congressional Budget Office's own published estimate — a citable Tier-1-adjacent source, not something we made up*, though CBO revises this estimate periodically.

**Interpretation → Assessment rule:**
- **Strong**: GDP growth above potential AND Retail Sales/Industrial Production trends positive
- **Weak**: GDP growth below potential (or contracting) AND Retail Sales/Industrial Production trends negative
- **Moderate**: mixed or near-potential

**Confidence:** Note that GDP is quarterly (slow-moving) while Retail Sales/Industrial Production are monthly — confidence is capped at "Medium" until at least 2 GDP releases are stored, since a single GDP print has limited trend information on its own.

**Data limitations:** No housing-market data, no consumer sentiment data (e.g. University of Michigan survey) in the pipeline yet.

---

## 4. MONETARY POLICY

**Correction: Monetary Policy stance is no longer determined from the Fed Funds Rate alone.** Raw policy-rate facts are kept fully separate from the broader stance assessment, which combines the rate movement with the dual-mandate cross-reference.

**Step 1 — FACTS/CALCULATIONS (Fed Funds Rate only, no labeling yet):**
- Current Fed Funds Rate level
- Change in the rate over the last N releases (basis points moved, and over how many releases)
- This step produces plain numbers only — e.g. *"Fed Funds Rate: 4.33%, unchanged over the last 3 releases"* — no "hawkish"/"dovish"/"tightening" label is attached here.

**Step 2 — INTERPRETATION (a): Rate-only directional read.** A narrow,
mechanical read of the policy rate movement alone, explicitly labeled as
covering the rate only:
- Rising over recent releases → "Rate trend: rising"
- Flat → "Rate trend: flat"
- Falling → "Rate trend: falling"
This is intentionally **not** called "the Fed's stance" — it's one input into Step 3.

**Step 3 — INTERPRETATION (b): Dual-mandate cross-reference.** What the
data implies the Fed's posture *should* be, cross-referencing the already-computed Inflation, Employment, and Growth assessments (this reflects the Fed's real, official dual mandate — price stability + maximum employment — so referencing those category results is methodologically correct, not circular):
- If Inflation = Strong (elevated) and Employment/Growth = Strong → data implies hawkish pressure
- If Inflation = Weak and Employment/Growth = Weak → data implies dovish pressure
- Mixed category results → data implies no clear pressure either way

**Step 4 — ASSESSMENT: Broader Monetary Policy stance (Hawkish/Neutral/Dovish).** This is now explicitly a **combination of Step 2 and Step 3**, not the rate move alone:
- Both the rate-only read (Step 2) and the dual-mandate implication (Step 3) point the same way → stance assessed with that label, e.g. "Hawkish" (rate rising/flat-at-elevated AND data implies hawkish pressure)
- They disagree (e.g. data still implies inflation pressure, but the rate has been falling) → this mismatch is **surfaced explicitly as a tension**, not resolved by picking one side — e.g. *"The policy rate has been easing even though underlying data still implies inflationary pressure — a notable divergence."*

**Confidence:** capped at "Medium" — we do not yet ingest FOMC statement text, minutes, the dot plot, or speeches, so the stance assessment is built only from the rate move plus the dual-mandate cross-reference, not the Fed's own communicated intent. This is stated as a data limitation, not hidden.

**Data limitations:** No FOMC statement text, minutes, dot plot, or speech data yet — those require scraping federalreserve.gov (a distinct future milestone, not this one). "Forward guidance" and "communication tone" are therefore marked unavailable rather than guessed at.

---

## 5. MARKET PRICING

**Indicators used:** 2-Year Treasury Yield, 10-Year Treasury Yield, **US Broad Dollar Index** (the Federal Reserve's own trade-weighted index, series `DTWEXBGS`). **Naming correction:** this is a distinct index from ICE's DXY and must not be called a "DXY proxy" — they use different currency baskets and weightings. If actual DXY data becomes available from a free source later, it will be stored as a separate `DXY` indicator, not merged with this one.

**Calculations:**
- **2Y yield trend** — the front end of the curve is the standard finance-textbook proxy for near-term policy-rate expectations (highly sensitive to expected Fed moves). Treated as the **primary signal** for market-implied policy stance.
- **10Y yield trend** — reflects a broader mix of growth/inflation expectations and term premium, not policy expectations alone. Treated as **context/secondary**, not folded mechanically into the same label as the 2Y.
- **10Y − 2Y spread** — the standard, widely-cited yield-curve recession indicator (the New York Fed publishes a recession-probability model built directly on this exact spread).
- **US Broad Dollar Index trend** — treated as a **market outcome to be explained**, not itself a policy-expectation input. The dollar can move for reasons unrelated to US rate expectations (foreign central bank actions, risk sentiment, capital flows), so it is not averaged together with the yield-based signal to produce the label.

**Interpretation → Assessment rule (revised):**
- The **primary Hawkish/Dovish/Neutral label** comes from the 2Y yield trend alone (rising → Hawkish-leaning market pricing; falling → Dovish-leaning; flat → Neutral), with the 10Y trend and the 10Y−2Y spread reported alongside as **context** (e.g. "curve is also steepening/flattening, consistent with/divergent from the 2Y-implied stance").
- The US Broad Dollar Index trend is then compared **separately** against the 2Y-implied stance:
  - If the dollar moves in the direction consistent with the 2Y-implied stance (e.g. 2Y rising and dollar also rising) → reported as **"confirmed by the dollar market."**
  - If they diverge (e.g. 2Y rising but the dollar is falling) → this is **explicitly surfaced as a disagreement**, along with a short list of **documented, non-definitive candidate explanations** pulled from standard FX theory (e.g. offsetting moves in foreign-currency rate expectations, broader risk-on/risk-off flows, capital-flow dynamics) — labeled clearly as *possible explanations, not confirmed causes*, since we don't yet have the cross-market data to confirm which one applies.
- This replaces the earlier mechanical "2Y + dollar both rising = Hawkish" rule, which conflated a policy-expectations signal with a market-outcome signal.

---

## 6. RISK ENVIRONMENT

**Indicator used (per your approval): VIX** (FRED series `VIXCLS`, free, official CBOE data distributed via FRED)

**This category is explicitly architected to add more indicators later** (broad equity-market condition, volatility trend, credit spreads) without changing its output shape — only VIX feeds it today, and confidence reflects that honestly.

**Calculation:** VIX level vs its own recent stored range, plus these widely-used (not invented by us) industry convention bands:
- < 15: Low volatility / complacency
- 15–20: Normal
- 20–30: Elevated risk aversion
- \> 30: High stress

*(These bands are extremely common across trading-desk and financial-media commentary; there is no single official body that defines them, so this is flagged as "market convention," not an official target — same honesty standard as the other thresholds above.)*

**Assessment rule:**
- **Risk-On**: VIX low and/or falling
- **Risk-Off**: VIX high and/or rising
- **Neutral**: in between

**Confidence: capped at "Low"** for now, with an explicit note: *"Based on VIX only — full risk environment (equities, credit spreads) not yet integrated."* This directly satisfies your requirement to not pretend partial evidence is complete.

**Important design note:** Risk Environment will **not** be mechanically scored into the Overall USD Condition as simply bullish/bearish, because risk-off conditions can be USD-supportive (safe-haven flows) or USD-negative depending on the broader regime — that relationship isn't stable enough to hardcode without overclaiming. It will be shown as **context alongside** the Overall Condition, not as a numeric input to it.

---

## ORCHESTRATION: Overall USD Fundamental Condition

**Explicitly NOT an average of six scores.** The overall assessment considers:
- Inflation
- Employment
- Growth
- Monetary Policy
- Market Pricing
- Cross-category relationships between all of the above
- Contradictions between them

**Risk Environment remains contextual**, reported alongside the Overall
Condition rather than folded into it, for the reasons explained in Section 6.

The rule table:

1. Count how many of {Inflation, Employment, Growth} are "Strong" vs "Weak", and note Monetary Policy stance and Market Pricing stance.
2. **Coherent hawkish case**: majority of Inflation/Employment/Growth = Strong, Monetary Policy = Tightening/Hawkish-hold, Market Pricing = Hawkish-leaning → **Overall: Strong**, no major contradiction flagged.
3. **Fundamentals-vs-pricing contradiction**: majority Strong/Hawkish fundamentals, but Market Pricing = Dovish-leaning (yields falling despite strong data) → **Overall: Moderate**, with an explicit flag: *"Fundamental data remains supportive, but market pricing is not confirming the macro picture."* (This is the exact example you gave.)
4. **Coherent dovish case**: majority Weak, Monetary Policy = Easing, Market Pricing = Dovish-leaning → **Overall: Weak**.
5. **Genuinely split** (no majority either way) → **Overall: Neutral**, with each disagreeing category listed individually rather than forced into one direction.

---

## Architecture Confirmation

The pipeline stays exactly:

```
FACT → CALCULATION → INTERPRETATION → ASSESSMENT → CONFIDENCE → EVIDENCE → CONFLICTING EVIDENCE → DATA LIMITATIONS
```

Each category module's output object holds these as named arrays/fields
(`FACTS`, `CALCULATIONS`, `INTERPRETATIONS`, `ASSESSMENT`, `CONFIDENCE`,
`EVIDENCE`, `CONFLICTING_EVIDENCE`, `DATA_LIMITATIONS`) so every assessment
is traceable back to the specific data and rule that produced it — nothing
is collapsed into a single opaque string.

---

## One Remaining Open Decision For You

**Employment**: pull FRED's official pre-calculated `SAHMREALTIME` (Sahm Rule) series directly, instead of us computing our own version from the unemployment rate? (Cleaner, Tier-1 sourced, one extra series to add — and it's now scoped correctly as one input among several, not a gate.)

Everything else above reflects your corrections and is ready to implement once you approve.
