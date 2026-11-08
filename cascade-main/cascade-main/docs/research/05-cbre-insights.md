# 05 — CBRE insights (verified) and CBRE Smart FM

**Scope:** what CBRE's own 2025–26 data center publications say (quotes re-verified, §1–10), plus CBRE's published facilities-management claims (Smart FM, §11). **Researched:** 2026-11-07/08.

Source for §1–10: CBRE's data center insights listing, https://www.cbre.com/insights/data-center, read 2026-11-07/08.
Nine articles were read in full. Seventeen claims drawn from them were then re-checked against the pages by a second, independent read, and are quoted verbatim below.
**Verified** = the exact quote was found on the cited page. **Corrected** = the first read got it wrong; the corrected value is shown. **[INFERENCE]** = our reasoning, not something CBRE states.

CBRE is a brokerage and advisory firm that sells leasing and services to the developers it writes about, so its market narrative leans pro-development. The figures below are primary-market wholesale data, not site-level or retail colocation pricing.

## Sources

| Ref | Article | Date | URL |
|---|---|---|---|
| A | Reducing Risk Through Strategic Project Delivery: Lessons from a Live Data Center | 2026-04-24 | https://www.cbre.com/insights/articles/reducing-risk-through-strategic-project-delivery |
| B | North America Data Center Trends H1 2026 | 2026-08-27 | https://www.cbre.com/insights/books/north-america-data-center-trends-h1-2026 |
| C | 2026 North American Data Center Investor Intentions Survey | 2026-04-21 | https://www.cbre.com/insights/briefs/2026-north-american-data-center-investor-intentions-survey |
| D | North America Data Center Trends H2 2025 | 2026-02-25 | https://www.cbre.com/insights/books/north-america-data-center-trends-h2-2025 |
| E | Global Data Center Trends 2026 | 2026-06-17 | https://www.cbre.com/insights/reports/global-data-center-trends-2026 (page text truncated at ~40k of 53k characters; the claims below are in the part that was read) |
| F | AI Necessitates New Blueprint for Digital Infrastructure | 2025-11-03 | https://www.cbre.com/insights/briefs/ai-necessitates-new-blueprint-for-digital-infrastructure |
| G | CBRE Data Center Solutions (service page) | n/a | https://www.cbre.com/services/property-types/data-center |

Also read, not re-verified: European Data Centres Figures Q2 2026 (full report gated behind a form), Benefits Far Outweigh Drawbacks of Rising Data Center Development (advocacy piece), North America Data Center Trends H1 2025.

## 1. CBRE describes managing redundancy in live facilities by hand (A)

The closest match to Cascade's job in the whole set.

- Live projects carry special risk: "These projects, delivered in a “live” data center environment, introduce critical risk factors".
- **Recommended, not described as standard practice:** "We suggest using a Gantt Chart that aligns to the project program", showing "the levels of redundancy available at every stage of the project."
- Temporary backup equipment is something to assess, not always added: "whether additional temporary equipment that provides redundancy capacity is required throughout the project duration".
- SLA impact: "We recommend create a cause and effect matrix for each potential SLA affected" (CBRE's wording). The example: "Power: an uptime commitment for redundant power (A+B power)". On breach, "the penalty or commercial credit can be applied to the data center owner."
- Also: "complete a resilience register, which can then be incorporated in the project execution plan"; "Set up weekly whiteboard sessions with the operations team to review the four week look ahead for the project"; constraints include "restriction periods and durations such as change freeze."

**[INFERENCE]** Cascade's what-if engine computes these artifacts: redundancy remaining at each phase, which A+B commitments are at risk, revenue exposed. They could be generated from the dependency model instead of spreadsheets.

## 2. Market: tight supply, power-constrained (B, C, D, E)

- Vacancy: "primary market vacancy fell to a record low of 1.4% in H1 from 1.6% in H1 2025" (B). The H2 2025 book also reported 1.4% at year-end (D), so the record is not new in H1 2026.
- Preleasing: "commitments made on 80.4% of all under-construction capacity, compared with 74.3% a year ago." "Less than 1,500 MW of future capacity across all primary markets remains available", "representing approximately six months of demand at the current absorption rate." (B)
- Power: "For the third consecutive year, power availability was cited as the top challenge facing the data center industry." (C) "Grid-power capacity for existing projects is largely booked through 2030 in most markets." (D)

## 3. Work inside existing facilities is getting slower (B)

- "For air-cooled data centers requiring conversion to liquid cooling, delays can extend beyond six months."
- "RFS fit-out dates are expanding from weeks to several months" (RFS = ready for service).

**[INFERENCE]** Operators who cannot get new power will do more retrofit and densification inside live sites, and more change in live sites means more ways for redundancy to break silently. Not stated by CBRE.

## 4. Dallas–Fort Worth (C, E)

- "Dallas-Ft. Worth is the most attractive market for 78% of data center investors this year", "slightly edging out Northern Virginia (72%)". (C)
- "Dallas-Ft. Worth fell to a record-low 1.8% from 2.4%." "The market's record-high 716.7 MW of data center space under construction was 88% preleased". (E)

## 5. Investors and value-add (C)

- "Value-add strategies were most attractive for 28%, up from 15% in the 2025 survey."

**[INFERENCE]** Investors buying existing facilities receive data rooms full of registers, single-line diagrams and contracts, and need to know whether the redundancy is real before buying. A possible second buyer for a one-off document-driven audit. Untested.

## 6. Contracts and power sources are changing (B, D)

- Take-or-pay: "are becoming increasingly common in the U.S., with minimum utilization levels ranging from 60% to 85% of allocated power." (B)
- "Bridging power solutions are gaining traction nationwide" (B, under "On-Site Power & Bring Your Own Power Solutions").
- "Hybrid power systems that combine batteries and natural gas turbines are reducing reliance on diesel backup generators." "BYOP and on-site generation (including batteries and gas turbines) are becoming routine" (D).

Implications for Cascade: the dependency model needs battery, gas-turbine and bridging-power source types; revenue exposure should account for take-or-pay minimums separately from SLA credits.

## 7. Redundancy is a baseline expectation (F)

- "Dual feeds, backup generation and uninterruptible power supply (UPS) redundancy are expected." (F, November 2025, about AI/neocloud occupiers)

## 8. Pricing anchors (E) — corrected

- **Corrected.** "Chicago had the highest rental rates, ranging from $200 to $230 per kW/month for a 250-to-500-kW requirement", "followed by Northern Virginia with a broader price range of $190 to $235".
- E does not state a tier for these figures. The "N+1/Tier III" footnote appears on the asking-rate series in B and D, not in E.

Usable as a sourced default for Cascade's revenue-exposed assumption, with the caveat that these are wholesale asking rates.

Earlier CBRE pricing figures (not re-verified by the second read) are in `06-cooling-physics.md` P58–P60: "$200+ per kW per month" asking rate for 250+ kW at N+1/Tier III with 1.6% vacancy (H1 2025), $194.95/kW-month average lease (+6.5% YoY, via MBA NewsLink snippet), and $217.30/kW-month global (Q1 2025, snippet). The H1 2025 1.6% vacancy matches the "from 1.6% in H1 2025" baseline in §2.

## 9. CBRE as customer or channel (G)

- "Our lifecycle data center service offering consolidates your data center real estate, facilities and technology systems into a single operational and financial model." (G; the same sentence appears in promo boxes on A, B, C and F)

**[INFERENCE]** CBRE Data Center Solutions operates and runs projects in client facilities and recommends the manual artifacts in §1, so it is a plausible customer or channel. CBRE also sponsors the HackUTD 2026 track (prompt in `10-sponsor-tracks.md` §3). Untested. CBRE facility counts conflict across sources (700 / 800+ / ~1,300); see `03-buyers-and-workflow.md` §4.

## 10. What weakens Cascade's thesis

All **[INFERENCE]** unless quoted:

- Growth is concentrated in hyperscale, AI campuses and neoclouds, not mid-size multi-tenant colocation (Cascade's proposed first segment). Hyperscalers have in-house engineering.
- With vacancy at 1.4% and capacity preleased, operators fear tenant churn less, so "protect your revenue" is a weaker pitch than "avoid the outage".
- Power availability, not operational resilience, is the industry's stated top challenge (C).
- Backup power topologies are diversifying (§6), so a fixed A/B-plus-diesel model will not describe every site.

## Suggested adjustments (from this research)

- Lead the pitch and demo with planned change in a live facility (phased maintenance or retrofit: "redundancy remaining by phase"), not random failure.
- Test CBRE Data Center Solutions as a channel, and investors doing due diligence as a second buyer.
- Add battery, gas-turbine and bridging-power sources to the model; account for take-or-pay minimums in revenue exposure.
- Use the CBRE asking-rate ranges (§8) as cited defaults for revenue assumptions.

## 11. CBRE Smart FM and facilities-management claims (not re-verified)

Merged from two same-day scans of CBRE's facilities-management pages (2026-11-07). **These quotes were not re-checked by the second read used in §1–10.** Confidence: **high** = primary CBRE page or press release read directly (high means "CBRE claims it", not that the claim is true); **M** = vendor claim seen through a secondary listing; **low** = job-board excerpt.

| Claim | Value | Source | Confidence |
|---|---|---|---|
| Smart FM Solutions deployment | > 20,000 GWS client sites, ~1 billion sq ft (Aug 21 2023) | CBRE press release (IR PDF) — https://d1io3yog0oux5.cloudfront.net/_bcf9189f611a8571e2d0b2d5f0dba4f2/cbre/news/2023-08-21_CBRE_s_AI_Powered_Facilities_Management_Solutions__206.pdf ; same release at https://ir.cbre.com/press-releases/detail/206/cbres-ai-powered-facilities-management-solutions-reaches and https://www.cbre.com/press-releases/cbres-ai-powered-facilities-management-solutions-reaches-1-billion-sf-of-deployment | high (one scan labeled the cbre.com URL M, vendor claim) |
| Platform | "CBRE's Nexus AI-based platform" | same | high |
| Claimed effect | maintenance cost and energy reduced "by as much as 20%"; technician dispatches reduced "by an average of 25%" | same (quote from Paul Saville-King) | high (that CBRE claims it) |
| Solution components | **Virtual Maintenance** ("combines remote monitoring and diagnostics, alarm triage and advanced analytics to drive next best actions"); **Automated Maintenance** (real-time asset performance, automated compliance reporting and asset inspections); **Dynamic Services** (space utilization) | same | high |
| Framing of the problem | "Today's smart buildings landscape is comprised of multiple components that are hosted on disparate platforms" | same | high |
| Predictive model | "AI-powered dynamic asset health scores guide technicians"; "remote operations centers to triage and resolve non-critical alarms before dispatching on-site technicians"; "Next Action Engine" | CBRE Insights, Apr 2 2025 — https://www.cbre.com/insights/articles/accelerating-technological-innovation-a-catalyst-for-facilities-management-transformation | high |
| Direction of travel | "FM shift from reactive maintenance to proactive, predictive, and automated operations"; platforms that "consolidate data into a single pane of glass"; "countless work orders and alarms, many of which turn out to be redundant or false alerts" | same | high |
| Work-order scale | "15M workorders processed annually"; "5% reduction in duplicate work orders"; "80% of actual SLA misses predicted" | same | high |
| O&M page claims | "29% lower overall cost per technical work order"; "98% reduction in excessive alarm messages"; FM in 130+ countries; sectors include refineries, petrochemical plants, "Unmanned Critical Plant Infrastructure", control rooms | https://cbre.com/services/manage-properties-and-portfolios/facilities-management/operations-and-maintenance | high |
| FM tech page | "IoT-enabled sensors"; "Predictive maintenance keeps your system running with minimal downtime"; "AI-driven systems process millions of work orders annually" | https://cbre.com/services/manage-properties-and-portfolios/facilities-management/fm-technology | high |
| Digital twins | Only a general CBRE UK piece describing digital twins as enabling "real-time monitoring, predictive maintenance". No specific CBRE digital-twin product was found | https://www.cbre.co.uk/insights/articles/ai-facilities-management-a-new-era-of-efficiency | high (for the article) |
| CMMS product | CBRE pages name no CMMS. A CBRE job posting (search excerpt only) mentions migrating work orders "from Si7 to Maximo" and a move to "eMaint". **Do not claim CBRE uses Maximo** | job-board excerpts | low |

**Conflict between scans.** Two scans quote the press release's "CBRE's Nexus AI-based platform". A third scan of the same day reported "I found no CBRE tool called 'Nexus'. Only Smart FM claims were found." The press-release quote is the primary evidence; the third scan apparently did not reach that text.

**Framing used by the earlier work** (carry over if a CMMS-style dataset is shown): say data is "modeled on public CMMS conventions (Maximo / ISO 14224) and on how CBRE publicly describes Smart FM (remote triage → dispatch, asset health scores, SLA tracking)". Do not call it CBRE data or CBRE's system. The CMMS schema is in `09-maintenance-workforce-and-work-orders.md` §3.
