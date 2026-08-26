# Data Sources (Free-first, Tier 1 official sources)

| Indicator | Source | Free API | Series ID example |
|---|---|---|---|
| CPI / Core CPI | BLS (via FRED) | FRED API | CPIAUCSL, CPILFESL |
| PCE / Core PCE | BEA (via FRED) | FRED API | PCE, PCEPILFE |
| PPI | BLS (via FRED) | FRED API | PPIACO |
| Nonfarm Payrolls | BLS (via FRED) | FRED API | PAYEMS |
| Unemployment Rate | BLS (via FRED) | FRED API | UNRATE |
| Avg Hourly Earnings | BLS (via FRED) | FRED API | CES0500000003 |
| Initial Jobless Claims | DOL (via FRED) | FRED API | ICSA |
| Continuing Claims | DOL (via FRED) | FRED API | CCSA |
| JOLTS | BLS (via FRED) | FRED API | JTSJOL |
| GDP | BEA (via FRED) | FRED API | GDP, GDPC1 |
| Retail Sales | Census (via FRED) | FRED API | RSAFS |
| Industrial Production | Federal Reserve (via FRED) | FRED API | INDPRO |
| ISM Manufacturing/Services | ISM | No free official API — see note below |
| Federal Funds Rate | Federal Reserve (via FRED) | FRED API | DFF, FEDFUNDS |
| FOMC statements/speeches | federalreserve.gov | Public site, scrape/parse text |
| 2Y / 10Y Treasury Yield | US Treasury / FRED | FRED API or treasury.gov | DGS2, DGS10 |
| DXY | ICE (via free market data proxy) | See note below |

## Notes

- **FRED (Federal Reserve Economic Data)** from the St. Louis Fed is our workhorse:
  it re-publishes official BLS/BEA/Fed/Treasury data through one consistent, free
  API. Free registration required for an API key (no cost, no card).
  https://fred.stlouisfed.org/docs/api/fred/
- **ISM data** is copyrighted by the Institute for Supply Management and is not
  freely republishable via API. For V1 we will either (a) manually log the
  headline number with a source citation each release, or (b) skip ISM until we
  evaluate a compliant source. We will NOT scrape it — this would create data
  integrity/legal risk.
- **DXY** is a proprietary ICE index. As a free-tier substitute we can compute our
  own trade-weighted USD proxy from FRED's own broad dollar index (`DTWEXBGS`),
  which is free and officially published by the Fed. This should be clearly
  labeled in the UI as "Fed Broad Dollar Index" rather than "DXY" to stay accurate.
- **FOMC statements/speeches** have no structured API; V1 will fetch and parse the
  public HTML/PDF from federalreserve.gov directly.

## Action needed from you (non-technical)

1. Go to https://fred.stlouisfed.org/docs/api/api_key.html and register for a free
   FRED API key (just an email address, takes 2 minutes).
2. Once you have it, tell me and I'll show you exactly where to put it (as a
   secret, never hardcoded in code).
