# 06 — Data center cooling failure: physics, options, costs

**Scope:** what happens when a cooling component (chiller, CHW pump, CRAH) fails: rack inlet temperature rise, thermal limits, equipment reliability and restart times, mitigation costs (rental cooling, standby capacity, load shedding or migration), SLA terms, and a heat model. **Researched:** 2026-11-07.

The research was framed as choosing the cheapest mix of rental cooling, standby capacity, tenant load shedding or migration, or doing nothing, over a known repair horizon. CBRE gives no data (challenge PDF p.4: "Additional Resources will be provided after the opening ceremony in the CBRE Discord Channel"). Every number below has a URL. Rows marked **derived** are our own arithmetic on cited inputs. Confidence: **H** = primary or official document read directly; **M** = vendor page or reputable secondary summary; **L** = search snippet, anecdote, or a page we could not open.

---

## 1. Summary (read this first)

1. **The countdown is minutes, not hours, when cooling is lost outright.** In Schneider WP-179's worked example (400 kW, 4 kW/rack, no CRAH or pumps on UPS), room air passes the ASHRAE allowable 32 °C within about a minute and stays too hot until about 17 min. The paper says the initial rise "could easily be 5 °C/minute or more". Real incidents: Hosting365 measured ~2 °C/min, with areas above 40 °C within 15 min. Uppsala's UPPMAX reported ~1 °C/min.
2. **Repairs take hours.** US Army TM 5-698-5 (field data from the PREP database): chillers fail 0.118 times/yr with MTTR 12.6 h; centrifugal chillers 0.046/yr, 14.5 h; cooling towers 0.032/yr, 80.9 h; pumps 0.0063/yr, 7.1 h; AHUs 0.011/yr, 2.4 h. MTTR excludes waiting for parts. One anecdote puts a compressor at 7–10 days lead time.
3. **So the realistic event is a partial capacity loss, not total loss.** One chiller or pump drops out of an N+1 plant that is running hot or already has a unit down. Available cooling ends up a little below IT heat. That is a small deficit, a large thermal capacitance, and a countdown in tens of minutes to hours. Restart times also matter: a standard chiller takes 10–15 min, rapid-restart models 35 s to 5 min.
4. **Limits are well defined.** ASHRAE 2021 (5th ed.): recommended inlet 18–27 °C; allowable A1 15–32 °C, A2 10–35 °C, A3 5–40 °C, A4 5–45 °C. Change limits are 20 °C in an hour and no more than 5 °C in any 15 min. Colocation SLAs use 18–27 °C (64.4–80.6 °F) measured in the cold aisle. Server auto-shutdown is configurable. One Dell iDRAC example uses warning 42 °C and critical 47 °C. A Dell VxRail example uses 38 °C and 42 °C.
5. **Mitigations.** Rental chillers: next-day delivery claims, 30–1,450 kW units, list price $950/day (30 t) to $3,800/day (200 t), plus $30–75k installation. Load shedding or VM migration: seconds to minutes. Intel saw ~20% server power reduction from capping. The cost of shedding is the tenant's lost revenue or SLA credits. "Do nothing" ends in thermal shutdown.
6. **Business impact anchors.** Uptime 2025: 54% of respondents said their last significant outage cost more than $100k, and 20% said more than $1M (attribution conflicts with `01-outage-evidence.md`; see P52). The 2026 report says 57% above $100k. Cooling is the #2 outage cause at about 13% (`01-outage-evidence.md` has 19% for the 2023 survey). Ponemon 2016: an average outage cost $740,357, or $8,851/min. Colocation pricing is $200+/kW-month (CBRE H1 2025, 250+ kW at N+1/Tier III), or $194.95/kW-month on average. SLA credits are typically 2 days of space fee per temperature breach longer than 15 min (Digital Realty), or 1/30 of the cabinet MRC (Equinix). Breaches of 4 h/month or 8 h straight give the tenant a termination right.

---

## 2. Cooling-failure model vocabulary

| Concept | Data center meaning | Notes / source basis |
|---|---|---|
| Site / campus | One chilled-water (CHW) plant and a shared rental and standby pool | A plant serves several halls. Redundant chillers and rentals are shared across halls |
| Hall | Data hall (white space) or pod | Each hall has its own thermal capacitance and limit |
| Thermal headroom | `C_eff [kJ/K] × (T_limit − T_now)` = kJ the hall can absorb before the limit | C_eff = air + IT thermal mass (+ CHW loop water if pumps run); §4 |
| Level | Hall (or worst-rack) inlet temperature, °C | Could be normalised to % of (T_limit − T_setpoint) |
| Warning / shutdown limits | warning = 27 °C (top of ASHRAE recommended range, the SLA ceiling); shutdown = 32 °C (A1 allowable max) or a configured server critical threshold (e.g. 42–47 °C) | ASHRAE card; Dell docs |
| Heat load | IT heat load per tenant/rack, kW (≈ all electrical power becomes heat, per WP-179) | "Essentially all of the electrical power consumed in a data center is transformed into heat" (WP-179) |
| Cooling capacity | Cooling capacity removed, kW (chiller tons × 3.517, CRAH kW) | |
| Failure | Chiller trip, CHW pump trip, CRAH fan failure → cooling capacity steps down | TM 5-698-5 rates |
| Degradation | Pump wear / impeller damage (flow and ΔP drop at the same speed), fouled coil, low refrigerant → capacity slowly falls, no countdown yet | Affinity laws for signatures |
| Leak | CHW leak: loop pressure / make-up water flow up, flow at the hall < flow at the plant | Field inspection |
| Rental cooling | Rental chiller / spot coolers: `delivery_min` + `hookup_min`, then continuous kW of cooling at `$/day` + one-off mobilisation | Capacity adds once it arrives |
| Load shedding | Throttle, power-cap or migrate a tenant's / rack group's load to reduce heat. Cost = credits/lost revenue for that tenant, per kW-hour | Pick the cheapest kW to shed first |
| Thermal shutdown | Servers hit their thermal trip or ops EPO the hall → all tenants in the hall down until repair; SLA credits + chronic-outage exposure | DLR SLA chronic clause |
| Repair horizon | Equipment MTTR (chiller 12.6 h, pump 7.1 h, CRAH/AHU 2.4 h), plus parts logistics | TM 5-698-5 |
| Standby chiller | Start the N+1 unit: restart time 35 s – 15 min, $0 marginal cost except energy | Trane / Daikin / JCI / WP-179 |
| Countdown | `minutes_to_limit` from the heat model (§4) | |

---

## 3. Parameter table

| # | Parameter | Value / range | Units | Source | Conf. |
|---|---|---|---|---|---|
| **Thermal ride-through** |
| P1 | Max initial room-air rise rate with no cooling | "could easily be 5 °C/min (9 °F/min) or more depending on density and room layout" | °C/min | Schneider WP-179 Rev 0 (Lin, Zhang, VanGilder), p.7 — https://www.sustainabilitymatters.net.au/content/sustainability/white-paper/data-centre-temperature-rise-during-a-cooling-system-outage-303657868/download (Schneider doc DBOY-7CDJNW) | H |
| P2 | WP-179 Example 1 room | 30 × 24 × 4 m + 0.6 m plenum; 400 kW IT; 4.0 kW/rack (100 racks); 545 kg/rack; CHWS 7.2 °C, CHW ΔT 8.3 °C; CRAH airflow 45 m³/s; CRAH supply 20 °C; generator start 60 s; chiller restart 12 min; no storage | — | WP-179 p.3 sidebar | H |
| P3 | Example 1 outcome | Room air "marginally exceeds the allowable threshold for about 3 minutes and then remains unacceptably high until about 17 minutes"; peak ≈ 106 °F (41 °C), cut to 98 °F (37 °C) with a 5-min chiller restart | min, °F | WP-179 p.3, p.10 | H |
| P4 | CFD Example 2 (10 × 10.7 × 2.6 m, 400 kW, CRAH off and never restored) | Well-mixed air 28.4 °C at 30 s, 32.5 °C at 1 min, 37.3 °C at 5 min; "unacceptably hot everywhere after about 5 min" | °C | WP-179 p.4, Fig. 2 | H |
| P5 | Rack airflow assumption | 125 cfm/kW | cfm/kW | WP-179 Fig. 2 assumptions | H |
| P6 | CHW storage needed to stay ≤ 32 °C: 1 / 4 / 8 / 12 kW/rack (100 / 400 / 800 / 1,200 kW) | Standard chiller (12 min): 0 / 1,300 / 3,800 / 7,000 gal. Quick-start (5 min): 0 / 350 / 1,300 / 2,500 gal | US gal | WP-179 Table 2 (CRAH and pumps on UPS) | H |
| P7 | Measured incident rise rate | ≈2 °C/min (3.5 °F/min); >40 °C in parts within 15 min; 7 chillers out for 18 min | °C/min | Hosting365 via Data Center Knowledge 2008 — https://www.datacenterknowledge.com/archives/2008/02/08/how-much-time-once-the-cooling-fails | M |
| P8 | Measured incident rise rate | ≈1 °C/min | °C/min | UPPMAX status page — https://status.uppmax.uu.se/2018-12-19/cooling-problem (search snippet; page cert error on fetch) | L |
| P9 | Server thermal mass (2U, 150–350 W) | 11.1 kJ/K average (11.3 kJ/K at 350 W), ±7% | kJ/K per server | Electronics Cooling 2013 — https://www.electronics-cooling.com/2013/12/characterization-server-thermal-mass/ | H |
| P10 | Specific heat of server materials (Al, steel, Cu, Si) | 0.5–0.9 | kJ/(kg·K) | same | M |
| P11 | Air density / cp | 1.205 kg/m³ at 20 °C; cp 1.006 kJ/(kg·K) | — | https://www.engineeringtoolbox.com/air-properties-d_156.html | H |
| P12 | Water cp | 4.1955 (10 °C), 4.1844 (20 °C) | kJ/(kg·K) | https://www.engineeringtoolbox.com/specific-heat-capacity-water-d_660.html | H |
| P13 | Average rack density | "below 8 kW"; most sites have no racks >30 kW | kW/rack | Uptime Global DC Survey 2024 — https://intelligence.uptimeinstitute.com/resource/uptime-institute-global-data-center-survey-2024 | M |
| P14 | High-density racks | can exceed 40 kW/rack | kW/rack | WP-179 p.6 | H |
| **Limits** |
| P15 | ASHRAE recommended (all A classes) | 18–27 °C; −9 °C DP to 15 °C DP and 70% rh (or 50% rh) | °C | ASHRAE TC 9.9 Reference Card, Thermal Guidelines 5th ed. (2021) Table 2.1 — https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf | H |
| P16 | ASHRAE allowable | A1 15–32; A2 10–35; A3 5–40; A4 5–45; H1 15–25 (H1 recommended 18–22) | °C | same | H |
| P17 | Allowable humidity | A1: −12 °C DP & 8% rh to 17 °C DP & 80% rh; A2 21 °C DP; A3 24 °C DP & 85%; A4 24 °C DP & 90% | — | same | H |
| P18 | Temperature-change limit | 20 °C in an hour and ≤5 °C in any 15-min window (max − min inlet in the window; "not a rate of change"); tape 5 °C/h | °C | same, footnote f | H |
| P19 | Server thresholds (Dell iDRAC 8, fresh-air) | warning 42 °C, critical 47 °C (= 40/45 °C limits + 2 °C accuracy margin) | °C inlet | https://www.manualslib.com/manual/1244291/Dell-Idrac-8.html?page=105 | M |
| P20 | Server thresholds (Dell VxRail node example) | warning 38 °C, critical 42 °C; critical alert set to power off → immediate shutdown | °C inlet | https://www.dell.com/support/kbdoc/000227616/vxrail-vcf-node-triggers-high-inlet-temperature-alert | M |
| P21 | Shutdown behaviour | Inlet over critical alone doesn't power off a Dell server; it powers off only if the iDRAC alert action is set to power off | — | https://www.dell.com/support/kbdoc/en-us/000181231/poweredge-server-shutdown-due-to-a-critical-thermal-event | M |
| **Equipment, redundancy, reliability** |
| P22 | Uptime Tiers | I Basic Capacity (N); II Redundant Capacity (N+); III Concurrently Maintainable (N+1, "each and every component and path"); IV Fault Tolerant (single event + consequential impact) | — | Uptime/IEA 2020 presentation — https://nex75.iea-ebc.org/Data/Sites/4/media/events/2020-10/presentations/1.4b--traver--uptime-institute.pdf ; https://journal.uptimeinstitute.com/?p=3737 | M |
| P23 | Chiller (all types) | λ = 0.11820 /yr; MTBF 74,110 h; MTTR 12.62 h; 20.8 h downtime/yr | — | US Army TM 5-698-5 (2006), PREP data — https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/tm5_698_5.pdf | H |
| P24 | Chiller, centrifugal 600–1000 t | λ 0.04589 /yr; MTTR 14.52 h | — | same | H |
| P25 | Chiller, reciprocating 50–200 t | λ 0.12790–0.19031 /yr; MTTR 10.35–13.05 h | — | same | H |
| P26 | Chiller, screw >300 t | λ 0.04470 /yr; MTTR 96 h (only 1 failure, 22.4 unit-yrs) | — | same | H (small sample) |
| P27 | Pump (all) / centrifugal | λ 0.00631 / 0.00581 /yr; MTTR 7.09 / 6.75 h | — | same | H |
| P28 | Air handling unit | λ 0.01100 /yr; MTTR 2.36 h | — | same | H |
| P29 | Fan, centrifugal | λ 0.01916 /yr; MTTR 24.47 h | — | same | H |
| P30 | Cooling tower (all) | λ 0.03218 /yr; MTTR 80.89 h | — | same | H |
| P31 | Refrigerant compressor, screw | λ 0.05517 /yr; MTTR 10.83 h | — | same | H |
| P32 | Control system (>1k points) | λ 0.84676 /yr; MTTR 3.68 h | — | same | H |
| P33 | Temperature sending unit (sensor) | 0 failures in 26,420 unit-yrs (λ ≤ 0.00002 /yr) | — | same | H |
| P34 | MTTR definition caveat | MTTR = repair downtime / failures, **excluding** logistics delay (parts, crew) | — | same, Table 5-1 | H |
| P35 | Compressor replacement lead time | "at least a 7–10 day lead time" (single anecdote, 2019) | days | https://lists.osgeo.org/pipermail/sac/2019-October/011541.html | L |
| P36 | Chiller restart after power loss | typically 10–15 min; newer 4–5 min ("60% reduction") | min | WP-179 p.9 | H |
| P37 | Rapid restart (vendor) | Trane: ≤120 s, 80% capacity at ~160 s, 100% at ~250 s; Daikin: restart 35 s, 80% load at 75 s; JCI at RagingWire: 13 min → <3 min | s | https://support.trane.com/hc/en-us/articles/19411961163021-Data-Centers-Rapid-Restart ; https://www.healthcarefacilitiestoday.com/posts/Daikin-Magnitude-Chillers-with-RapidRestore-offers-world-class-reload-speeds-for-mission-critical-applications--3764 ; https://datacenterknowledge.com/business/speeding-up-those-chiller-restarts | M |
| P38 | CRAH (room) unit size | Liebert CW: 38–181 kW (10–52 t) | kW | https://www.vertiv.com/en-us/products-catalog/thermal-management/room-cooling/liebert-cw-chilled-water-cooling-system-038-181kw/ | M |
| P39 | In-row CW cooler | Liebert CRV 32 kW total (28.6 kW sensible), 2,250 CFM; CRV up to ~60 kW | kW | https://www.vertiv.com/en-emea/products-catalog/thermal-management/in-row-cooling/cr032rc-chilled-water-32kw | M |
| P40 | Chiller-plant oversizing example | 1 MW design hall with 100 kW day-one load: installed chillers ≈250 kW total ≈140 kW IT | kW | WP-179 p.8 | H |
| P41 | Chiller efficiency vs setpoint | ≈3.5% chiller power saved per +1 °C CHW setpoint | %/°C | WP-179 p.7 | H |
| **Mitigations: cost and timing** |
| P42 | Rental chiller list price (equipment only) | 30 t: $950/d, $3,800/wk, $9,500/28 d; 60 t: $1,500/d; 100 t: $2,200/d, $8,800/wk; 200 t: $3,800/d, $15,200/wk. Add-ons: hoses $300/d, pump $450/d, HX $550/d. Excludes freight, mobilisation, installation, fuel, power, glycol | USD | Northstar Chillers — https://www.northstarchillers.com/rentals (ignore the page's customer-specific doubled schedule) | M |
| P43 | Rental chiller large unit | 500 t, 1,000–1,500 gpm, 480 V 3φ, 32,000 lb, 22.6 × 8 × 10.2 ft, LWT 40–65 °F | — | Aggreko — https://www.aggreko.com/en-us/products/hvac/cooling/chillers/water-cooled/chiller-500-ton | H (spec) |
| P44 | Rental 500 t weekly | $8,666/wk (marketplace listing) | USD | https://www.kwipped.com/rentals/product/500-ton-air-cooled-chiller/15352 (search snippet) | L |
| P45 | Rental delivery | ICS Cool Energy: >500 MW fleet, "next day delivery", same-day subject to availability, 3 kW–1.4 MW units, 24/7 install and commissioning | h | https://www.icscoolenergy.com/chiller/chiller-hire/emergency-chiller/ | M (vendor claim) |
| P46 | Rental install/run costs | Installation $30,000–75,000 one-off; fuel/power $10,000–30,000/month; maintenance $5,000–10,000/month | USD | https://onsiteutilityservices.com/the-true-cost-of-temporary-chillers/ | L–M |
| P47 | Spot cooler | 5 t (60,000 BTU/h) to 10 t (120,000 BTU/h); 5 t unit 1,650–1,900 CFM; "typical cost … about $600 per month" | — | United Rentals — https://www.unitedrentals.com/marketplace/equipment/hvac-equipment/air-conditioners/5-ton-spot-cooler-460v ; https://www.unitedrentals.com/project-uptime/equipment/temporary-cooling-wont-break-budget/ (403 on fetch, figure from snippet) | L |
| P48 | Unit conversion | 1 ton refrigeration = 12,000 BTU/h ≈ 3.517 kW (from P47: 5 t = 60,000 BTU/h; 1 W = 3.412 BTU/h) | — | definitional, via P47 | H |
| P49 | VM live migration | ~4 s per VM on 10GE (modelled); vCenter default 8 concurrent vMotions/host; host evacuation "can be several minutes"; guest pause ms to s | s | https://blog.ipspace.net/2016/09/how-many-vmotion-events-can-you-expect/ ; https://blogs.vmware.com/performance/?p=4540 ; https://docs.platform9.com/private-cloud-director/virtualized-clusters/virtualmachine/vm-migration | M |
| P50 | Server power capping | ≈20% server power reduction on an I/O-heavy workload with no runtime impact; enforced via P-/T-states | % | Intel IT case study — https://www.intel.com/content/dam/www/public/us/en/documents/case-studies/intel-it-power-management-technologies-case-study.pdf | M |
| P51 | Effect of fast chiller restart / UPS on fans and pumps | Fans + pumps on UPS remove the initial spike; restart 12 → 5 min drops peak from 106 °F to 98 °F; all strategies together → never exceeds limit | — | WP-179 p.10, Fig. 4 | H |
| **Business impact** |
| P52 | Outage cost (Uptime 2025 report) | 54% said their latest significant outage cost >$100k; 20% said >$1M. **Conflict:** `01-outage-evidence.md` attributes 54% / 16% to the 2024 exec summary (2023 survey) | % | https://www.businesswire.com/news/home/20250506733553/en/Uptime-Announces-Annual-Outage-Analysis-Report-2025 | M |
| P53 | Outage cost (Uptime 2026 report) | 57% >$100k; 1 in 5 >$1M | % | https://www.businesswire.com/news/home/20260513289344/en/Uptime-Announces-Annual-Outage-Analysis-Report-2026 (403 on fetch; secondary summaries) | M |
| P54 | Cooling share of outages | Cooling is the #2 cause after power; 13% of respondents had one (2025). Another survey summary says 14%. `01-outage-evidence.md` has 19% of most-recent impactful outages (2023 survey) | % | https://www.computerweekly.com/news/366623669/Datacentre-outages-decreasing-in-frequency-Uptime-Institute-Intelligence-data-shows | M |
| P55 | Human error | Nearly 40% of orgs had a major human-error outage in 3 yrs; 85% of those from not following procedures or flawed procedures | % | https://uptimeinstitute.com/about-ui/press-releases/uptime-announces-annual-outage-analysis-report-2025 | H |
| P56 | Ponemon/Emerson 2016 | Average $740,357/outage; $8,851/min; max $2,409,991; n = 63 US orgs; UPS top cause (~25%) | USD | https://www.vertiv.com/it-emea/about/news-and-insights/news-releases/2016/emerson-network-power-study-says-unplanned-data-center-outages-cost-companies-nearly-%249000-per-minute/ | H |
| P57 | Average unplanned outage duration (2016) | 95 min | min | Statista — https://statista.com/statistics/666816/united-states-data-centers-unplanned-outage-cost-per-minute (snippet) | L |
| P58 | Colo pricing (North America) | "$200+ per kW per month" asking rate, 250+ kW at N+1/Tier III; vacancy 1.6% | $/kW-mo | CBRE H1 2025 — https://www.cbre.com/insights/briefs/north-america-data-center-trends-h1-2025-ai-and-hyperscaler-demand-lead-to-record-low-vacancy | H |
| P59 | Colo pricing (average lease, full-year) | $194.95/kW-month, +6.5% YoY | $/kW-mo | CBRE via MBA NewsLink — https://newslink.mba.org/?p=272101 (snippet) | M |
| P60 | Global colo pricing Q1 2025 | $217.30/kW-month | $/kW-mo | CBRE Global DC Trends 2025 — https://www.cbre.com/insights/reports/global-data-center-trends-2025 (snippet) | M |
| P61 | Digital Realty environmental SLA | Average cold-aisle temperature 64.4–80.6 °F (18–27 °C), RH 25–65%. Breach = sustained >15 continuous min. Credit = 2 days of space fee per occurrence (temperature; same for humidity). Power (redundant): 1 s–30 min → 2 days of space+power; 31–60 min → 4 days; >60 min → 1 week. Chronic: ≥4 h/month in 2 consecutive months, or >8 consecutive h → tenant may terminate | — | https://marketplaceportal.com/documents/10139/3596013/Colocation-Service-Availability-Metric | H |
| P62 | Equinix (via Verizon service guide) | Unavailable if <18 °C or >27 °C per cabinet; after the 12-month threshold, credit = 1/30 of the loaded-cabinet MRC, plus the same per extra full hour | — | https://www.verizon.com/business/service_guide/reg-20190617/cp_colocation_equinix_data_centers_sla.pdf (404 on fetch; from search summary) | L–M |
| P63 | phoenixNAP (older colo addendum) | Temperature: 5% of the affected area's MRC per 4-h failure, 10% if critical; humidity 5% / 10% (later superseded: breaches that don't cause unavailability give no credit) | % MRC | https://www.phoenixnap.com/cs/legal/colo.html ; https://www.phoenixnap.com/cs/legal/cslaa.html | M |
| **Telemetry** |
| P64 | BMS trend interval (public-sector example) | CHWS/CHWR temperatures and % load trended at 15 min, 0.1 resolution | min | https://www.durhamnc.gov/DocumentCenter/View/64565 | M |
| P65 | Chiller trend points (data center retro-commissioning) | 18 trended points per chiller (5 centrifugal chillers); trend interval lengthened to protect BAS network | — | https://www.csemag.com/articles/case-study-retro-commissioning-a-data-center | M |
| P66 | Modern BMS event schema (NVIDIA DSX) | CRAH point payload `{value, timestamp (epoch ms), quality (1 = good)}`; point types include LiquidTemperature, LiquidDifferentialPressure, LiquidFlow, LiquidPressure, Status, Available (17 total) | — | https://docs.nvidia.com/dsx-exchange/schema/bms-event-bus/operations/crah/crah-value | M |
| P67 | Pump affinity laws | Q ∝ n; ΔP ∝ n²; P ∝ n³ | — | https://www.engineeringtoolbox.com/affinity-laws-d_408.html | H |

---

## 4. Heat model

### 4.1 Two-node lumped model (recommended)

The air node is fast. The thermal-mass node (servers, racks, plenum) is slow. WP-179 explains why one node is not enough: right after the failure, "all of the IT power will simply heat the air". After that, servers act as "thermal sponges".

```
C_air · dT_a/dt = P_IT − Q_cool(T_a) − G·(T_a − T_m)
C_m   · dT_m/dt = G·(T_a − T_m)

C_air = V_room · ρ_air · cp_air          (ρ 1.205 kg/m³, cp 1.006 kJ/kg·K; P11)
C_m   = N_servers · 11.1 kJ/K            (P9)   [or rack_mass · 0.5–0.9 kJ/kg·K; P10]
G     ≈ Σ rack airflow · ρ · cp          (125 cfm/kW · P_rack; P5)  — server-to-air coupling, derived
```

The cooling term with chilled-water ride-through is:

```
Q_cool(T_a) = min( Q_avail ,  Q_design · (T_a − T_chws) / (T_ret_design − T_chws) )      [assumption: coil capacity ~ linear in approach]
Q_avail     = Σ running chillers kW (+ standby after restart_delay) + rental kW (after delivery+hookup)
If the chiller is lost but CHW pumps and CRAH fans still run, the loop water is a buffer:
E_store = V_water · 1000 · 4.19 kJ/kg·K · (T_lim_chw − T_chws)    (P12)  -- drawn down at the deficit rate
```

Shedding load lowers `P_IT`. Rental cooling raises `Q_avail`.

**Countdown.** `minutes_to_limit` = first t where T_a ≥ T_limit, integrated forward at 1-s steps from now with current P_IT and Q_avail. If Q_avail ≥ P_IT at an equilibrium T_a below the limit, it is null ("no countdown", as for degradation or a leak).

### 4.2 Sanity check against published data (derived, our arithmetic)

We ran the model above (`sim.py`, our arithmetic) on WP-179 Example 1 geometry (P2): 3,312 m³ of air, 400 kW, 100 racks, total cooling loss, starting at 24 °C. It reaches 32 °C at about **1.9 min** and 45 °C at **8–14 min**, depending on rack thermal mass (100–272 kJ/K per rack). WP-179 shows the allowable limit exceeded within the first minute, and its CFD case is "unacceptably hot everywhere after about 5 min". Our numbers are the same order of magnitude. Single-node bulk rates for a fully loaded hall come out at about 1–2 °C/min, which matches the measured incidents (P7, P8).

Synthetic hall: 1,000 m² × 4 m, 200 racks × 8 kW = 1.6 MW, starting at 24 °C, fixed Q_cool, no equilibrium term.

| Cooling still available | to 27 °C | to 32 °C | to 35 °C | to 45 °C |
|---|---|---|---|---|
| 0 kW (total loss) | 0.2 min | 0.6 min | 1.0 min | 5.0 min |
| 800 kW (50%) | 0.4 | 2.5 | 5.5 | 15.7 |
| 1,200 kW (75%) | 1.2 | 10.6 | 16.8 | 37.3 |
| 1,440 kW (90%) | 9.6 | 35.2 | 50.6 | 102 |

What the table shows (derived): even a 10% deficit hits the A1 allowable limit in about 35 min. The decision window is minutes to an hour, while repair takes hours (P23–P30). In-house levers therefore have to bridge the gap: load shed, standby chiller, CHW storage. Rentals only arrive in about a day (P45), so they cover the rest of the repair.

### 4.3 Simpler single-node option (if time is short)

```
dT/dt [°C/s] = (P_IT_kW − Q_cool_kW) / C_eff_kJ_per_K
C_eff = C_air + C_m     (use ~30–50 MJ/K per MW of IT as a calibrated starting value: gives 1–2 °C/min on total loss, matching P7/P8; derived)
```

This is a linear balance: temperature change per unit time = (heat in − heat removed) / thermal capacitance.

---

## 5. Proposed synthetic dataset

Three files (`network.json`, `ops.json`, `telemetry.csv`) plus an `answer_key.json`. The time range comes from telemetry. 1-minute cadence is recommended, because thermal events play out over minutes. P64 shows BMS trends at 15 min in practice. Note that 15-min trends would miss the event. (Cascade's shipped DFW1 seed uses different, document-shaped inputs; see the repo README. This section is the earlier telemetry-driven proposal.)

### network.json

```json
{
  "defaults": { "inlet_limits_c": { "warning": 27.0, "shutdown": 32.0, "server_trip": 42.0 },   // P15, P16, P20
                "ashrae_class": "A1" },
  "sites": [{
    "site_id": "DFW1", "name": "Dallas Campus 1", "lat": 32.90, "lon": -96.96, "tier": "III",       // P22
    "plant": {
      "chillers": [ {"id":"DFW1_CH1","capacity_kw":1758,"type":"centrifugal","restart_s":720}, // 500 t ×3.517 (P43,P48); 12 min (P2)
                    {"id":"DFW1_CH2","capacity_kw":1758,"type":"centrifugal","restart_s":120}, // rapid restart (P37)
                    {"id":"DFW1_CH3","capacity_kw":1758,"type":"centrifugal","restart_s":720,"role":"standby"} ],
      "chw_pumps":  [ {"id":"DFW1_P1","design_gpm":1250,"design_dp_kpa":150}, ... ],          // gpm in Aggreko's 1,000–1,500 range (P43)
      "chws_setpoint_c": 7.2, "chw_design_dt_c": 8.3,                                           // P2
      "storage_tank_m3": 4.9                                                                    // 1,300 gal (P6)
    },
    "halls": [{
      "hall_id": "DFW1_H1", "floor_m2": 1000, "height_m": 4.0, "plenum_m": 0.6,
      "crahs": [ {"id":"DFW1_H1_CRAH1","capacity_kw":146,"airflow_m3s":7.0}, ... ],             // CW146 (P38)
      "racks": [ {"rack_id":"DFW1_H1_R001","tenant_id":"T_ACME","design_kw":8.0,"servers":20} ] // <8 kW avg (P13)
    }]
  }],
  "tenants": [ {"tenant_id":"T_ACME","contracted_kw":400,"price_per_kw_month":200,               // P58
                "sla":{"temp_band_c":[18,27],"breach_after_min":15,"credit":"2_days_space_fee",  // P61
                       "chronic_hours_month":4,"chronic_consecutive_hours":8},
                "migratable_fraction":0.6, "cappable_fraction":0.2 } ]                          // P50 ~20% cap; migratable share = assumption, see gaps
}
```

### ops.json

```json
{
  "expected_repair_hours": { "chiller": 12.6, "chw_pump": 7.1, "crah": 2.4, "cooling_tower": 80.9 },  // P23,P27,P28,P30
  "rental_cooling": {
    "units": [ {"type":"chiller_100t","kw":352,"cost_per_day":2200,"mobilization":30000},         // P42,P46
               {"type":"chiller_200t","kw":703,"cost_per_day":3800,"mobilization":30000},
               {"type":"spot_cooler_5t","kw":17.6,"cost_per_day":20} ],                          // P47 ($600/mo ÷ 30)
    "delivery_min": 1440, "hookup_min": 240                                                       // next-day (P45); hookup = assumption
  },
  "sites": { "DFW1": { "rental_fleet_size": 4, "standby_chillers": 1 } },
  "load_shed": { "migrate_s_per_vm": 4, "max_concurrent_per_host": 8, "cap_reduction_frac": 0.20 }, // P49, P50
  "penalties": { "downtime_cost_per_min": 8851 }                                                  // P56 (generic, optional)
}
```

### telemetry.csv

Columns: `timestamp, ts_unix, asset_id, metric, value`. Add `quality` (P66) if we want sensor faults to be explicit.

| Asset | Metric | Normal range (source) |
|---|---|---|
| Chiller | `status` (0 off, 1 run, 2 fault), `chws_c` ~7.2 (P2), `chwr_c` ~15.5 (7.2 + 8.3, P2), `load_kw`, `power_kw` | |
| CHW pump | `status`, `flow_gpm` ≈ design, `dp_kpa`, `speed_pct`, `power_kw` | affinity laws (P67) |
| Plant loop | `supply_c`, `return_c`, `flow_gpm`, `makeup_water_lpm` (leak indicator) | |
| CRAH | `status`, `fan_pct`, `valve_pct`, `supply_air_c` ~20 (P2), `return_air_c` | |
| Rack | `inlet_c` 18–27 (P15), `power_kw` ≈ design × utilisation | |
| Hall | `avg_inlet_c`, `max_inlet_c`, `it_kw` | |
| Tenant | `it_kw`, `capped` 0/1, `migrated_kw` | |

**Event signatures** (how each one shows up; physics from P2 and P67, magnitudes synthetic):

- **Pump failure.** `status` goes to 2. Within one sample, `flow_gpm` and `dp_kpa` drop to ~0 and `power_kw` to 0. CRAH `valve_pct` saturates at 100. CRAH `supply_air_c` rises, then rack `inlet_c` climbs at the model rate. This one gets a countdown.
- **Pump degradation.** At constant `speed_pct`, `flow_gpm` and `dp_kpa` drift down by a few percent per day, with `power_kw` flat or up. The affinity-law ratio Q/n falls. Return-water ΔT rises because the same heat is carried in less flow. No countdown yet. Action: inspection.
- **Chiller trip.** `status` goes to 2 and `chws_c` rises toward `chwr_c` as the loop buffer drains (E_store). The standby chiller starts after `restart_s`.
- **Leak.** `makeup_water_lpm` above 0. Plant `flow_gpm` exceeds the sum of CRAH flows. Loop pressure sags. No thermal effect unless the leak is large. Action: inspection.
- **Sensor fault.** One rack `inlet_c` jumps, sticks or flatlines (or `quality` ≠ 1) while its neighbours, CRAH return air and power stay normal. Physically inconsistent, so it must **not** trigger load shedding. This is a good demo of "connect fragmented data". TM 5-698-5 shows temperature sensors themselves almost never fail (P33), while control systems fail often (P32), so faults should come mostly from comms/BMS, e.g. `quality = 0` or a frozen value.

### answer_key.json

`event_id, site_id, hall_id, asset_id, category ∈ {chiller_failure, pump_failure, crah_failure, pump_degradation, chw_leak, sensor_fault}, onset, end, reference_action` (e.g. `{shed: [{tenant, kw, start_min}], standby_start: true, rentals: [...] }`).

### Plan cost rules

```
shed cost (tenant)      = SLA credit if its inlet SLA is breached anyway, else contracted revenue at risk
                          ≈ price_per_kw_month / (30·24) · kW_shed · hours   (P58)   [lower bound; real tenant loss is higher, P52–P56]
temperature breach cost = per tenant in hall: 2 days of space fee per occurrence >15 min (P61)
                          [space fee ≈ contracted_kw · price_per_kw_month is a proxy; DLR credits space-only fee]
thermal shutdown cost   = all hall tenants: power-outage credit (2 days / 4 days / 1 week by duration, P61)
                          + chronic-termination risk if >8 h (P61) + optional $8,851/min (P56)
rental cost             = mobilization + cost_per_day · days_until_repair_end; capacity counts only after delivery+hookup
standby chiller         = $0 marginal; capacity after restart_s
```

---

## 6. Open gaps (couldn't find or couldn't verify)

- **The WebSearch budget for the session ran out mid-research.** Items not searched further: Ponemon 2016 cost by root cause (water/heat/CRAC share); published pump degradation signatures; heat-wave outage case studies (e.g. London 2022, which we did not verify, so it is not cited here; `01-outage-evidence.md` §3 covers Google/Oracle London 2022 from the incident reports).
- **No public rental-chiller lead time for a specific 500 t unit.** Only vendor "next day" / "24 h" claims (P45). Hookup time (we assumed 240 min) is **unsourced**: treat it as a tunable.
- **Rental prices are list prices from one small vendor (P42) and one marketplace snippet (P44).** Aggreko, Carrier and Trane publish no prices. The all-in cost (freight, power, install) is only from a low-confidence blog (P46).
- **Equipment failure data is old (2006, PREP).** It is not data-center-specific, and its MTTR excludes parts logistics (P34). No CRAH-specific rate exists; we use AHU (P28) and centrifugal fan (P29) as proxies. Other pump and electrical reliability sources, which disagree with the PREP pump rate by orders of magnitude, are in `08-equipment-reliability.md`.
- **There is no standard server shutdown temperature.** It is a configurable per-platform alert action (P21). Use 42 °C (P20) or 47 °C (P19) as a parameter, not a fact.
- **Equinix SLA terms (P62) come from a search summary.** The PDF returned 404. Only the Digital Realty SLA (P61) was read in full.
- **Migratable / cappable fraction per tenant is not published anywhere we found.** It is a synthetic assumption. The only anchor is the ~20% cap reduction (P50).
- **Tenant revenue loss per kW-hour of shedding is not published.** We use the colo price (P58) as a floor and the outage surveys (P52–P56) as a ceiling.
- **The Opengate "5 kW/cabinet → thermal shutdown within 3 minutes" claim** appeared in a search snippet, but we could not tie it to a fetchable page, so it is excluded.
- **Telemetry sampling.** We found only 15-min BMS trend examples (P64). There is no published standard for 1-min DCIM rack inlet polling, so our 1-min cadence is a design choice.
- **The coil-capacity-vs-approach linearity in Q_cool(T)** is our modeling assumption and is unsourced. A fixed-Q model (§4.2 table) is the conservative alternative.
