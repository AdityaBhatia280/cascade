# 09 — Maintenance Workforce and Work Orders

**Scope:** labor cost loading and contractor billing for electrical maintenance, facilities response-time tiers, electrical-work safety rules, and a CMMS data model (Maximo / ISO 14224) for asset registers, work orders and maintenance history. **Researched:** 2026-11-07.

All values are from cited public sources. **Derived** = arithmetic on cited numbers (formula shown). Nothing here is CBRE data. CBRE's own Smart FM claims (Nexus, Virtual Maintenance, 15M work orders/yr) are in `05-cbre-insights.md` §11. Data center operations staffing and turnover (Uptime surveys) are in `03-buyers-and-workflow.md` §6.

This file was trimmed from an earlier scan written for an oilfield maintenance layer. Permian Basin wage pulls, oilfield drive times, shift rotations, certifications and licensing exemptions were dropped; see "Dropped" at the end.

Confidence: **high** = primary source read directly; **medium** = secondary source, or primary source seen only through a search excerpt; **low** = inferred or anecdotal.

---

## 1. Summary

- **Loaded cost (high).** BLS ECEC, Dec 2025: for installation, maintenance and repair occupations, total compensation is $48.32/h against $33.18/h in wages. That is a multiplier of about 1.46 (derived).
- **Contractor billing (medium/high).** A Texas public bid tabulation (San Antonio Water System, 2017) gives regular rates of $52.50–60/h for a journeyman electrician, $70–80/h for a master electrician, and $85–150/h for electrical test/field-service technicians. Overtime is 1.28–1.5× and weekend/holiday is 1.36–1.9×. Material mark-up is capped at 20%. On GSA MAS ceiling rates, journeyman electricians have a median of about $106/h. Emergency call-outs commonly carry a 2–3 hour minimum charge.
- **Response tiers (high, but facilities-sector only).** Public FM SLAs follow a pattern: Emergency means respond within about 1–2 h and make safe, Urgent means within 24 h, and Routine means days. These come from public-sector and university FM contracts, not data center operators.
- **Electrical-work constraint (high).** OSHA 1910.333(c)(2) says only *qualified persons* may work on parts that are not de-energized. Live parts must be de-energized before work (except < 50 V to ground) and locked out or tagged. NFPA 70E adds an Energized Electrical Work Permit.
- **Data model (high).** Maximo field names (WONUM, ASSETNUM, WOPRIORITY, FAILURECODE/PROBLEMCODE, TARGSTARTDATE, ACTSTART/ACTFINISH, ACTLABHRS, ...) and its status lifecycle (WAPPR→APPR→INPRG→COMP→CLOSE, plus CAN, WMATL and WSCH) are documented. ISO 14224 failure-record fields come from an ISO/TC67 WG4 presentation. These are the backbone of the schema in §3.

---

## 2. Parameter table

### 2.1 Wages: in-house (BLS OEWS, May 2025, hourly, $/h)

Source: BLS OEWS May 2025 metropolitan file `oesm25ma.zip` → `MSA_M2025_dl.xlsx`, https://www.bls.gov/oes/special-requests/oesm25ma.zip (downloaded and parsed 2026-11-07). Confidence: **high**. Only the non-Permian rows are kept here; the file covers every metro, so Dallas–Fort Worth rows for other crafts can be re-pulled with the command in "Reproducibility notes".

| Parameter (SOC) | Area | Employment | p10 | p25 | Median | Mean | p75 | p90 |
|---|---|---|---|---|---|---|---|---|
| Millwrights (49-9044) | Houston, TX | 820 | 22.19 | 28.15 | 32.57 | 34.69 | 41.64 | 49.77 |
| Millwrights (49-9044) | Dallas-FW, TX | 640 | 21.42 | 22.40 | 31.49 | 31.77 | 38.12 | 44.47 |

Notes: OEWS is base wages only. It excludes overtime premiums, shift differentials and per-diem.

### 2.2 Labor cost loading, overtime and contractor billing

| Parameter | Value / range | Units | Source | Confidence |
|---|---|---|---|---|
| Employer total comp, installation/maintenance/repair occupations (private, Dec 2025) | 48.32 total = 33.18 wages + 15.13 benefits | $/h worked | BLS ECEC news release, Mar 20 2026, Table 4 — https://www.bls.gov/news.release/archives/ecec_03202026.htm | high |
| Benefits share of compensation, all private industry (Dec 2025) | 29.9 | % | same, Table 1 | high |
| Total comp, South region, private (Dec 2025) | 41.21 (29.54 wages + 11.67 benefits) | $/h | same, Table 7 | high |
| **Loaded-cost multiplier on wage** (derived: 48.32 / 33.18) | ≈ 1.46 | × | derived from ECEC row above | high (derived) |
| Statutory overtime for non-exempt employees | 1.5× regular rate for hours > 40 per workweek | × | US DOL WHD, FLSA overtime — https://www.dol.gov/agencies/whd/overtime | high |
| Contractor regular rate, Master Electrician (Mon–Fri 8–5) | 70.00–80.00 (4 bidders) | $/h (2017) | San Antonio Water System, Bid Tab 17-17000 "Annual Contract for Electrical Maintenance and Repair Services", Apr 18 2017 — https://apps.saws.org/Business_Center/ProcBids/IFB%5C1902%5Celectrical%20maint%20repair%20svcs%2017-17000.pdf | high |
| Contractor regular rate, Journeyman Electrician | 52.50–60.00 | $/h (2017) | same | high |
| Contractor regular rate, Apprentice / Helper | 30.00–41.36 / 20.00–31.25 | $/h (2017) | same | high |
| Contractor regular rate, Electrical Test Technician IV ("Sr. Field Services Technician") | 105.00–150.00 | $/h (2017) | same | high |
| Contractor regular rate, ETT-III ("Field Services Technician") | 101.00–150.00 | $/h (2017) | same | high |
| Contractor overtime rate, Journeyman / Master | 75.00–90.00 / 95.00–120.00 | $/h (2017) | same, Group C | high |
| Contractor weekend/holiday rate, Journeyman | 75.00–106.71 | $/h (2017) | same, Group D | high |
| **Contractor OT multiplier** (derived per bidder, OT ÷ regular, journeyman and master) | 1.28–1.50 | × | derived from SAWS tab | high (derived) |
| **Contractor weekend/holiday multiplier**, journeyman (derived) | 1.36–1.91 | × | derived from SAWS tab | high (derived) |
| Contractor parts/material mark-up | 0–20 (contract cap 20%) | % | SAWS tab, Group E | high |
| Contractor rates, union electrical contractor (WV, 2021 renewal) | Journeyman 78.49 normal / 112.02 OT; Apprentice 73.14 / 102.00; materials cost + 5% | $/h | Marshall University contract MU17ELECTRIC co5 — https://www.marshall.edu/purchasing/files/MU17ELECTRIC-co5-Contract.pdf | high |
| **Emergency call-out minimum charge** | 2 h of the technician's applicable rate. No trip charge for non-emergency work | h | Marshall University contract MU17ELECTRIC co5 (same URL) | high |
| Emergency/job minimum, small Texas electrical contractor | 3-h minimum on every job; OT from 3 pm weekdays and all weekend (Electrician 75 → 187.50/h commercial, i.e. 2.5×); mileage $1.80/mi outside town | $/h, h | S.C.I. Electrical Services (El Campo, TX) rate page — https://sci-website.pages.dev/rates | medium (single vendor) |
| Emergency minimum, practitioner anecdote | 4-h minimum on emergency calls; 1.5× after hours, 2× Sundays/holidays | h, × | Mike Holt forum thread — https://forums.mikeholt.com/threads/after-hour-rate.38337/page-2 | low |
| GSA MAS ceiling rate, "Journeyman Electrician" (n=24 matches) | min 59.50 · p25 88.29 · median 105.63 · p75 141.52 · max 251.89 | $/h (current-year ceiling price) | GSA CALC API, keyword search, 2026-11-07 — https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/?keyword=Journeyman%20Electrician | high (data), medium (keyword match is fuzzy) |
| GSA MAS ceiling, "Master Electrician" (n=30) | 79.23 · 96.98 · 126.26 · 162.55 · 263.00 | $/h | GSA CALC API, same method | high/medium |
| GSA MAS ceiling, "Millwright" (n=50; includes apprentices) | 38.88 · 56.96 · 70.21 · 95.09 · 196.17 | $/h | GSA CALC API, same method | medium |
| GSA MAS ceiling, "Maintenance Mechanic" (n=140) | 37.03 · 57.30 · 67.71 · 90.27 · 279.76 | $/h | GSA CALC API, same method | medium |
| GSA MAS ceiling, "Field Service Technician" (n=78; includes IT/satellite field techs) | 41.94 · 75.12 · 90.88 · 134.84 · 239.94 | $/h | GSA CALC API, same method | medium |

### 2.3 Response times and SLAs

| Parameter | Value / range | Units | Source | Confidence |
|---|---|---|---|---|
| Emergency: response | within 2 h; "make safe" immediately; permanent repair TBD | h | DC Dept. of General Services FMD, FY-19 Official SLA, Attachment A — https://dgs.dc.gov/sites/default/files/dc/sites/dgs/publication/attachments/J.13%20DGS%20Service%20Level%20Agreements.pdf | high |
| High priority: response / completion | within 72 h / < 10 days unless on HOLD | h / days | DC DGS SLA (same) | high |
| Routine: response / completion | within 96 h / < 45 days | h / days | DC DGS SLA (same) | high |
| Work-request triage (approve/reject) | within 1 h | h | DC DGS SLA (same) | high |
| Emergency close-out after completion | within 24 h | h | DC DGS SLA (same) | high |
| Emergency / Urgent / Expedited / Routine / Fixed tiers | Immediate (OT authorized) / ≤24 h (1 business day) / 1–5 business days / 6–10 business days / >10 days (default 20) | — | Univ. of Minnesota FM Response Time Standards, updated 3/1/2021 — https://facilities-d8.prd.umn.edu/sites/facilities.umn.edu/files/2021-02/fm_service_response_time_standards_-_updated_2-22-21.pdf | high |
| Emergency attend time (UK university FM SLAs) | 1 h (Kent P1, Napier, Lincoln); Lincoln: restore within 24 h; urgent attend 4 h | h | Univ. of Kent https://www.kent.ac.uk/estates/helpdesk/maintenancelevels.html ; Lincoln https://estates.lincoln.ac.uk/services/maintenance/sla/ (search excerpts) | medium |
| Routine on-site, HVAC on-call bid (Virginia) | 24–48 | h | BidNet solicitation excerpt — https://www.bidnetdirect.com/virginia/solicitations/closed-bids/statewide/Preventative-Maintenance-and-On-Call-HVAC-Services/443615807035 | medium |
| Ambiguity warning | A 2024 GSA OIG audit found "24-hour" interpreted as three 8-h workdays; define clock-hours versus business-hours explicitly | — | Simpro blog citing GSA OIG — https://www.simprogroup.com/blog/service-level-agreements-maintenance-contracts | medium |
| **Suggested synthetic tiers** (derived from the rows above) | P1 Emergency: respond ≤ 1–2 h, make-safe; P2 Urgent: ≤ 24 h; P3 Routine: 3–5 days; P4 Planned/PM: scheduled | — | synthesis of DC DGS + UMN + UK SLAs | medium (derived) |

These are FM service-response tiers (how fast a technician shows up). Colo customer SLAs (power/temperature credits) are a different thing; see `03-buyers-and-workflow.md` §3.

### 2.4 Qualifications and electrical-work rules

| Parameter | Value / range | Units | Source | Confidence |
|---|---|---|---|---|
| De-energize rule | live parts must be de-energized before work, except < 50 V to ground | V | 29 CFR 1910.333(a)(1) — https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.333 | high |
| Energized-work constraint | "Only qualified persons may work on electric circuit parts or equipment that have not been deenergized" | — | 29 CFR 1910.333(c)(2) (same URL) | high |
| Lockout/tagout | circuits energizing parts "shall be locked out or tagged or both"; 1910.147 procedures acceptable | — | 29 CFR 1910.333(b)(2) (same URL) | high |
| NFPA 70E "qualified person" | employer-determined, task-specific; energized work needs justification + Energized Electrical Work Permit (Art. 110.6, 130.1, 130.2) | — | secondary summaries: e-hazard https://e-hazard.com/what-is-an-nfpa-70e-qualified-person/ ; UVA EHS https://ehs.virginia.edu/Electrical-Safety/Qualified-Person (standard itself paywalled) | medium |
| Texas license classes (for skill tags) | Apprentice, Journeyman, Journeyman Industrial (optional), Maintenance, Master Electrician; Electrical Contractor | — | TDLR Electrician FAQ — https://www.tdlr.texas.gov/electricians/elecfaq.htm | high |
| Wrench time (share of shift on hands-on work) | typical 18–30%; "world class" 55–65% | % | ReliaMag guide (cites Smith & Mobley, Palmer) — https://reliamag.com/guides/wrench-time-benchmarks-typical-good-and-world-class-rates/ | low/medium |
| Technician-to-asset ratio | **not found** in a citable source | — | — | gap |

NFPA 70B (maintenance program, accurate single-line diagrams) is covered in `03-buyers-and-workflow.md` §2. MOP authorship and approval chains are in `03-buyers-and-workflow.md` §1.

---

## 3. Proposed schemas

Field names follow Maximo where one exists, so the data reads as CMMS-native. ISO 14224 fields are added for failure coding. Example values are illustrative placeholders in the style of Cascade's DFW1 seed, not data.

### 3.1 Asset registry (`assets`)

| Field | Type | Example | Source |
|---|---|---|---|
| assetnum | string (PK) | `UPS-A` | Maximo ASSET.ASSETNUM — https://bportaluri.com/wp-content/MaximoJavaDocs76/psdi/app/asset/Asset.html |
| siteid | string | `DFW1` | Maximo ASSET.SITEID (same) |
| description | string | `UPS A, 750 kVA` | Maximo ASSET.DESCRIPTION |
| location | string (FK → locations) | `DFW1-ELEC-A` | Maximo ASSET.LOCATION |
| parent | string (FK → assets, nullable) | `SWGR-A` | Maximo ASSET.PARENT ("zero or one parent") |
| iso_taxonomy_level | int (6–9) | `6` | ISO 14224 taxonomy: 1 Industry … 6 Equipment unit, 7 Subunit, 8 Component/Maintainable item, 9 Part — Selvik, ISO/TC67 WG4 slides https://standard.no/globalassets/fagomrader-sektorer/petroleum/rio_de_janeiro/4-collection_and_exchange_of_reliability_data-j_t_selvik.pdf ; level names via CPCON https://cpcongroup.com/insights/article/iso-14224-equipment-taxonomy/ |
| equipment_class | enum | `Switchgear` / `Frequency converter` / `Electric motor` / `Pump` | ISO 14224 Annex A classes (as reflected in the OREDA class list: Switchgear, Frequency converters, Electrical power distribution) — https://standard.no/globalassets/fagomrader-sektorer/petroleum/houston/2018-05-04---session-3.1-oreda-jip_isotc67-wg4-seminar-may-2018.pdf |
| classstructureid | string | `ELEC/UPS` | Maximo ASSET.CLASSSTRUCTUREID |
| manufacturer, vendor | string | `ACME-ELEC`, `SUPPLIER-01` | Maximo ASSET.MANUFACTURER / VENDOR |
| serialnum | string | `SN-7781-22` | Maximo ASSET.SERIALNUM |
| installdate | date | `2019-06-14` | Maximo ASSET.INSTALLDATE |
| warrantyexpdate | date | `2022-06-14` | Maximo ASSET.WARRANTYEXPDATE |
| purchaseprice, replacecost | decimal $ | `48000`, `61000` | Maximo ASSET.PURCHASEPRICE / REPLACECOST |
| priority (criticality) | int 1–5 | `1` | Maximo ASSET.PRIORITY ("copied to work orders") |
| isrunning | bool | `true` | Maximo ASSET.ISRUNNING |
| totdowntime | decimal h | `37.5` | Maximo ASSET.TOTDOWNTIME |
| budgetcost, ytdcost, totalcost | decimal $ | `5000`, `1200`, `23400` | Maximo ASSET.BUDGETCOST / YTDCOST / TOTALCOST |
| owner / responsible_party | enum | `OWNER-OPS` / `FM-CONTRACTOR` | not a Maximo field (synthetic) |
| depends_on | list[assetnum] | `[SWGR-A]` | synthetic dependency edge; Maximo models this with PARENT plus asset relationships |
| health_score | float 0–100 | `62` | modeled on CBRE's public "dynamic asset health scores" (`05-cbre-insights.md` §11). Synthetic |
| required_skill | enum | `ELEC-QUALIFIED` | OSHA 1910.333(c)(2) qualified-person rule |

### 3.2 Work order (`workorders`)

| Field | Type | Example | Source |
|---|---|---|---|
| wonum | string (PK) | `WO-2026-004812` | Maximo WORKORDER.WONUM — https://bportaluri.com/wp-content/MaximoJavaDocs76/psdi/app/workorder/WO.html |
| parent | string (nullable) | `WO-2026-004811` | Maximo WORKORDER.PARENT; DC DGS "related work order" (make-safe → permanent repair) |
| siteid | string | `DFW1` | Maximo |
| assetnum, location | string FK | `UPS-A`, `DFW1-ELEC-A` | Maximo |
| description | string | `UPS A annual maintenance (bypass)` | Maximo |
| worktype | enum | `EM` (emergency), `CM` (corrective), `PM` (preventive), `CP` (capital), `EV` (event) | Maximo work types (site-configurable) — Cornell SOP https://fcs.cornell.edu/sites/default/files/imce/site_contributor/Svc_Maximo/documents/SOP/REF%205%20-%20Maximo%20WO%20Work%20Types.pdf (search excerpt) |
| wopriority | int 1–4 | `1` | Maximo WOPRIORITY; tier meanings from §2.3 (DC DGS / UMN) |
| status | enum | `WAPPR`→`APPR`/`WSCH`/`WMATL`/`WPCOND`→`INPRG`→`COMP`→`CLOSE`; `CAN` | IBM Support "Allowable Status Changes for Work Orders" — https://www.ibm.com/support/pages/node/1112013 |
| status_history | list[{status, ts, by}] | `[{"INPRG","2026-03-02T14:40Z","T-017"}]` | Maximo WOSTATUS (history table) — referenced in IBM community thread https://community.ibm.com:443/community/user/asset-facilities/discussion/workorderstatus-different-from-last-line-in-wostatusstatus |
| reportdate, reportedby | datetime, string | `2026-03-02T13:05Z`, `BMS-ALARM` | Maximo REPORTDATE / REPORTEDBY |
| targstartdate, targcompdate | datetime | SLA-derived | Maximo TARGSTARTDATE / TARGCOMPDATE |
| schedstart, schedfinish | datetime | | Maximo SCHEDSTART / SCHEDFINISH |
| actstart, actfinish | datetime | | Maximo ACTSTART / ACTFINISH |
| checkin_ts | datetime (+GPS) | `2026-03-02T14:38Z` | DC DGS SLA "Check-in: Time and GPS stamp time of arrival" |
| sla_response_due, sla_met | datetime, bool | | DC DGS / UMN tiers (§2.3) |
| supervisor, crewid, assigned_tech | string | `SUP-02`, `ELEC-CREW-1`, `T-017` | Maximo SUPERVISOR / CREWID (assigned labor is the ASSIGNMENT table in Maximo) |
| vendor | string (nullable) | `CONTRACTOR-ELEC-03` | contractor-performed work; commonly modeled in CMMS. **Not** confirmed on the WO Javadoc page |
| downtime | bool | `true` | Maximo WORKORDER.DOWNTIME ("asset must be down") |
| failurecode / problemcode / causecode / remedycode | string | `ELEC-DIST` / `NO-OUTPUT` / `INSUL-BRKDN` / `REPLACE` | Maximo failure hierarchy (FAILURECODE top level, PROBLEMCODE second); cause/remedy levels per Maximo failure-reporting convention (not verified on page — medium) |
| iso_failure_mode | enum | `FTS` (fail to start), `STP` (spurious stop), `ELP` (external leakage), `VIB`, `OHE` | ISO 14224 failure-mode codes (examples) — https://www.fabrico.io/blog/iso-14224-failure-taxonomy-codes/ |
| iso_failure_impact | enum | `critical` / `degraded` / `incipient` | ISO 14224 / OREDA severity class — Selvik slide 17 and OREDA 2018 slides |
| impact_on_operations | enum | `zero` / `partial` / `total` | ISO 14224 failure-data table ("Failure impact on plant operations") — Selvik slide 17 |
| failure_mechanism | enum | `4 Electrical` (1 Mechanical, 2 Material, 3 Instrumentation, 4 Electrical, 5 External influence, 6 Misc.) | ISO 14224 Annex B2.2 top-level groups — Selvik slide 11 |
| failure_cause | enum | `3 Operation/maintenance` (1 Design, 2 Fabrication/installation, 3 Operation/maintenance, 4 Management, 5 Misc.) | ISO 14224 Annex B2.3 — Selvik slide 11 |
| detection_method | enum | `continuous monitoring` / `scheduled inspection` / `testing` / `casual observation` | ISO 14224 Table B.4 (summarized) — Selvik slide 17; category list via secondary sources |
| operating_condition_at_failure | enum | `running` / `start-up` / `testing` / `idle` / `standby` | ISO 14224 failure-data table — Selvik slide 17 |
| jpnum, pmnum | string | `JP-UPS-PM`, `PM-0441` | Maximo JPNUM / PMNUM |
| estdur, estlabhrs, estlabcost | decimal | `4.0`, `8.0`, `1160` | Maximo ESTDUR / ESTLABHRS / ESTLABCOST |
| actlabhrs, actlabcost, actmatcost | decimal | `9.5`, `1377`, `3400` | Maximo ACTLABHRS / ACTLABCOST / ACTMATCOST |
| est_restore_ts | datetime | | synthetic |
| glaccount | string | `6100-OPS-ELEC` | Maximo GLACCOUNT |

Lifecycle reference (plain language): DC DGS defines Requested → Approved → In Queue → Issued/In Process → Complete → Closed, with HOLD reasons for long-lead materials, funding, procurement, executive hold, project alignment, and season/weather. For an emergency, the WO is closed once the site is "made safe", and a related WO is opened for the permanent repair (source: DC DGS SLA, §2.3). SAP PM equivalent: notification M1 (request) / M2 (malfunction) / M3 (activity report). Order system status runs CRTD → REL → TECO → CLSD (SAP community / Q&A excerpts — medium; https://answers.sap.com/questions/4229095/complete-cycle-for-pm.html).

### 3.3 Maintenance history (`maintenance_events`)

ISO 14224 says maintenance data covers "maintenance action, resources used, maintenance consequence, down time", recorded as ID, date/category/activity, resources used and duration (Selvik slides 14, 18).

| Field | Type | Example | Source |
|---|---|---|---|
| event_id | string | `ME-88213` | ISO 14224 maintenance record ID (Selvik slide 18) |
| assetnum, wonum | FK | | Maximo linkage |
| failure_record_id | FK (nullable) | `FR-3301` | ISO 14224 failure record ↔ maintenance record (Selvik slide 17) |
| date | date | | ISO 14224 |
| category | enum | `corrective` / `preventive` | ISO 14224 "category" (Selvik slide 18) |
| activity | enum | `inspect` / `repair` / `replace` / `test` / `overhaul` | ISO 14224 "activity" (exact code list not retrieved — medium) |
| man_hours | decimal | `6.0` | ISO 14224 "resources used" |
| down_time_h | decimal | `11.5` | ISO 14224 "down time" |
| active_repair_h | decimal | `4.0` | OREDA data tables report "repair times" (OREDA 2018 slides). Exact ISO field name not verified |

### 3.4 Technicians / contractors (`technicians`)

| Field | Type | Example | Source |
|---|---|---|---|
| tech_id | string | `T-017` | — |
| employer_type | enum | `in-house` / `contractor` | synthetic |
| craft | enum | `ELECTRICIAN` / `MECHANIC` / `MILLWRIGHT` | BLS SOC categories (§2.1) |
| license | enum | `TX-Journeyman` / `TX-Master` / `TX-Journeyman-Industrial` / `none` | TDLR license classes |
| certs | list | `["NFPA70E"]` | NFPA 70E (§2.4) |
| qualified_energized | bool | `true` | OSHA 1910.333(c)(2) |
| base_rate / bill_rate / ot_multiplier | $/h, × | in-house: wage × 1.46 loaded. Contractor: draw from SAWS/GSA ranges, OT 1.3–1.5×, weekend 1.4–1.9× | §2.1–2.2 |
| callout_min_h | h | `2` (2–4) | Marshall contract; SCI; forum |
| on_call_until, available_from | datetime | | synthetic |

---

## 4. Open gaps (stated plainly)

1. **No data-center-specific maintenance service SLA.** The 1h/2h/24h tiers come from public-sector and university FM contracts. Label them as such.
2. **Contractor rates are public-sector contract rates** (SAWS San Antonio 2017, Marshall WV 2021) and are not inflation-adjusted. No data-center critical-facilities contractor rate sheet was found.
3. **Technician-to-asset ratio / craft headcount per RAV.** I found no citable figure. The SMRP metric "RAV per craft-wage headcount" exists, but the SMRP document is paywalled.
4. **ISO 14224 full code lists** (all failure modes per equipment class, complete detection-method and maintenance-activity tables, exact maintenance-data field names such as active maintenance time) are paywalled. I used ISO/TC67 WG4 and OREDA presentation slides plus vendor summaries.
5. **NFPA 70E text** is paywalled. The qualified-person rule is cited from OSHA 1910.333, which is primary. The 70E article numbers come from secondary summaries.
6. **CBRE's CMMS** is never named on CBRE's own pages. Do not claim CBRE uses Maximo.
7. **Failure rates / MTTR** for switchgear, motors and pumps are not covered here; see `08-equipment-reliability.md` and `06-cooling-physics.md`.

### Reproducibility notes
- BLS: `curl -A "Mozilla/5.0" https://www.bls.gov/oes/special-requests/oesm25ma.zip`, then filter `MSA_M2025_dl.xlsx` on AREA_TITLE and OCC_CODE.
- GSA CALC: `https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/?keyword=<term>&page=1&page_size=500`, using quartiles of `current_price`. Keyword matching is fuzzy (e.g. "Millwright" also returns apprentices). Pulled 2026-11-07.

## Dropped (oilfield-only)

Removed from the earlier version of this file: BLS OEWS wage rows for Midland and Odessa, TX (industrial machinery mechanics, electricians, electrical repairers, supervisors, maintenance workers, service unit operators, roustabouts) chosen for Permian oilfield staffing; oilfield electrician pay postings (Energyhire); Permian geography, lease-road speeds and pumper driving distances (Texas RRC, NM OCD permits, FleetRabbit, TruckersReport, Energyhire); oilfield electrician schedules and lease-operator rotations (Monster, Rogue Industrial et al.); H2S/PEC SafeLand field certifications; the Texas Occ. Code §1305.003(14) licensing exemption for oil and gas production electrical work; the "no public oilfield service SLA" gap; CBRE's "Upstream Sites / Midstream Sites" energy-sector page.
