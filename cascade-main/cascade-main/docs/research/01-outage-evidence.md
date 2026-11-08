# 01 — Outage Evidence

**Scope:** causes and costs of data center outages, and public incidents where documented redundancy turned out to be false. **Researched:** 2026-11-07.

Every claim has a URL. Where I could only reach secondary coverage of a paywalled Uptime report, I say so. "Survey %" figures from Uptime are usually *share of respondents*, not share of all outages. Multi-select questions do not add to 100%.

---

## Key takeaways

1. **Power is still the #1 cause of impactful data center outages, and the power failures come from the switching chain (UPS, transfer switches, generators, A/B transfer).** 52% of respondents named power as the primary cause of their most recent impactful outage, with cooling at 19% (Uptime 2023 survey, n=108) ([Uptime AOA 2024 exec summary PDF](https://www.corrierecomunicazioni.it/wp-content/uploads/2024/04/executive-summary.pdf); [OCOLO summary of the 2024 Resiliency Survey](https://blog.ocolo.io/powerful-results-from-uptime-intelligences-2024-annual-data-center-resiliency-survey/)). In the 2025 analysis power was 54%. Among power outages, respondents cited UPS failure 42%, transfer switch 36%, generator 28% and A/B path transfer failure 23% ([Network World via GIXtools repost](https://gixtools.net/?p=20122359)). The 2026 report says UPS, transfer switch and generator failures "dominate" power-related outages ([ITWeb, 2026 release](https://itweb.africa/article/uptime-announces-annual-outage-analysis-report-2026/WnxpEv4Y6837V8XL)).
2. **Most major outages are procedural, and operators say they were preventable.** Uptime estimates from 25 years of data that human error contributes to two-thirds to four-fifths of all downtime incidents ([AOA 2024 exec summary](https://www.corrierecomunicazioni.it/wp-content/uploads/2024/04/executive-summary.pdf)). Of organizations with a major human-error outage, 85% traced it to staff not following procedures or to flawed procedures ([Uptime 2025 press release](https://uptimeinstitute.com/about-ui/press-releases/uptime-announces-annual-outage-analysis-report-2025)). 87% of operators who had a major outage say better management or processes would have prevented it ([Uptime Global Survey 2025 3-pager](https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.AnnualSurvey.OutagesAI.3Pager.pdf?version=0)).
3. **Outages are getting rarer but more expensive.** In Uptime's 2025 survey, 57% said their most recent major outage cost more than $100,000, and for the second year running 1 in 5 said more than $1M ([ITWeb, 2026 release](https://itweb.africa/article/uptime-announces-annual-outage-analysis-report-2026/WnxpEv4Y6837V8XL)). In 2019 those shares were 39% and 11% ([IT Brief, 2022 release](https://itbrief.com.au/story/new-uptime-analysis-highlights-worsening-downtime-costs-and-consequences)).
4. **No public dataset gives the share of outages caused by planned maintenance. The incident record, though, is full of maintenance-window and assumed-redundancy failures.** Examples: GleSYS lost two zones while "running on a single UPS" mid-replacement ([GleSYS RFO](https://static.glesys.com/Incident-Report-GleSYS-2024-08-12-Datacenter.pdf)). Equinix Singapore's contractor closed chilled-water valves during a planned upgrade, and 2.5M bank transactions failed ([The Register](https://www.theregister.com/2023/11/07/overheating_datacenter_singapore)). Korea's NIRS fire started during UPS battery relocation ([DCD](https://www.datacenterdynamics.com/en/news/five-charged-with-professional-negligence-over-south-korea-govt-data-center-fire)). Alibaba's standby chillers shared the failed water loop with the active chillers ([Alibaba Cloud notice](https://www.alibabacloud.com/en/notice/066572)). Delta had about 300 servers not wired to backup power, a gap that "went undetected" ([AJC](https://ajc.com/business/delta-computer-risk-went-undetected-ceo-says/V2H5CYl4Nsbn57x8T5ISvM)). The best quantitative proxy is Meta's network study, where maintenance was the largest documented root cause of incidents at 17% ([Meza, CMU thesis / arXiv 1901.03401](https://arxiv.org/pdf/1901.03401)).
5. **SLA credits are small next to customer losses, but at wholesale/hyperscale scale they are a real exposure for the operator.** Uptime: cloud SLA compensation "doesn't even scratch the surface" of losses ([Uptime Journal, 2022](https://journal.uptimeinstitute.com/cloud-slas-punish-not-compensate/)). Parametrix, an SLA insurer and therefore an interested party, models a 45-minute outage at a 100 MW site ($144M annual rent) producing a $24M credit loss, about 42% of annual cash flow ([Reinsurance News](https://www.reinsurancene.ws/service-level-agreement-exposure-among-most-significant-risks-facing-data-centres-parametrix/)).

---

## 1. Uptime Institute outage analyses and surveys (2024–2026)

### Annual Outage Analysis 2026 (released 13 May 2026). Full report is paywalled; figures are from press coverage of the release.
Source: [ITWeb](https://itweb.africa/article/uptime-announces-annual-outage-analysis-report-2026/WnxpEv4Y6837V8XL); release listing at [BusinessWire](https://www.businesswire.com/news/home/20260513289344/en/Uptime-Announces-Annual-Outage-Analysis-Report-2026), which returned 403 to my fetch.
- Per-site outage rates fell for the 5th straight year, "but the pace of improvement has slowed."
- About 1 in 10 respondents said their last outage was serious or severe.
- Power is still the leading cause of high-impact outages. Failures in **UPS systems, transfer switches and generators dominate** power-related outages. Grid constraints and high-density loads are new pressure points.
- Human error: **failure to follow established procedures is the leading driver** of human-error outages. Unclear or inconsistent processes, installation errors and in-service errors are also common.
- Cost: in the 2025 annual survey, **57% said their most recent major outage cost more than $100k. 1 in 5 said more than $1M**, for the 2nd consecutive year.
- Andy Lawrence (Uptime): "failures will increasingly not be the result of a single point of failure", and "more automation can cause different classes of problems."
- Third parties (cloud, telecom, colo) account for about two-thirds of publicly reported outages over 9 years of tracking.
- A secondary summary puts power at 45% of impactful outages in the latest data, but I could not trace that number to Uptime's own text. Treat it as unverified.

### Annual Outage Analysis 2025 (7th edition, May 2025)
Source: [Uptime press release](https://uptimeinstitute.com/about-ui/press-releases/uptime-announces-annual-outage-analysis-report-2025); [Network World figures via GIXtools repost](https://gixtools.net/?p=20122359).
- Outage frequency and severity declined for the 4th consecutive year. Power remains the leading cause of impactful outages.
- **IT and networking issues reached 23% of impactful outages in 2024**, up from the year before. Uptime attributes the rise to complexity, "change management and misconfigurations."
- Nearly 40% of organizations had a major human-error outage in the past 3 years. **85% of those came from staff not following procedures or from flawed procedures.** The failure-to-follow-procedures share rose 10 percentage points year on year.
- Network World breakdown, as reported:
  - Power: 54% of impactful outages.
  - Among power outages: UPS failure 42%, transfer switch 36%, generator 28%, A/B path transfer switch 23%.
  - Human-error causes: "staff failing to follow procedure" 58%, "incorrect staff processes/procedures" 45%.
  - Network outages: configuration/change management failure cited by 50%.
  - IT system/software outages: configuration/change management cited by 62%.

### Annual Outage Analysis 2024 (public executive summary with sample pages)
Source: [Exec summary PDF](https://www.corrierecomunicazioni.it/wp-content/uploads/2024/04/executive-summary.pdf). I extracted the text myself.
- 55% of operators had an outage in the past 3 years, down from 60% (2022) and 69% (2021). In 2023 only about 1 in 10 outages was serious or severe.
- **Primary cause of the most recent impactful outage (2023 survey, n=108): power 52%.** Cooling was 19% per the [OCOLO summary](https://blog.ocolo.io/powerful-results-from-uptime-intelligences-2024-annual-data-center-resiliency-survey/). Third-party provider issues were about 9%.
- Cost: **54% said their most recent significant/serious/severe outage cost more than $100k, and 16% said more than $1M.**
- **Four in five said their most recent serious outage could have been prevented with "better management, processes and configuration."**
- Human error contributes to two-thirds to four-fifths of downtime incidents, based on 25 years of Uptime data.
- Causes of major human-error outages (2024 Resiliency Survey, n=418, up to 3 choices):

  | Cause | Share |
  |---|---|
  | Staff failing to follow procedure | 48% |
  | Incorrect processes/procedures | 45% |
  | Installation issues | 23% |
  | In-service issues | 20% |
  | Insufficient staff | 15% |
  | Preventive maintenance frequency issues | 14% |
  | Design/omissions | 10% |

- Uptime notes that cooling failures are usually tolerated for minutes thanks to thermal ride-through, while IT hardware tolerates power disturbances for only "fractions of a second."

### Global Data Center Survey 2025 (Aug 2025, 835 owner/operators)
Source: [Uptime 3-pager PDF](https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.AnnualSurvey.OutagesAI.3Pager.pdf?version=0). I extracted the text myself.
- 50% had an impactful outage in the past 3 years (n=723). 28% of those rated it significant, serious or severe.
- **87% say their most recent major outage was preventable with better management/processes.** The comparable figures were 78% and 80% in earlier editions.
- Cost bands, asked only of Category 3–5 outages:
  - 2023 (n=94): under $100k 46%, $100k–$1M 38%, over $1M 16%.
  - 2025: about 43% under $100k, which matches the 57% over $100k in the 2026 release. The chart layout made the exact 2025 over-$1M bar hard to read, so I rely on the release's "1 in 5."
- "Customer SLA issue" was among the top three impacts of outages that hit AI workloads.

### Earlier trend anchor (Annual Outage Analysis 2022)
Source: [IT Brief](https://itbrief.com.au/story/new-uptime-analysis-highlights-worsening-downtime-costs-and-consequences).
- Over 60% of failures caused at least $100k in losses, up from 39% in 2019. The share over $1M rose from 11% to 15%.
- Power was 43% of significant outages, and **UPS failure was the single biggest cause of power incidents.**

---

## 2. Outages during maintenance or switching, and hidden or assumed redundancy

**Bottom line:** I found **no public statistic for the share of data center outages that occur during planned maintenance or switching.** Uptime's public material does not break this out. It may be in the paywalled full reports or the Abnormal Incident Reports (AIRs) database. Here are the closest proxies and qualitative evidence:

- **Meta (Facebook) data center network incidents, 2011–2017/18.** "Maintenance failures contribute the most documented root causes (17%)", ahead of hardware at 13%. In 2015 Meta added checks that operators had drained cluster switches (CSAs) before maintenance. **CSA mean time between incidents then improved by two orders of magnitude between 2014 and 2016** ([Meza, CMU PhD thesis, arXiv 1901.03401](https://arxiv.org/pdf/1901.03401); originally published as an IMC 2018 paper). This covers network, not facility power/cooling, but it is the cleanest public number showing maintenance as a leading root cause. It also shows that pre-maintenance checks change outcomes sharply.
- **Uptime human-error causes include maintenance and installation categories.** Preventive maintenance frequency issues 14%, installation issues 23%, in-service issues 20% (see table in section 1). Procedure failures (48% and 45%) dominate ([AOA 2024 exec summary](https://www.corrierecomunicazioni.it/wp-content/uploads/2024/04/executive-summary.pdf)).
- **Change management drives IT and network outages.** Configuration/change management failure was cited for 50% of major network outages and 62% of IT/software outages ([Network World via GIXtools](https://gixtools.net/?p=20122359)).
- **Uptime (2026): failures are increasingly not single points of failure, and automation adds new failure classes** ([ITWeb](https://itweb.africa/article/uptime-announces-annual-outage-analysis-report-2026/WnxpEv4Y6837V8XL)). This is consistent with a dependency-mapping thesis but is not quantitative.

**Small-operator incident reports where planned power maintenance removed redundancy. These are direct evidence for the planned-maintenance hypothesis:**
- **GleSYS, Stockholm (12 Aug 2024).** The site is designed N+1. Three months of planning went into installing a new UPS and switchgear and retiring the old UPS. When load was transferred to the new UPS, its main breaker tripped within 10 seconds, dropping critical load in Zones 2 and 3. Root cause: the breaker was "configured to its minimum value instead of its maximum value." GleSYS: "a disastrous error at our weakest moment, where we were running on a single UPS." The status page had also auto-closed the maintenance window early, which misled customers ([GleSYS RFO PDF](https://static.glesys.com/Incident-Report-GleSYS-2024-08-12-Datacenter.pdf)).
- **ChargeOver at Flexential Chaska, MN (7–8 Jun 2025).** The data center's planned maintenance "de-energized the four uninterruptible power supply (UPS) systems" one at a time. Each step dropped one of ChargeOver's "redundant" switches, and failover did not work. The service was down about 3.5 hours on each of two days. Remediation included new procedures for coordinating with the provider's maintenance windows ([ChargeOver postmortem](https://status.chargeover.com/incidents/3zfsdz4msf3s)). The customer believed it had dual-feed redundancy, and that redundancy was not actually there during the maintenance.
- Similar but less documented: Viirtue NJ, July 2025. A "no impact" UPS maintenance notice had the wrong date, and the work caused full connectivity loss ([Viirtue status](https://status.viirtue.com/incidents/thwqm0tpzhz7)). Friendster's 2008 outage followed UPS maintenance at QTS Santa Clara that "did not go as planned" ([DCK](https://www.datacenterknowledge.com/outages/ups-failure-triggered-friendster-outage)). I did not verify these two beyond the search snippets.

---

## 3. Notable power and cooling incidents

| # | Incident | What failed | What cascaded | Impact | Maintenance / hidden dependency? |
|---|---|---|---|---|---|
| 1 | **Google Cloud europe-west2, London, 19 Jul 2022** (UK record heat) | "Simultaneous failure of multiple, redundant cooling systems combined with the extraordinarily high outside temperatures" | Part of the zone was powered down. About 35% of VMs in europe-west2-a were terminated and about 38% of Persistent Disk volumes were unavailable. Google also "inadvertently modified traffic routing for internal services to avoid all three zones" in the region | 18h23m outage plus a 35h long tail | Assumed redundancy failed under common-mode conditions (heat). Automation over-reacted. ([Google status](https://status.cloud.google.com/incidents/fmEL9i2fArADKawkZAa2); [The Register](https://www.theregister.com/2022/08/01/google_london_outage_incident_report/)). Oracle had a cooling failure in London the same day and powered down "non-critical hardware" ([BleepingComputer](https://www.bleepingcomputer.com/news/security/uk-heat-wave-causes-google-and-oracle-cloud-outages/amp/)) |
| 2 | **Microsoft Azure Australia East, Sydney, 30 Aug 2023** | A utility power sag tripped chillers. Of 7 chillers (5 running, 2 standby), the standbys mostly failed to stay online. The emergency procedure failed because "pumps did not get the run signal from the chillers" | Servers were shut down to shed heat. Storage hardware was heat-damaged, and automation marked healthy nodes unhealthy | Multi-hour regional disruption. Reported durations range from more than 24h ([Network World](https://www.networkworld.com/article/3706093/microsoft-blames-aussie-data-center-outage-on-staff-strength-failed-automation.html)) to 46h ([DCD](https://www.datacenterdynamics.com/en/analysis/staffing-levels-are-data-centers-at-risk-of-unnecessary-outages)) | Hidden control dependency (pump run-signal) and 3 night staff, "insufficient to restart the chillers in a timely manner" ([The Register](https://www.theregister.com/2023/09/04/microsoft_australia_outage_incident_report/)) |
| 3 | **Equinix SG, Singapore, 14 Oct 2023** | A contractor "incorrectly sent a signal to close the valves from the chilled water buffer tanks" **during a planned system upgrade** | Temperatures rose. DBS and Citi failovers to backup sites also failed (DBS network misconfiguration, Citi connectivity) | About 2 days of banking disruption. 810,000 failed login attempts and 2.5M payment/ATM transactions failed. MAS barred DBS for 6 months from non-essential IT changes and applied a 1.8x operational-risk RWA multiplier | **Yes, maintenance/upgrade-induced** ([The Register](https://www.theregister.com/2023/11/07/overheating_datacenter_singapore)) |
| 4 | **Alibaba Cloud Hong Kong Zone C (PCCW facility), 18 Dec 2022** | Water shortage let air into the cooling loop. **The 4 standby chillers shared the same water circulation as the 4 active ones, so failover failed.** The chillers were "bound into a cluster" and could not be restarted individually | Temperatures triggered sprinklers, and water entered power cabinets and racks. Zone C's local-redundant storage held custom images, so instances elsewhere failed to start. The regional control plane was throttled, and the API availability SLA fell to 20% | About 14h until the last room was powered back on, and longer for some services | **Hidden shared dependency behind "redundant" chillers** ([Alibaba Cloud notice](https://www.alibabacloud.com/en/notice/066572)) |
| 5 | **AWS Tokyo ap-northeast-1, 23 Aug 2019** | A bug in third-party code in the datacenter cooling control system triggered while control was "failing away from one of the control hosts" | "Multiple, redundant cooling systems" failed. In part of the site, cooling "did not correctly transition to this safe cooling configuration" | About 6h for most instances and volumes to recover | **Common-mode control dependency during a failover event** ([AWS PES](https://aws.amazon.com/message/56489)) |
| 6 | **CME Group / CyrusOne CHI1, Aurora IL, 27–28 Nov 2025** | Staff and contractors "failed to follow standard procedures for draining cooling towers ahead of freezing temperatures." CME said "initial remediation attempts further exacerbated the problem," leading to multiple chiller failures | Temperatures went above 100°F. CME did not fail over to its NY backup because early signals suggested a short outage. Problems began about 12h before markets opened | CME markets halted more than 10h, including gold, oil, rates and equity futures. Goldman paused a $1.3B CyrusOne bond sale | **Seasonal maintenance procedure failure** ([DCK](https://www.datacenterknowledge.com/outages/cme-data-center-outage-caused-by-human-error-cyrusone-says); [Insurance Journal](https://www.insurancejournal.com/news/midwest/2025/12/01/849319.htm); [Bloomberg](https://www.bloomberg.com/news/articles/2025-12-09/cme-data-center-woes-started-12-hours-before-the-market-opened)) |
| 7 | **Korea NIRS, Daejeon, 26 Sep 2025** | Fire during **relocation of lithium-ion UPS batteries** from a 5th-floor hall to the basement. Police believe auxiliary power stayed connected and a rack switch was left on | Battery packs destroyed (reported as 384 cells or 386 packs) | 647 government systems hosted, 96 directly damaged (other reports say 709 disrupted). Five people charged with professional negligence | **Yes, maintenance/relocation work, with energized circuits assumed dead** ([DCD charges](https://www.datacenterdynamics.com/en/news/five-charged-with-professional-negligence-over-south-korea-govt-data-center-fire); [DCD aux power](https://www.datacenterdynamics.com/en/news/auxiliary-power-remained-connected-during-south-korea-data-center-fire-police-believe/); [Korea JoongAng Daily](https://www.koreajoongangdaily.com/korea/police-investigation-reveals-auxiliary-power-remained-on-during-nirs-data-center-fire/12229464)) |
| 8 | **Delta Air Lines, Atlanta, 8 Aug 2016** (older, but the canonical case) | A power control module / switchgear failed and caught fire | **About 300 of roughly 7,000 servers were not connected to backup power**, a gap that "went undetected and should not have" (CEO Ed Bastian). Systems did not switch over cleanly | About 2,000 flights cancelled over 3 days. **$150M cost** (Delta disclosure) | **Hidden dependency / assumed redundancy** ([AJC](https://ajc.com/business/delta-computer-risk-went-undetected-ceo-says/V2H5CYl4Nsbn57x8T5ISvM); [DCK $150M](https://datacenterknowledge.com/outages/delta-data-center-outage-cost-us-150m)) |

Bonus older case: **British Airways, May 2017.** An engineer disconnected a power supply at a Heathrow-area data centre, and the surge on reconnection caused major damage. 672 flights were cancelled and about 75,000 passengers affected. IAG put the cost at about £58M, after an earlier £80M estimate. BA sued the facility manager CBRE, which settled ([DCK](https://www.datacenterknowledge.com/energy-power-supply/british-airways-engineer-wrongly-disconnected-data-center-power-supply); [Verdict](https://www.verdict.co.uk/bank-holiday-it-failure-cost-british-airways-58m/); [DCK settlement](https://www.datacenterknowledge.com/outages/cbre-settles-british-airways-lawsuit-over-costly-data-center-outage)).

**Pattern across the 8 cases:** at least 4 involve maintenance, upgrade or relocation work (Equinix SG, CME, NIRS, plus GleSYS and ChargeOver from section 2). At least 4 involve redundancy that existed on paper but shared a hidden dependency (Alibaba shared water loop, AWS control system, Azure pump signal, Delta unprotected servers).

---

## 4. Cost of downtime and SLA credits

| Figure | Source | Independence |
|---|---|---|
| 57% of major outages cost more than $100k; 1 in 5 more than $1M (2025 survey) | [Uptime 2026 release via ITWeb](https://itweb.africa/article/uptime-announces-annual-outage-analysis-report-2026/WnxpEv4Y6837V8XL) | Vendor-neutral (Uptime is an industry body, but it does sell certification and consulting) |
| 54% more than $100k, 16% more than $1M (2023 survey) | [Uptime AOA 2024 exec summary](https://www.corrierecomunicazioni.it/wp-content/uploads/2024/04/executive-summary.pdf) | Same |
| Average cost of the most significant recent outage $973,000; 2% lost more than $40M (2021 survey) | [Uptime Journal](https://journal.uptimeinstitute.com/cloud-slas-punish-not-compensate/) | Same |
| **$8,851 per minute** average unplanned data center outage; $740,357 average per incident; max about $2.41M; UPS failure the leading cause (about 25%). n=63 US data centers | [Emerson/Vertiv release](https://www.vertiv.com/en-us/about/news-and-events/corporate-news/2016/emerson-network-power-study-says-unplanned-data-center-outages-cost-companies-nearly-$9000-per-minute/); [Ponemon](https://ponemon.org/news-updates/blog/security/2016-cost-of-data-center-outages.html) | **Vendor-funded:** Ponemon study sponsored by Emerson Network Power (now Vertiv), a UPS vendor. Dated 2016 with a small sample |
| Over 90% of mid-size and large enterprises say 1 hour of downtime costs more than $300k; 41% say $1M–$5M+ per hour (self-reported, n>1,000) | [ITIC 2024](https://itic-corp.com/?p=3152) | Independent analyst, self-reported estimates |
| Global 2000 downtime costs $400B per year, 9% of profits, about $200M per company (2024). Updated to $600B and about $15k per minute (2026) | [Splunk 2024](https://splunk.com/en_us/newsroom/press-releases/2024/conf24-splunk-report-shows-downtime-costs-global-2000-companies-400-billion-annually.html); [Cisco/Splunk 2026](https://newsroom.cisco.com/c/r/newsroom/en/us/a/y2026/m05/the-600-billion-wake-up-call-new-splunk-research-reveals-downtime-is-a-systemic-business-crisis.html) | **Vendor-funded** (Splunk/Cisco, done by Oxford Economics). Covers all digital downtime, not just facilities |
| Single-incident disclosed costs: Delta $150M (2016); BA about £58M (2017) | [DCK](https://datacenterknowledge.com/outages/delta-data-center-outage-cost-us-150m); [Verdict](https://www.verdict.co.uk/bank-holiday-it-failure-cost-british-airways-58m/) | Company disclosures |

**SLA credits:**
- **Cloud SLAs:** Uptime's Owen Rogers worked an AWS example. Below 99% availability earns a 10% credit, below 95% earns 30%, and a full refund requires about 36.5h of downtime in the month. The customer must measure and claim the credit, which is paid as service credit rather than cash. Compensation "doesn't even scratch the surface" of losses ([Uptime Journal, Jun 2022](https://journal.uptimeinstitute.com/cloud-slas-punish-not-compensate/)).
- **Colo/wholesale SLAs (operator exposure):** Parametrix white paper, June 2026. A **45-minute outage at a 100 MW facility with $144M annual rent → $24M in service credits, about 42% of annual cash flow** ([Reinsurance News](https://www.reinsurancene.ws/service-level-agreement-exposure-among-most-significant-risks-facing-data-centres-parametrix/)). This is a **modeled scenario from a company that sells SLA insurance**, so it is interested and not an observed payout. Parametrix also argues that underwriters under-weight SLA exposure.
- **Typical retail colo SLA terms:** credits are commonly capped at 50% of the monthly fee for the affected service ([LightEdge SLA](https://lightedge.com/wp-content/uploads/2025/01/LightEdge-SLA-2025.pdf)). Credits are applied to the next invoice ([Digital Realty SLA exhibit](https://marketplaceportal.com/documents/10139/3596013/Digital-Realty-SLA-MSA+Exhibit)).
- **Regulatory penalties can exceed credits.** MAS's sanctions on DBS after the Equinix SG event included a 1.8x operational-risk RWA multiplier and a 6-month freeze on non-essential IT changes ([The Register](https://www.theregister.com/2023/11/07/overheating_datacenter_singapore)).

---

## Gaps / could not verify

- **Share of outages that occur during planned maintenance or switching:** not found in any public Uptime material, and not found elsewhere for facility infrastructure. The nearest public number is Meta's 17% maintenance root cause for *network* incidents. This is the most important gap for the planned-maintenance hypothesis. Options: Uptime AIRs database access, Uptime Intelligence subscription, or customer interviews.
- **Share of outages caused by undocumented or misunderstood dependencies:** no statistic found. The evidence is qualitative (incident cases plus Uptime's "not a single point of failure" commentary).
- **Full Uptime 2025 and 2026 report contents:** paywalled. The 2025 figures for UPS 42%, ATS 36%, generator 28%, A/B 23%, procedure 58% and change management 50%/62% come from Network World coverage (reached via a repost), not the report itself. The "power = 45%" figure for 2026 appears only in secondary or vendor summaries and is unverified.
- **2025 over-$1M share:** taken from the release's "1 in 5". I could not read the exact bar from the extracted 3-pager chart text.
- **Actual SLA credits paid by colo operators:** no disclosed totals found in public sources. I did not search Equinix or Digital Realty 10-K/10-Q filings in depth. The Parametrix $24M is modeled.
- **Durations and dates for some incidents:** Azure Australia East (24h vs 46h), CME (10h vs 11h), and NIRS system counts (647/96 vs 709) are inconsistent across outlets. The Delta trigger (switchgear vs ATS fire) also varies.
- **BusinessWire and DCD pages** returned 403 to my fetches. Where I cite them, the facts were confirmed via other outlets carrying the same release or reporting.

## Conflicts with other files in this folder

- **Cost shares by report year.** `06-cooling-physics.md` P52 attributes "54% said their latest significant outage cost >$100k; 20% said >$1M" to the **2025** report (BusinessWire). This file attributes 54% >$100k / **16%** >$1M to the **2024** exec summary (2023 survey), and "1 in 5 >$1M for the 2nd consecutive year" to the 2026 release (2025 survey), which implies the 2025 report also had about 1 in 5. Both files agree on 57% >$100k in the 2026 release. The 54%/20% pairing in `06` could not be reconciled from the sources read; check the 2025 release text before quoting it.
- **Cooling share of outages.** This file has cooling at **19%** of most-recent impactful outages (2023 survey, via OCOLO). `06-cooling-physics.md` P54 has cooling as the #2 cause at **13%** of respondents (2025, Computer Weekly), with another summary saying 14%. Different survey years and question wording; not necessarily contradictory.
- **UPS share of power outages.** This file attributes UPS 42% to Network World's coverage of the 2025 analysis; `03-buyers-and-workflow.md` cites DCD for UPS first at a reported 42% "of the 2024 data". The 2025 analysis covers 2024 data, so these are probably the same figure.
- **GleSYS.** This file's details come from reading the RFO PDF; `03-buyers-and-workflow.md` cites the same PDF from a search snippet only. Prefer this file's version.
