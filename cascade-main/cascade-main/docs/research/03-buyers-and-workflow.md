# 03 — How the work is done today, and who buys

**Scope:** maintenance workflow (MOP/SOP/EOP, change control), standards, colo SLA mechanics, buyer map, market shape, staffing, and operator-facing alarm/HMI/automation standards (§7). **Researched:** 2026-11-07.

Every claim carries a URL. Anything marked **[Inference]** is my reasoning, not a sourced fact. §7 was merged in from a separate same-day scan and keeps that scan's H/M/L confidence labels.

---

## Key takeaways

1. **Procedures are where outages come from, and the procedures are still paper or Word.** Uptime's 2025 outage report says ~40% of organizations had a major human-error outage in the past three years. 85% of those involved staff not following procedures or flawed procedures/processes, and the "failure to follow procedures" share rose 10 points year over year ([Uptime 2025 press release](https://uptimeinstitute.com/about-ui/press-releases/uptime-announces-annual-outage-analysis-report-2025)). A DataBank facilities director wrote that "MOPs are typically paper-based, where steps are manually written and checked off on a list" ([DCF / DataBank](https://www.datacenterfrontier.com/voices-of-the-industry/article/11429039/how-mops-ensure-military-grade-precision-in-the-data-center)).
2. **Every MOP is supposed to start with a risk assessment, but no standard says how to compute exposure.** Uptime says a risk assessment should decide how deep the change review goes ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)). A practitioner guide grades MOP risk "by exposure and consequence," with owner/customer sign-off for work that leaves no redundancy ([Anvilfield](https://anvilfield.com/field-guides/datacenter/data-center-mop-sop-eop-procedures/)). Nobody publishes how to calculate "exposure" itself. **[Inference]** It is judged by hand from single-line diagrams and tribal knowledge. That judgment is exactly Cascade's wedge.
3. **Colo SLA credits usually pay out only if *both* A and B feeds fail, so a planned-maintenance window creates *exposure*, not a breach.** The Cyxtera SLA defines a Power Outage as loss of both primary and redundant circuits. Customers who bought single power, or who exceed 80% on a redundant pair, are excluded ([Cyxtera SLA, Aug 2023](https://www.carahsoft.com/buy/slg-contracts/txdir/5687-sla/docFileDownload/449140/63264714-ec08-4573-9263-226108b5de11)). Scheduled maintenance is commonly excluded outright ([OneColo SLA](https://onecolo.com/legal/OneColo-Service_Level_Agreement.pdf); [CyrusOne SLA, SEC exhibit](https://www.sec.gov/Archives/edgar/data/1410384/000104746914000833/a2218250zex-10_121.htm)). **[Inference]** So "SLA dollars at risk" should be framed as (probability of a second failure during the window) × (credits + churn for customers whose redundancy is removed), not as guaranteed credits.
4. **Staffing is getting worse, and turnover hits the people who run MOPs.** In Uptime's 2025 staffing survey, 64% of operators lost data center staff in the past 12 months. "Operations junior/mid-level staff" had the highest turnover (57%), followed by operations management (30%) ([Uptime staffing 3-pager, Oct 2025](https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/Staffing%20Survey%203%20pager%20final.pdf?version=3)). Colos have historically had worse turnover than enterprises, and still do in 2025 ([Uptime Intelligence](https://intelligence.uptimeinstitute.com/resource/staffing-crisis-persists-colos-struggle-retain-junior-operators)). More than half of 2026 respondents report trouble finding qualified candidates ([Uptime 2026 Global Survey release](https://www.01net.it/uptime-institute-16th-annual-2026-global-data-center-survey-deployment-of-high-density-racks-rising-fast-operators-face-continued-recruiting-and-retention-pressures/)).
5. **The best first buyer is the mid-market multi-tenant colo, not the hyperscaler.** Outsourced operators (CBRE, JLL, Salute+T5, BGIS) are channels, not first buyers. Non-hyperscale colo still holds ~20% of global capacity ([Synergy via secondary](https://www.srgresearch.com/articles/hyperscale-operators-to-account-for-67-of-all-data-center-capacity-by-2031)). The US has ~1,100+ colo facilities ([ResearchAndMarkets 2025](https://stocks.observer-reporter.com/observerreporter/article/bizwire-2025-12-3-us-colocation-data-center-portfolio-report-2025-detailed-analysis-of-1127-existing-and-413-upcoming-colocation-data-centers-150-upcoming-hyperscale-self-built-data-centers-researchandmarketscom)). Each colo has many tenants per hall, so a customer-exposure map matters there. The outsourced operators mostly serve hyperscale and wholesale clients ([Pulse 2.0 on Salute/T5](https://pulse2.com/salute-to-acquire-t5-operations-and-expand-to-more-than-15-gw-of-data-center-capacity-under-management/)).

---

## 1. Maintenance workflow today: MOPs, SOPs, EOPs, change control

### Document types
- MOPs, SOPs, EOPs, and site configuration procedures (SCPs) "form the core of the data center site policies" ([Uptime Journal, "The Making of a Good MOP," 2015](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)).
- A MOP is "the detailed, step-by-step procedure that is used when working on or around any piece of equipment that has the ability to directly or indirectly impact the critical load" ([Schneider Electric blog](https://blog.se.com/datacenter/architecture/2012/08/28/reports-and-procedures-crucial-elements-in-reducing-human-error-in-data-center-operations/)).

### Required MOP content (Uptime)
Uptime lists what a MOP must contain ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)):
- Header: title, description, author, approval authority/signature, date, unique ID, version control.
- Prerequisites: change approval, permit to work, notifications, SCP reconfiguration.
- Safety: LOTO and PPE.
- Tools and parts.
- Step-by-step instructions with an expected result per step.
- Initials per step.
- Back-out plan with Go/No-Go checkpoints.
- A risk assessment that "determine[s] whether any action or state change carries high risk." The result sets review depth, rehearsals, and staffing.

### Who writes and who approves
- **Authors.** First drafts often come from design consultants or commissioning agents. Uptime recommends handing ownership to Operations quickly, with technicians writing later revisions ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)). Critical facilities manager job postings list "MOP and SOP creation and administration" and scheduling "within specified change control / management protocol" ([CareerBuilder posting, Columbus OH](https://www.careerbuilder.com/job-details/data-center-facility-manager-columbus-oh--2b0585fc-9dac-4511-86d9-0cb87521160f)). Another posting includes "Method of Procedure (MOP), Standard Operating Procedure (SOP), and Emergency Recovery Procedure (ERP) development" ([FactoryFix posting](https://jobs.factoryfix.com/jobs/critical-facilities-manager-data-center--yorktown-heights--ny--1738283494--V2)).
- **Vendors.** UPS maintenance bypass "is typically performed by a field service engineer as part of a PM visit" ([Mission Critical Magazine](https://www.missioncriticalmagazine.com/articles/87289-schedule-your-emergencies)). **[Inference]** OEM field-service vendors (Vertiv, Schneider, Eaton) often bring their own MOP, and the site team reviews it.
- **Approval chain.** One practitioner guide lists, in order ([Anvilfield field guide](https://anvilfield.com/field-guides/datacenter/data-center-mop-sop-eop-procedures/)):
  - Technical review
  - Operations approval ("fits the plant's current state, staffing, and other changes in flight")
  - Change advisory board, which "weighs planned changes against each other and against facility conditions"
  - Owner/client sign-off for higher-risk work, "accepting exposure to their load"
  - AHJ where applicable
  - Post-work verification, including "confirmation that redundancy was restored"
- **Risk grades** (same guide): Low (backed-up unit), Medium (vendor PM with redundancy in place), High (switching on a path carrying live load), Highest (load exposed with no redundancy left, needing owner sign-off and a two-person rule). The principle is "Grade by exposure and consequence, not by effort."
- **Colo tenant-facing duty.** T5's Assistant Critical Facilities Manager role must "enforce strict adherence to customer SLAs and change control activities" ([T5 posting via Lever](https://jobs.lever.co/t5datacenters/d8e27345-54d8-4c44-a2cd-37a4d4edc578)). Another posting names the facility manager as "principal point of contact for hyperscale tenants or retail colocation clients during infrastructure maintenance windows" ([Workable posting](https://jobs.workable.com/jobs/03f26b95-8d91-4300-82c9-fc99ed552909.md)).
- **Customer notification.** Equinix sends advance notices of planned preventive maintenance. Smart View customers can view maintenance scripts for UPS annual maintenance, live load tests, and battery replacements (search-result summary of [Equinix docs](https://docs.equinix.com/Content/Colocation-Products/Services/colo-ibx-maintenance.htm); the page returned 403 when fetched directly). An Equinix community post says maintenance is "usually scheduled 3-4 weeks prior" (anecdotal, [Equinix community](https://community.equinix.com/t5/discussions/what-is-scheduled-maintenance/td-p/311)). The CyrusOne SLA requires at least 7 days' written notice of scheduled maintenance ([SEC exhibit](https://www.sec.gov/Archives/edgar/data/1410384/000104746914000833/a2218250zex-10_121.htm)).

### Tools in use
- **Paper/Word/PDF.** "MOPs are typically paper-based, where steps are manually written and checked off on a list" ([DataBank's Jay Brummett, DCF sponsored piece, 2020](https://www.datacenterfrontier.com/voices-of-the-industry/article/11429039/how-mops-ensure-military-grade-precision-in-the-data-center)). Vitralogy, a digital MOP vendor, also says "many data centers still rely on paper-based systems" ([Vitralogy blog](https://vitralogy.com/blog/one-of-the-most-overlooked-risks-in-data-centers-methods-of-procedure-on-paper/)). Uptime flags hard copies in equipment rooms as a version-control risk ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)).
- **Digital MOP execution apps.** MOPStar (used by DataBank), Vitralogy, and Anvilfield FieldOS ([DCF](https://www.datacenterfrontier.com/voices-of-the-industry/article/11429039/how-mops-ensure-military-grade-precision-in-the-data-center); [Vitralogy](https://vitralogy.com/blog/one-of-the-most-overlooked-risks-in-data-centers-methods-of-procedure-on-paper/); [Anvilfield](https://anvilfield.com/field-guides/datacenter/data-center-mop-sop-eop-procedures/)). These digitize *execution* (step sign-off, photos, audit trail). None of the material I found claims they compute impact or customer exposure.
- **CMMS.** It stores assets and manages work orders ([patent description](https://patents.justia.com/patent/20170315980)).
- **DCIM with power-chain simulation (the closest incumbent capability).**
  - Sunbird offers a "Cabinet Capacity Failover Report" and a chart showing "the impact that a floor PDU going down or performing maintenance on panel will have on your devices" ([Sunbird app note](https://sunbirddcim.com/sites/default/files/AN021_Sunbird_Application_Note_Power_Redundancy.pdf)).
  - Nlyte offers "power failure simulation" to find single points of failure ([Nlyte blog](https://www.nlyte.com/blog/6-steps-to-data-center-power-chain-management-and-risk-assessment/)).
  - Raritan offers rack failover analysis reports ([Cabling Install](https://cablinginstall.com/data-center/article/16477186/raritan-upgrades-dcim-for-full-data-center-monitoring-easier-moves)).
  - An Uptime-cited 2025 figure says nearly nine in ten organizations use some DCIM ([RIT Tech summary](https://www.rittech.com/exploring-dcims-role-in-data-center-evolution-with-insight-from-an-uptime-survey)). Treat this as an upper bound.
  - **[Inference]** Cascade must differentiate on cooling chains plus the customer/contract/SLA overlay plus the MOP-review workflow. Rack-level power failover alone is already claimed by DCIM vendors.
- **Third-party MOP review as a paid service.** Black & Veatch reviews and rewrites MOPs across 9 US sites for a confidential finance client. The phases are desktop review, site visit, validation, and updated MOPs ([B&V project page](https://www.bv.com/projects/data-center-method-of-procedures-review)). This shows there is budget for MOP quality today.

### Known MOP failure modes (practitioner sources)
- Uptime lists: overly long MOPs, complex layouts, outdated hard copies, steps open to interpretation, "procedures not reviewed after infrastructure or setpoint changes," missing parts, and procedures written without technician input ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)).
- Anvilfield lists: rubber-stamped sign-offs, working "from procedures that no longer match the as-built plant," and closing without "confirmation that redundancy was restored" ([Anvilfield](https://anvilfield.com/field-guides/datacenter/data-center-mop-sop-eop-procedures/)).
- A 7x24 Exchange Fall 2022 session (Steve Fairfax, MTechnology) called a poor MOP "a hazard and an avenue to accidents and incidents." It stressed "unexpected system responses," two-person challenge/response, and post-MOP debriefs ([7x24 archive](https://conferencearchive.7x24exchange.org/fall2022/?p=578)).

### Real incidents during planned maintenance (evidence that the exposure is real)
- **Flexential Chaska MN, June 2025.** Flexential de-energized its four UPS systems one at a time. A tenant (ChargeOver) lost a network switch, and failover to its redundant switch did not work, causing outages on two days. The tenant wrote that the May 29 maintenance notice was unclear about whether it would affect their environment ([ChargeOver postmortem](https://status.chargeover.com/incidents/3zfsdz4msf3s)). **[Inference]** This is the canonical Cascade use case: the operator knew which UPS was going down but could not tell which customer's gear depended on it.
- **University of Kent, June 2020.** During UPS replacement, the N+1 site ran with "no spare UPS capacity." Two new units lost communication, one shut down, the remaining unit could not carry the load, and the whole room lost power ([Kent IT blog](https://blogs.kent.ac.uk/unseenit/?p=522)).
- **Equinix SG, October 2023.** During a planned cooling upgrade, a contractor "incorrectly sent a signal to close the valves from the chilled water buffer tanks." The result was overheating and 2.5M failed bank payment/ATM transactions at DBS and Citi, plus MAS sanctions on DBS ([DCD](https://datacenterdynamics.com/en/news/equinix-blames-singapore-outage-on-third-party-contractor); [Business Today](https://www.businesstoday.com.my/2023/10/19/singapore-authority-to-take-supervisory-action-on-dbs-citi-after-recent-outage/)). This is a cooling-chain example.
- **GleSYS, August 2024.** Within 10 seconds of transferring load to a new UPS, the main circuit tripped and two zones lost critical load ([GleSYS incident report](https://static.glesys.com/Incident-Report-GleSYS-2024-08-12-Datacenter.pdf); I did not open it, details are from the search snippet). `01-outage-evidence.md` §2 has the fuller account from reading the PDF.
- More maintenance-window and hidden-dependency incidents (CME/CyrusOne, Korea NIRS, Alibaba, Delta) are in `01-outage-evidence.md` §3.

### Outage statistics (context)
- Power remains the leading cause of impactful outages ([Uptime 2025](https://uptimeinstitute.com/about-ui/press-releases/uptime-announces-annual-outage-analysis-report-2025)). Within power-caused outages, secondary reports of the 2024 data rank UPS failure first, at a reported 42% ([DCD on Uptime 2024](https://www.datacenterdynamics.com/en/news/uptime-institute-outages-in-2024-less-frequent-and-severe-but-more-expensive/); figure from a search snippet, verify against the report).
- One in ten outages is still serious or severe, and costs are rising ([Uptime 2026 release](https://www.01net.it/uptime-institute-16th-annual-2026-global-data-center-survey-deployment-of-high-density-racks-rising-fast-operators-face-continued-recruiting-and-retention-pressures/)).

---

## 2. Standards and requirements

### Uptime Tier III (concurrent maintainability)
- "A Tier III data center is concurrently maintainable with redundant components as a key differentiator"; "Tier IV facilities add fault tolerance to the Tier III topology" ([Uptime Tiers page](https://uptimeinstitute.com/tiers)). Operational sustainability, i.e. management behavior, is Uptime's "second essential component" of Tier classification (same page).
- Secondary sources say concurrent maintainability "applies to each and every component and path." Any component or path can be taken out for planned work without interrupting IT ([Data Centre Magazine](https://datacentremagazine.com/critical-environments/crash-course-data-centre-tiers); [EXIN study guide](https://open-exam-prep.com/study-guides/exin-cdcp/standards-mission-critical-site/uptime-institute-tier-classification)). Surviving an *unplanned* failure automatically is the Tier IV criterion (same study guide).
- **[Inference, strongly supported]** In a Tier III site, taking a component out for maintenance by design removes the margin against an unplanned failure on the remaining path. The Kent incident above is exactly this. Cascade's "what loses redundancy" view maps directly onto the Tier III design promise.

### ANSI/TIA-942
- Rated-3 means "Concurrently Maintainable Site Infrastructure": "each capacity component that is part of the distribution path can be removed, replaced or serviced on a planned basis without downtime" ([TechTarget primer](https://www.techtarget.com/searchdatacenter/tip/A-quick-primer-on-the-ANSI-TIA-942-standard); [EXIN TIA-942 guide](https://open-exam-prep.com/study-guides/exin-cdcp/standards-mission-critical-site/ansi-tia-942-rated-facilities)). The current revision is TIA-942-C (May 2024) (same sources; not verified against TIA text).

### NFPA 70B (2023): now a standard
- In 2023, NFPA 70B changed from "should/may" to "shall" and became an enforceable standard. It contains Table 9.2.2 (Equipment Condition Assessment), Conditions 1/2/3 (sections 9.3.1.1–9.3.1.3), and maintenance intervals set by "type, criticality, and condition" ([ERS/Vertiv 70B summary PDF](https://www.electricalreliabilityservices.com/globalassets/documents/ers-website-documents/ers-electrical-safety-nfpa-70b-2023-ds-en-na-es-02-675-web.pdf)).
- **The EMP (4.2.4.2) must include** an electrical safety program, named responsible personnel, a survey/analysis of equipment, a plan of inspections, servicing and tests, documentation of maintenance, equipment and personnel, corrective measures based on collected data, design-for-maintainability, and periodic program review (same PDF; [Vertiv/search summary](https://ers.vertiv.com/4a0380/globalassets/documents/ers-website-documents/ers-electrical-safety-nfpa-70b-2023-ds-en-na-es-02-675-web.pdf)).
- **Chapter 6: "single line diagrams shall be accurate and legible."** Short-circuit and coordination studies must be created and reviewed (ERS/Vertiv PDF). Studies are reviewed at least every 5 years and updated on system changes ([ReliaMag guide](https://reliamag.com/guides/nfpa-70b-compliance/)). **[Inference]** An accurate, living single-line/dependency model is a 70B compliance artifact, which gives Cascade's graph a compliance justification beyond MOP review.
- **Enforcement.** 70B is not automatically binding. It applies through AHJ code adoption, contracts, or insurer requirements. OSHA has not adopted it but may cite it under the General Duty Clause ([ReliaMag](https://reliamag.com/guides/nfpa-70b-compliance/)). The 2026 edition adds P-F-curve interval setting and an OT cybersecurity element, 4.2.4.2(11) (same source).
- **Liability.** Siemens argues that without a compliant EMP, electrical malfunctions "could be viewed as negligence" ([DCF / Siemens](https://www.datacenterfrontier.com/sponsored/article/55000490/siemens-industry-inc-a-new-era-for-electrical-safety-in-data-centers-understanding-and-implementing-nfpa-70b-the-standard-for-electrical-equipment-maintenance)). This is vendor content.

### Insurance and audit drivers
- Insurers may tie coverage or premiums to maintenance program quality (Eaton EMP material, [eaton.com/emp](https://eaton.com/emp)). Carriers "increasingly request documentation of completed infrared surveys during policy renewals" ([Aviva Canada](https://www.aviva.ca/en/business/news-and-insights/infrared-thermography-can-help-meet-nfpa-70b-standards/), per search summary). I found **no** published insurer premium schedule tied to 70B. Vendor claims of 5–15% discounts are unverified.
- Financial-services regulators push requirements down onto colos through contracts. MAS "does not have oversight of data centres, but expects banks to establish contractual agreements with providers that incorporate MAS' requirements on system availability" ([search summary of MAS coverage](https://www.finextra.com/newsarticle/43178/mas-orders-dbs-and-citibank-to-investigate-lengthy-outage)). **[Inference]** Bank tenants are likely to demand maintenance-risk evidence from colos.
- **Gap:** I did not verify SOC 2 or ISO 27001 control language on facility change management.

---

## 3. Colocation SLA structure

| Provider (doc) | Power target | Power credit | Temp/humidity | Caps and exclusions |
|---|---|---|---|---|
| **Equinix** (Verizon-reproduced Equinix SLA, 2019; summarized from search result, direct fetch 404'd) | Redundant: 99.999% (<5 min/12 mo per cabinet). Non-redundant: 99.99% (<52 min/12 mo) | 1/30 of MRC of affected circuits + cabinet per full hour beyond threshold | Temperature covered at 99.99%+ (per summary) | Redundant = "two power circuits from two different power busses" ([Verizon/Equinix SLA PDF](https://www.verizon.com/business/service_guide/reg-20190617/cp_colocation_equinix_data_centers_sla.pdf)) |
| **Cyxtera** (Aug 2023) | 100% | 5% of MRC per 60-min increment (cumulative/month) | 100% within 59–90°F ("allowable ASHRAE range") and 8–80% RH. 3% MRC per 60 min | Outage only if **both** primary and redundant circuits lose power. Excluded if customer bought single power, isn't on both A and B, or exceeds 80% on a redundant pair. Monthly cap 100% MRC. Credits are the "sole and exclusive remedy," plus termination for chronic failure. Claim within 60 days ([Cyxtera SLA](https://www.carahsoft.com/buy/slg-contracts/txdir/5687-sla/docFileDownload/449140/63264714-ec08-4573-9263-226108b5de11)) |
| **OneColo** (small colo) | 100% except scheduled maintenance | Tiered: 10–43 min = 1%, 43–432 min = 2%, 432–864 = 5%, 864–1,296 = 10%, 1,296–2,160 = 25%, >2,160 = 50% MRC | 64–78°F, 40–60% RH. 5% MRC per 60 min, cap 50% | Scheduled maintenance excluded. Total cap = 1 month MRC. RFO within 5 business days ([OneColo SLA PDF](https://onecolo.com/legal/OneColo-Service_Level_Agreement.pdf)) |
| **CyrusOne** (MSA with Q2 Software, SEC exhibit) | Availability tiers: <99.99% = 3%, <99.5% = 5%, <99.0% = 10%, <98.5% = 25% MRC | per tiers | none in doc | Cap 25% MRC. Excludes scheduled/emergency maintenance and customers not using redundant components. 7-day maintenance notice ([SEC exhibit](https://www.sec.gov/Archives/edgar/data/1410384/000104746914000833/a2218250zex-10_121.htm)) |
| **Digital Realty** | Marketing claims a "100% uptime SLA" ([DLR brochure](https://cdn.baxtel.com/data-centers/digital-realty-trust/files/Colocation_BR_A4_053119.pdf)) | 10-K: remedies include rent credits, and termination for repeated failures ([DLR 10-K FY2013](https://www.sec.gov/Archives/edgar/data/0001297996/000119312514078397/d681374d10k.htm)) | not found | Lease form not found |
| **Flexential** | Data sheets advertise "100% power SLA" ([Flexential data sheet](https://www.flexential.com/system/files/file/2021-10/collegeville-data-center-data-sheet.pdf)) | not found | not found | marketing only |
| **PhoenixNAP** | — | — | Environmental credit only where the failure "actually causes the Colocation Covered Service to become unavailable" (search summary of [PNAP SLA](https://phoenixnap.com/cs/legal/sla.html); direct fetch 404'd) | Downtime is reported by the customer within 3 days ([PNAP Colo Addendum](https://www.phoenixnap.com/cs/legal/colo.html)) |

**Patterns:**
1. Targets are "100%" (retail) or five nines (Equinix).
2. Credits are a percentage of the affected service's MRC per hour or by tier, capped at 25–100% of monthly MRC.
3. Credits are the sole remedy, plus termination for chronic failure.
4. Scheduled maintenance is often excluded.
5. Power credits require A+B dual-corded customers and pay only when both feeds fail.

QTS SLA terms were not found publicly.

**Other SLA terms elsewhere in this folder (not repeated here):**
- **Digital Realty environmental and power credits** were found in a separate DLR document read in full: cold-aisle 18–27 °C, breach after 15 continuous minutes, 2 days of space fee per occurrence, power credits of 2 days / 4 days / 1 week by duration, and a chronic-outage termination right. See `06-cooling-physics.md` P61. That fills the "not found" Digital Realty temperature cell above. `01-outage-evidence.md` §4 cites a Digital Realty SLA exhibit for credits being applied to the next invoice.
- **Equinix** temperature band (unavailable outside 18–27 °C per cabinet, 1/30 of loaded-cabinet MRC) is in `06-cooling-physics.md` P62, from the same Verizon PDF via search summary. It is consistent with the row above.
- **PhoenixNAP** older addendum credits (5%/10% MRC per 4-h temperature failure, later superseded) are in `06-cooling-physics.md` P63; consistent with the "only if unavailable" row above.
- **Euronodes, Bluebird and Savvis** credit tiers, and OneColo's **physical-security** clause (50% MRC for any unauthorized access to customer space), are in `07-fragmented-sources-and-entity-resolution.md` §2.2.

**[Inference] Implications for Cascade's "SLA dollars" pricing:**
- A planned outage of one UPS or one power bus normally triggers **zero** credits for compliant A+B customers. The dollar risk sits in three places:
  - (a) the conditional probability of a second failure while redundancy is removed;
  - (b) single-corded or non-compliant (>80% loaded) tenants, who are contractually excluded but whose outages still damage the relationship;
  - (c) cooling and temperature SLAs. Those often have no "both feeds" analogue, and one chiller or CRAH out can push a hall past the allowable range.
- A credible product shows "exposed MRC" and "customers on single path" rather than "credits you will pay." Churn and renewal risk probably exceed credits: credits are capped at 25–100% of one month's MRC per affected service.

---

## 4. Buyer map

### Roles (operator side)
| Role | What they own re: maintenance | Likely Cascade role |
|---|---|---|
| Critical Facilities Engineer / Technician | Executes MOPs, writes revisions ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/)) | User |
| Critical Facilities Manager / Site Ops Manager | MOP/SOP creation and administration, change control, vendor management, tenant contact during windows ([CareerBuilder](https://www.careerbuilder.com/job-details/data-center-facility-manager-columbus-oh--2b0585fc-9dac-4511-86d9-0cb87521160f); [FactoryFix](https://jobs.factoryfix.com/jobs/critical-facilities-manager-data-center--yorktown-heights--ny--1738283494--V2); [Workable](https://jobs.workable.com/jobs/03f26b95-8d91-4300-82c9-fc99ed552909.md)) | **Champion** (feels the pain of every MOP review) |
| Director of Critical Environments / Regional Ops Director | Multi-site standards, CAB chair **[Inference]** | Economic buyer at a mid-size colo |
| VP Data Center Operations / COO | SLA exposure, customer escalations, outage risk **[Inference]** | Economic buyer and signer |
| Customer success / account managers at colos | Maintenance notifications to tenants (cf. ChargeOver complaint about notice clarity, [postmortem](https://status.chargeover.com/incidents/3zfsdz4msf3s)) | Secondary beneficiary (clearer, customer-specific notices) |
| Dedicated "MOP Manager" roles | Exist on large builds, covering MOPs and "Modeled Change Management" ([Selectek posting, Dulles VA](https://jobs.selectek.com/jb/MOP-Manager-Jobs-in-Dulles-Virginia/13676795)) | Power user at larger sites |

### Outsourced facility operators
- **CBRE Data Centre Solutions** (CBRE's own publications are in `05-cbre-insights.md`). Manages "more than 800 data centres" and 6.5M m² (June 2026, per search summary of [Data Centre Magazine](https://publication.datacentremagazine.com/data-centre-magazine-june-2026-issue-47/0520680001781516622/p46)). A spokesperson figure of ~1,300 data centers globally appears in [inkl/Business Insider reprint](https://www.inkl.com/news/ai-data-centers-are-reshaping-the-worlds-largest-commercial-real-estate-company) (403 on fetch, search snippet only). CBRE's APAC site cites 700 ([CBRE Indonesia](https://indonesia.cbre.com/services/data-center-solutions)). CBRE's CEO says the data center move is "at least as profound as our move into outsourcing in the 1990s" (search summary; [Facilities Dive](https://www.facilitiesdive.com/news/cbre-revenue-jumps-19-on-pivot-to-data-center-services/818331/)).
- **JLL.** No firm-wide data center count found. It runs FM for Virtus's UK portfolio ([Baxtel](https://baxtel.com/news/virtus-hires-jll-for-facility-administration)) and posts "Manager Data Center Critical Environments" roles ([career.io](https://career.io/job/manager-data-center-critical-environments-chandler-jll-5968939f65c8a47a90258c1ec445ecbb)).
- **Salute Mission Critical + T5 Operations.** A definitive agreement to acquire T5 Operations was announced September 1, 2026, expected to give "over 15 GW of data center capacity under management." T5 Operations "serves hyperscale companies and wholesale data center developers" ([Pulse 2.0](https://pulse2.com/salute-to-acquire-t5-operations-and-expand-to-more-than-15-gw-of-data-center-capacity-under-management/)). King & Spalding reports the sale completed ([K&S](https://www.kslaw.com/about/news/t5-data-centers-completes-sale-of-operations-business-to-salute-mission-critical)). One secondary source says 1.5 GW, so treat 15 GW as unconfirmed.
- **BGIS.** Describes itself as "one of the largest Data Center Operations ('DCO') providers in North America." It acquired Cormant, a DCIM software company ([DCD](https://datacenterdynamics.com/en/product-news/bgis-acquires-global-dcim-software-company-cormant)). This shows FM firms will buy software to differentiate.
- **Cushman & Wakefield.** Listed among key players in DC FM market reports ([Meticulous Research](https://www.meticulousresearch.com/product/data-center-facility-management-and-om-services-market-6979)). No specifics found.
- **Compass Datacenters** is a developer/operator, not an FM outsourcer. It belongs on the operator list, not here. **[Inference from general knowledge; not researched]**
- **Market size.** DC FM and O&M services market is estimated at ~$8.55B (2025) ([Meticulous Research](https://www.meticulousresearch.com/product/data-center-facility-management-and-om-services-market-6979); a vendor estimate). **No reliable percentage of US DC operations outsourced was found.** A market report notes in-house preference at hyperscale caps outsourced share ([search summary of GII/Mordor](https://www.giiresearch.com/report/moi2163424-data-center-facility-management-market-share.html)).

**Buyer or channel? [Inference]**
- Outsourced operators are a **channel and later a buyer**, not a first customer.
- Pros:
  - They run many sites under standardized MOP programs and compete on reliability. BGIS buying Cormant shows they will acquire tooling.
  - One win can propagate across dozens of sites.
- Cons:
  - Their clients are mostly hyperscale and wholesale, where the owner dictates tools and the "customer exposure" layer is a single tenant.
  - Enterprise sales cycles at CBRE/JLL are long.
  - They need the client's permission to deploy software against the client's data.
- Approach them after 3–5 colo references, as a reseller or "MOP risk review as a service" partner.

---

## 5. Market shape

- **Global capacity split** (Synergy, Q4 2025 per secondary coverage): hyperscale 48%, on-prem enterprise 32%, non-hyperscale colo 20%. Hyperscale is forecast at 67% by 2031 ([SRG](https://www.srgresearch.com/articles/hyperscale-operators-to-account-for-67-of-all-data-center-capacity-by-2031); [CIO Dive](https://www.ciodive.com/news/hyperscale-ai-infrastructure-eclipses-enterprise-data-center-capacity-srg/751744/)). Colo capacity still grows "at near double-digit rates" (same).
- **US colo facility counts** (definitions vary):
  - 1,127 existing + 413 upcoming colo data centers ([ResearchAndMarkets, Dec 2025](https://stocks.observer-reporter.com/observerreporter/article/bizwire-2025-12-3-us-colocation-data-center-portfolio-report-2025-detailed-analysis-of-1127-existing-and-413-upcoming-colocation-data-centers-150-upcoming-hyperscale-self-built-data-centers-researchandmarketscom)).
  - The 2026 edition is 1,135 existing / 491 upcoming / 312 major operators and investors ([ValueSpectrum](https://www.valuespectrum.com/corporate_news/1385210-united-states-colocation-data-center-portfolio-report-2026-detailed-analysis-of-1-135-existing-colocation-data-centers-491-upcoming-colocation-data-centers-and-312-major-operators-investors)).
  - IBISWorld counts 2,226 colocation *businesses* ([IBISWorld](https://www.ibisworld.com/united-states/number-of-businesses/data-center-colocation-services/6203)).
  - The Datacentermap directory lists ~3,835 facilities from 1,681 operators (2025 snapshot) up to ~5,033 from 1,923 operators (Oct 2026). These include cloud and enterprise listings ([Harvard tagteam snapshot](https://tagteam.harvard.edu/hub_feeds/3180/feed_items/14631002); [dcgeeks](https://dcgeeks.com/top-data-center-companies-usa/)).
  - Total US data centers: ~5,400 (Cloudscene-based, [Apollo Academy](https://www.apolloacademy.com/?p=175405)).
  - Hyperscale large data centers worldwide: 1,360 at end of Q4 2025 ([CIO Dive/Synergy](https://www.ciodive.com/news/hyperscale-ai-infrastructure-eclipses-enterprise-data-center-capacity-srg/751744/)).
- **Workload shift:** 46% of enterprise workloads now run in third-party environments ([Uptime 2026 survey via techstrong](https://techstrong.it/featured/survey-enterprise-it-shifts-off-premises-as-ai-reshapes-data-centers/)).

**Reachability by segment [Inference]:**
| Segment | Approx. size | Pain fit | Reachability |
|---|---|---|---|
| Hyperscale self-build | ~1,360 large sites worldwide, ~10 companies | High technical pain, but single tenant (no customer-SLA overlay). Builds in-house tools | **Low** |
| Wholesale colo (one or few tenants per hall) | Part of ~1,100 US colo sites | Medium. Tenant SLAs are large, but few tenants per hall | Medium. Ops often outsourced to Salute/T5/CBRE |
| **Retail / multi-tenant colo, regional & mid-size** (dozens of tenants per hall) | Majority of ~312 US colo operators/investors and ~2,200 colo businesses | **Highest.** Many customers per PDU/UPS chain, retail SLAs with credits, high junior turnover | **High.** Ops directors are reachable, decisions are made by a few people, 7x24 Exchange / AFCOM chapters |
| Enterprise on-prem (banks, healthcare, government) | 32% of capacity | Medium. Internal "customers" are apps, not contracts. Strong change management culture in finance | Medium. Long cycles, but B&V's finance client shows budget for MOP review |

---

## 6. Staffing and knowledge loss

- **2025 Uptime Staffing & Recruitment Survey** (864 respondents; 470 owner/operators; fielded Aug 20–Sep 30 2025) ([Uptime 3-pager](https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/Staffing%20Survey%203%20pager%20final.pdf?version=3)):
  - 64% say data center employees left in the past 12 months.
  - Highest turnover: operations junior/mid-level staff 57%, operations management 30%, electrical 29%, mechanical 21%.
  - 55% increased salary spending. The largest increases went to operations management (49%) and junior/mid ops (45%).
  - The top hiring source is universities (50%). **[Inference]** New hires lack site-specific tribal knowledge.
- "Junior-level facilities employees remain in the shortest supply and experience the highest turnover rates." Turnover is "more pronounced at colocation companies than at enterprises" and persists in 2025 ([Uptime Intelligence report 186](https://intelligence.uptimeinstitute.com/resource/staffing-crisis-persists-colos-struggle-retain-junior-operators)). Enterprises, by contrast, are "losing more long-term employees" (search summary of [UI field report](https://intelligence.uptimeinstitute.com/sites/default/files/2025-10/UI%20Field%20report%20186_UI%20Staffing%20Survey%202025%20-%20Staffing%20crisis%20persists.pdf)). Both patterns erode site knowledge.
- **2025 Global Survey:** nearly two-thirds of operators report difficulty retaining staff, finding qualified candidates, or both ([Digitalisation World](https://digitalisationworld.com/news/70478/uptime-institutes-15th-annual-global-data-center-survey-2025-challenges-and-innovations)).
- **2026 Global Survey:** "More than half of all respondents in 2026 report difficulties finding qualified candidates." Staff are "often lured away by other data center companies" ([01net release](https://www.01net.it/uptime-institute-16th-annual-2026-global-data-center-survey-deployment-of-high-density-racks-rising-fast-operators-face-continued-recruiting-and-retention-pressures/)).
- **[Inference]** Combine high junior/mid turnover, university hires, and procedures that drift from the as-built plant ([Uptime Journal](https://journal.uptimeinstitute.com/the-making-of-a-good-method-of-procedure/); [Anvilfield](https://anvilfield.com/field-guides/datacenter/data-center-mop-sop-eop-procedures/)). The knowledge of "what actually depends on UPS-2B" increasingly lives in a few senior heads. Colos poach from each other, so those heads leave.
- Maintenance labor rates, response-time tiers and electrical-work rules are in `09-maintenance-workforce-and-work-orders.md`.

---

## 7. Operator-facing standards: alarm management, HMI, human-in-the-loop

Merged from a separate scan on 2026-11-07 that was written for a different (non-data-center) operator console. The standards themselves are generic. **Confidence:** **H** = primary document; **M** = trade press, reputable secondary source; **L** = vendor marketing, a search summary that could not be opened, or inference. The normative texts of ISA-18.2, IEC 62682 and ISA-101 are paywalled, so the KPIs and HMI rules below come from vendor and secondary summaries.

### 7.1 ISA-18.2 / IEC 62682 (alarm management)

- **Definition.** An alarm is an indication of "a malfunction, process deviation, or abnormal condition requiring a timely response". There must be a defined operator response, and a condition that needs no response should not be an alarm ([exida primer](https://exida.com/Alarm-Management/Alarm-Management-Primer), [ABB SCADA alarm white paper](https://library.e.abb.com/public/72f20c70c7b44d889d463db81df5c38d/SCADA%20Alarm%20Management%20White%20Paper.pdf); M. The standard text is paywalled: [IEC 62682 preview](https://vde-verlag.de/iec-normen/preview-pdf/info_iec62682{ed1.0}b.pdf)).
- **Rationalization records** cause, consequence, corrective action, priority, and the allowable response time. IEC 62682 §5.4 covers the alarm response timeline ([Yokogawa](https://blog.yokogawa.com/blog/implementing-alarm-management-per-iec-62682-standard), [exida on alarm response procedures](https://exida.com/Blog/alarm-response-procedures-more-than-just-a-good-idea); M).
- **KPIs.** About 1 alarm per 10 minutes per operator in steady state. A flood is more than 10 alarms in 10 minutes. Priority mix is about 5% high, 15% medium, 80% low (ABB white paper, which quotes EEMUA 191 / ISA-18.2; M).
- **Real-world flood example.** At Alyeska's TAPS pipeline control room, an upgrade left operators "monitoring about 3.5 times more alarms" ([ADN 2014](https://www.adn.com/energy/article/judge-targets-alarming-problem-alyeska-pipeline-controls/2014/03/05), M).

### 7.2 ISA-101 / high-performance HMI

- ANSI/ISA-101.01-2015 covers HMI lifecycle and design. The normative text is paywalled. The design philosophy behind it, from Hollifield et al.'s *High Performance HMI Handbook*, as quoted by Stephen Few: "Equipment is depicted in a simple 2-D low-contrast manner, rather than brightly colored 3-D vessels with shadowing". "If the process is running correctly, the screen should display little to no color". Alarm colors are "used only to display alarms and nothing else" ([Perceptual Edge, Dec 2009](https://www.perceptualedge.com/blog/?p=650), M).
- Other practice notes: analog indicators that show the normal band and the alarm limits beat raw numbers; tanks should show high/low bad bands and a trend inside the vessel outline; displays are organized in a Level 1–4 hierarchy, from overview down to detail ([PAS/Hollifield HMI overview](https://www.scribd.com/doc/283021047/A-High-Performance-HMI), [Emerson white paper](https://www.emersonautomationexperts.com/2023/discrete-automation/up-your-productivity-and-safety-with-high-performance-hmi-design-white-paper/); L–M).
- **Stance on 3D.** The guidance is not "never 3D". It is that decorative 3D, color and animation reduce situational awareness because they compete with the abnormal-state signal. **[Inference, from the original scan]** A 3D view breaks the "little to no color when normal" rule unless it is kept as a secondary or briefing view.

### 7.3 Human-in-the-loop automation

- **Levels of automation** (Parasuraman, Sheridan & Wickens 2000). Level 4: the computer suggests and the human decides. Level 5: the computer executes only if the human approves. Level 6: the human gets a limited time to veto before execution. Higher automation of decision and action raises the risk of lost situation awareness and complacency ([summary](https://andrewclark.super.site/all-media/a-model-for-types-and-levels-of-human-interaction-with-automation), M; original paper: IEEE Trans. SMC-A 30(3), 2000). **[Inference]** A human approval gate before consequential actions, as in Cascade, is Level 5.
- **Approval fatigue / automation bias with agentic AI** is an open research question. A KIT thesis proposal plans to inject faulty agent actions and measure detection rate and over- and under-reliance ([KIT](https://www.irs.kit.edu/crass_5787.php), L). Vendors now advertise "manual, semi-autonomous or autonomous modes with operator override" (Honeywell Forge Cognition; see `02-competitors.md` §5b).

---

## Best first customer segment and why (my judgment)

**Target: regional and mid-size US retail/multi-tenant colocation operators, roughly 5–50 sites, with dozens of tenants per hall. Sell to the VP/Director of Data Center Operations, with the Critical Facilities Manager as champion.** Illustrative names, not researched as prospects: DataBank, Flexential, TierPoint, and similar regional players.

Why:
1. **Customer exposure is the hard part only here.** In hyperscale and most wholesale halls, the "who is exposed" answer is one tenant. In retail colo, a single UPS or PDU chain feeds many customers with mixed A/B compliance. The ChargeOver/Flexential incident shows the exact failure: the operator sent a maintenance notice, and neither side could tell whether that customer was exposed ([postmortem](https://status.chargeover.com/incidents/3zfsdz4msf3s)).
2. **The SLA structure creates the pricing story.** Retail colo SLAs are per-customer MRC credits with A+B conditions ([Cyxtera](https://www.carahsoft.com/buy/slg-contracts/txdir/5687-sla/docFileDownload/449140/63264714-ec08-4573-9263-226108b5de11); [OneColo](https://onecolo.com/legal/OneColo-Service_Level_Agreement.pdf)). Showing "these 14 customers are single-corded on bus B; $X MRC exposed" is directly actionable: notify them, offer temporary power, or reschedule.
3. **Staffing pain is worst at colos** ([Uptime 2025](https://intelligence.uptimeinstitute.com/resource/staffing-crisis-persists-colos-struggle-retain-junior-operators)), and MOPs are still largely paper ([DataBank/DCF](https://www.datacenterfrontier.com/voices-of-the-industry/article/11429039/how-mops-ensure-military-grade-precision-in-the-data-center)).
4. **Reachable and fast.** Decisions sit with a few ops leaders, not a hyperscale procurement org. **[Inference]**
5. **Compliance tailwind.** NFPA 70B requires accurate single-line diagrams and a documented EMP ([ERS/Vertiv](https://www.electricalreliabilityservices.com/globalassets/documents/ers-website-documents/ers-electrical-safety-nfpa-70b-2023-ds-en-na-es-02-675-web.pdf)). The dependency model doubles as compliance evidence.

**Second wave:** outsourced operators (BGIS, Salute, CBRE) as channel partners. Then financial-services enterprise data centers, where regulators push availability requirements and MOP-review budgets already exist ([B&V](https://www.bv.com/projects/data-center-method-of-procedures-review)).

**Watch-outs:**
- DCIM vendors (Sunbird, Nlyte, Raritan) already advertise power-chain failover simulation. The wedge must be cooling chains, the customer/contract overlay, and plugging into the MOP/CAB review step, not "we also simulate a PDU failure."
- "SLA dollars" must be framed as exposure, not certain credits (see section 3).

---

## Gaps

- **No Reddit or forum practitioner threads were retrieved.** Searches with `site:reddit.com` returned nothing. Customer interviews are needed to confirm how long MOP review takes, who signs, and what tools are used (Word vs. SharePoint vs. CMMS).
- **No quantified share of US data center operations outsourced to FM firms.** CBRE counts conflict (700 / 800+ / 1,300). Salute+T5 capacity conflicts (1.5 vs 15 GW).
- **Equinix, Digital Realty, and QTS current SLA text not obtained first-hand.** Equinix terms come from a 2019 Verizon reproduction (summarized via search; direct fetch 404'd). Digital Realty and QTS lease SLA mechanics were not found in this scan; a Digital Realty service-availability document was separately read in full for `06-cooling-physics.md` P61 (see §3).
- **The Uptime Tier Standard: Topology text and the Uptime M&O criteria were not read directly.** The Tier III exposure-during-maintenance point is inference, supported by incidents.
- **NFPA 70B clause details** come from vendor summaries (Vertiv/ERS, ReliaMag), not the NFPA text.
- **No verified insurer premium link to 70B or maintenance programs.**
- **No data on frequency of planned-maintenance-induced outages** as a share of all outages (Uptime may have this in paid reports).
- **No pricing benchmarks** for what colos pay for DCIM, MOP software, or third-party MOP review.
- **AFCOM material not found.** 7x24 Exchange content came only from a session abstract.
