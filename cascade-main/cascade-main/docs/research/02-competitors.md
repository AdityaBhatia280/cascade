# 02 — Competitive Landscape: Who Already Does This

**Scope:** DCIM, digital-twin, AI-ops, CMMS and industrial-agent vendors, and where Cascade's white space is. **Researched:** 2026-11-07.

Every claim below has a source URL. Most sources are vendor marketing or docs; independent validation of feature depth is scarce and is flagged where relevant. Pricing could not be verified for any vendor below (none publish list prices that I could confirm), so pricing is omitted rather than guessed.

**Cascade's three candidate differentiators**
- (a) Link physical infrastructure to customer contracts and price SLA exposure in dollars
- (b) Build the dependency model from messy sources (BMS point lists, SLDs, spreadsheets, contracts) with AI
- (c) Pre-maintenance impact analysis ("what loses redundancy if I take UPS-B down?")

---

## TL;DR

- **The core engine (power chain model, failure simulation, redundancy loss, maintenance impact) is a commodity DCIM feature.** Schneider, Sunbird, Nlyte, XpedITe and Cadence all market it, and some have shipped it since roughly 2015–2017. Differentiator (c) is **well served** on paper.
- **Customer-level impact ("which tenants are affected if this PDU fails or goes down for maintenance") is also old.** Vertiv's 2016 colocation white paper sells exactly this, and Schneider markets tenant-level impact analysis. Equinix holds a patent on showing customers their power path. The *customer-mapping* half of (a) is **partially served**.
- **Pricing that impact in SLA dollars, from actual contract terms, is the one capability I could not find in any product.** Insurers (Parametrix, Aon, Gallagher) are actively writing about data center SLA exposure as a top financial risk, but as advisory and underwriting content, not software tied to the one-line. This is the most plausible white space, but it is narrow and may be a feature, not a company.
- **(b) AI ingestion of messy sources is under-served for data centers specifically**, but adjacent players are moving: Mapped (AI tagging of BMS points into a Brick graph), OpenDrawing.ai and Drawer AI (SLD/drawing extraction). No DCIM vendor I found advertises AI-built power chain models; they all assume manual modeling or discovery of networked devices.
- **Biggest real risk:** the hard part of all of this is model accuracy and upkeep, and incumbents already own the model where one exists. Cascade's wedge has to be "faster to a trustworthy model plus the dollar layer," not "we simulate failures."

---

## 1. DCIM vendors

### Schneider Electric — EcoStruxure IT Advisor
- **Failure/impact simulation: yes.** Right-click an alarm or device, choose "Simulate Impact", and get a list of affected equipment by impact type (power loss, power redundancy loss). A simulated PDU/UPS failure "will give an indication of loss of redundancy, cooling (UPS) and power supply." Network impact only for equipment tagged with a Network Marker. https://community.se.com/t5/Impact-simulation/Simulating-impact/ta-p/447332 , https://community.se.com/t5/Impact-simulation/Configuring-simulated-impact-layout/ta-p/447319
- **Cooling impact: yes**, judged by calculated rack inlet temperature vs. room target. https://community.se.com/t5/Impact-simulation/Configuring-cooling-impact-preferences/ta-p/447317
- **Known modeling limit:** modeling parallel UPSs as one object can cause impact analysis to report loss of power instead of loss of redundancy (documented in Schneider's FAQ, per search summary). https://community.se.com/t5/Impact-simulation/tkb-p/impact-simulation/sort-string/tkbHelpfulness
- **Power path / dependency mapping: yes**; capacity module markets "consequence of device failure... for instant identification of critical business application impacts." https://www.se.com/ca/en/product-range/66103 , https://www.tecisoft.com/products/ecostruxure-it-advisor-capacity-module-perpetual-license-1000-racks-swplca1000r-digi
- **Tenant impact: partial (marketing).** Schneider's 2023 colocation blog describes tenant-level DCIM that links tenant assets to power draw for tenant-level impact analysis (page returned 403 to my fetch; claim from search summary). https://blog.se.com/datacenter/dcim/2023/06/29/5-ways-modern-dcim-makes-multi-tenant-colocation-data-centers-more-competitive/
- **SLA dollars: no evidence found.**
- Also partnered with ETAP on an electrical digital twin for operator training (2022). https://www.businesswire.com/news/home/20220601005545/en/Schneider-Electric-and-ETAP-Announce-New-Digital-Twin-Integration-Enabling-Operator-Training-and-Simulations-Reducing-Risk-to-Operations

### Sunbird — dcTrack / Power IQ
- **Maintenance impact: yes, explicitly.** Sunbird's May 2024 redundancy application note: "Power Chain Distribution and Redundancy Analytics Chart – See the impact that a floor PDU going down or performing maintenance on panel will have on your devices to know if they have redundant power." https://sunbirddcim.com/sites/default/files/AN021_Sunbird_Application_Note_Power_Redundancy.pdf
- **Failover simulation: yes.** "Cabinet Capacity Failover Report – Simulate a failover scenario to identify at-risk cabinets." Same source.
- **Redundancy validation on every change: yes.** "Automatic load validation at every breaker point in your power circuit on every add, move, or change." https://www.sunbirddcim.com/sites/default/files/AN008_Sunbird_ApplicationNote_Power_Circuit_Management.pdf
- **AI feature:** load-shift detection "AI copilot" flags when an IT device moves load between PSUs (redundancy loss signal). AN021 above; https://sunbirddcim.com/sites/default/files/AN022_Sunbird_Application_Note_Load_Shift_Detection.pdf
- **Single-line diagrams:** generated *from* the modeled data, with live readings overlaid (i.e., SLD is an output, not an ingested input). https://www.sunbirddcim.com/sites/default/files/AN015_Sunbird_Application_Note_Single_Line_Diagram.pdf
- **Colo/tenant:** colo application note covers tenant consumption tracking; I found no dcTrack customer-facing outage impact report. https://www.sunbirddcim.com/sites/default/files/AN004_Sunbird_ApplicationNote_Colo_Service_Providers.pdf
- **SLA dollars: no.** (Sunbird's own note cites SLA penalties as a reason downtime is expensive, but does not compute them.)
- **Depth caveat:** Sunbird's simulation appears rack/PDU/panel-centric; I found no documentation of upstream UPS/generator/utility what-ifs.

### Nlyte (owned by Carrier since Oct 2021)
- Ownership: https://www.carrier.com/carrier/en/worldwide/news/news-article/carrier-completes-acquisition-of-nlyte-software-a-leader-in-data-center-infrastructure-management-software.html
- **Failure simulation: yes.** PowerView (from FieldView Solutions, ~2017) is a "Power Chain Analysis Tool" for "What If?" simulations. https://www.nlyte.com/web/wp-content/uploads/2019/09/PowerView™_Data_Sheet.pdf ; Nlyte Energy Optimizer lists "simulate power chain failures, validate redundancy." https://www.nlyte.com/blog/nlyte-energy-optimizer-power-failure-simulation-and-prevention/ ; Device Failure Analysis Report. https://www.nlyte.com/blog/nlyte-energy-optimizer-device-failure-analysis-report
- **Maintenance planning, tenant impact, cooling simulation:** not described in the power-failure page I fetched.
- **IT linkage:** markets tracing from VM → host → rack → PDU → power feed, and ServiceNow integration to connect logical incidents to physical impact. https://www.nlyte.com/blog/a-vmware-outage-postmortem-tracing-impact-from-vm-to-rack-to-power-feed/ , https://www.nlyte.com/blog/servicenow-dcim-integration-closing-the-loop-between-logical-incidents-and-physical-impact/
- **SLA dollars: no evidence.**

### Vertiv — Trellis (discontinued) / Environet
- Trellis discontinued; support for existing contracts ended 2023. Uptime says Vertiv is investing in Environet (from Geist), which lacks Trellis's sophistication. https://journal.uptimeinstitute.com/vertivs-dcim-ambitions-wither-on-trellis-demise/ , https://www.vertiv.com/en-us/products-catalog/monitoring-control-and-management/software/trellis-enterprise-solutions
- **Prior art for customer impact (important):** Vertiv's 2016 colocation DCIM white paper lists "Impact report analysis by the customer names associated with a power chain device failure or planned downtime for maintenance," and Use Case 1: "determining who is affected is as simple as printing a report of the customer equipment that is attached to a specific device. This enables colocation providers to provide advance notice regarding planned outages." https://www.vertiv.com/globalassets/products/monitoring-control-and-management/software/applying-data-center-infrastructure-management-in-colocation-data-centers.pdf
- Takeaway: "which customers are hit by this maintenance" was a marketed DCIM use case a decade ago. The Trellis exit also left a gap in Vertiv's DCIM offering (indirect evidence for a market opening, not proof of demand).

### Hyperview
- Cloud DCIM; auto-discovers network-connected assets into a digital twin. https://www.producthunt.com/products/hyperview
- TrustRadius screenshot captioned "power path mapping"; release notes mention transfer-switch handling. https://www.trustradius.com/products/hyperview
- **Failure/maintenance simulation: unknown** — no Hyperview documentation found.

### Device42 (acquired by Freshworks, 2024, ~$230–238M)
- Acquisition: https://www.sec.gov/Archives/edgar/data/1544522/000154452224000047/frsh-20240630.htm , https://datacenternews.asia/story/freshworks-acquires-device42-enhancing-it-asset-management
- IT-side dependency mapping ("impact topologies from an application, device, rack, room or the building level"). https://www.device42.com/?p=611 . PDUs/UPS/ATS can be recorded as power units. https://docs.device42.com/infrastructure-management/power-units/adding-pdus/
- **Facility power chain simulation: no evidence.** Strength is app-to-rack, not utility-to-PDU.

### Modius OpenData
- Markets power and cooling chain visibility "from the grid to the chassis" and power chain dependencies; collects SNMP/BACnet/Modbus. https://www.datacenterknowledge.com/data-center-infrastructure-management/vendor-profile-modius , https://www.g2.com/products/modius-opendata/discuss
- 2026 partnership with Mitsubishi Heavy Industries. https://www.barchart.com/story/news/33726605/mitsubishi-heavy-industries-concludes-agreement-with-modius-to-provide-dcim-solutions-for-data-centers-worldwide
- **Failure/maintenance simulation: unknown.**

### XpedITe (Rittech) — smaller DCIM
- **Impact analysis: yes, including planned maintenance.** Simulates failures of "PDUs, UPS systems, RPPs, switches"; checks N+1/2N; assesses "how maintenance, moves, or installations will impact live services"; "highlights affected services before physical changes occur" and notifies affected users. https://rittech.com/impact-analysis , https://www.rittech.com/power-management
- Per-customer breakdown: not stated.

### Raritan (Legrand) — DCIM guidance
- Lists failover simulation and power path impact analysis as core DCIM capabilities. https://www.raritan.com/assets/ram/resources/ebooks/40-critical-problems-your-dcim-should-solve.pdf

### Operators building in-house
- **Equinix** holds US Patent 10,812,339 "Determining power path for data center customers" (granted 2020), covering showing a customer the real-time power path of its equipment. https://patents.justia.com/patent/20170200240 , https://companyprofiles.justia.com/company/equinix/patents/patent?page=5 (assignee inferred from Justia's Equinix listing; confirm before relying on it). Large colos may build rather than buy.

---

## 2. Digital twin / simulation

### Cadence Reality DC (formerly Future Facilities 6SigmaDCX)
- **Power failure analysis: yes, strong.** Automatically checks power for overload in normal state and "for any single-point failure"; models single and cascading failures; reports loads on surviving devices and unpowered IT/racks; one-line view from utility to IT device. https://www.cadence.com/en_US/home/resources/datasheets/datacenter-design-software-ds.html
- **Combined power + cooling failure, transient: yes** — fans, pumps, chillers or any part of the power network switched off; transient simulations over time. Same source; https://www.cadence.com/en_US/home/resources/technical-briefs/cadence-datacenter-insight-platform-tb.html
- Can sync to live power monitoring. Same sources.
- **Customer/SLA: no evidence.** Engineering-grade (CFD); requires expert modeling effort.

### ETAP (Schneider-owned electrical analysis)
- Data center brochure lists Contingency Analysis and Switching Management modules; operator training simulator (eOTS) on real-time data. https://etap.com/docs/default-source/Brochures/smart-data-centers.pdf , https://etap.com/singleevent/2022/12/01/webinar/ETAP-Operator-Training-Simulator-120122
- Switching management "execute approved switching programs... maintaining compliance with safety and security procedures" — this is the closest thing to MOP-level electrical validation in the market. (Brochure, above.)
- Case study: AG Engineering used ETAP digital twin across design, operations and operator training for a Middle East data center. https://etap.com/case-study/how-etap-digital-modeling-helps-to-develop-and-manage-critical-power-solutions-for-data-centers
- **Customer/SLA: no.** Electrical-engineering tool; not tied to tenants.

### NVIDIA Omniverse DSX Blueprint
- Reference digital twin for AI factories with electrical loading simulation and CFD thermal assets; ETAP supplies load flow/fault data; Schneider, Eaton, Cadence, Phaidra among 20+ partners. https://docs.omniverse.nvidia.com/dsx/latest/overview.html , https://theregister.com/2025/10/29/nvidia_omniverse_dsx
- Docs say it is "not a turn-key application ready for production deployment without customization"; Uptime calls it a convergence signal, not a prescriptive blueprint. https://docs.omniverse.nvidia.com/dsx/latest/index.html , https://intelligence.uptimeinstitute.com/pdf-download/node/153966
- Jacobs launched a DSX-based twin for virtual commissioning. https://rallies.ai/news/jacobs-launches-nvidia-omniverse-dsx-based-digital-twin-for-gigawatt-ai-data-centers
- Relevance: a platform others build on, focused on new gigawatt builds, not brownfield ops.

### EkkoSense (EkkoSIM)
- Cooling/thermal digital twin with "unlimited simulation scenarios" including failover scenarios and cooling reconfiguration; N+R / 2N+R resilience testing mentioned. https://www.intelligentdatacentres.com/?p=32194 , https://atlas.verdantix.com/vendors/ekkosense
- Funding: 2021 seven-figure debt from Midlands Engine Investment Fund; no 2024–25 round found. https://businesscloud.co.uk/news/software-firm-plots-global-expansion-with-meif-funding/
- **Power chain / customer / SLA: no evidence.** Cooling-only.

### Red Dot Analytics (Singapore)
- Data center digital twin simulating heat and power flow, AI flags divergence between model and sensors; seed / pre-Series A (amount unconfirmed). https://www.cbinsights.com/company/red-dot-analytics/customers

---

## 3. AI ops / cooling startups and procedure/change tools

### Phaidra
- Autonomous AI control for cooling (and increasingly power/workload); founders from Google's DeepMind cooling project. Series B $50M+ led by Collaborative Fund, Oct 2025 (NVIDIA, Index, Helena, Sony participating); earlier $12M from Index (2024). Total disclosed funding reported as ~$92–93M (sources disagree). https://www.geekwire.com/2025/phaidra-raises-50m-to-help-ai-data-centers-run-smarter-not-just-harder-by-boosting-energy-efficiency/ , https://pulse2.com/phaidra-over-50-million-series-b-raised-for-building-ai-agents-for-ai-factories , https://www.datacenterdynamics.com/en/news/ai-startup-phaidra-raises-12-million-for-data-center-cooling-control-system
- **Overlap with Cascade: low.** Optimization/control, not dependency mapping or SLA impact. Potential partner or future entrant (they already ingest plant data).

### Other funded data center AI startups (2024–2026), adjacent not direct
- Emerald AI — grid flexibility for data centers; $24.5M seed (Jul 2025) and later $150M Series A, ~$1B valuation. https://technical.ly/entrepreneurship/dmv-startups-powering-the-ai-infrastructure-boom/
- Niv-AI — $12M seed for power-draw sensing/stranded power. https://www.calcalistech.com/ctechnews/article/bk4zmc8cbe
- Zendo Energy — $2.2M pre-seed, data center "energy OS". https://www.hostingadvice.com/blog/startup-raises-2-2m-to-tackle-ais-data-center-power-crisis/
- Infrastructure Twin Systems — seed Aug 2025 (undisclosed) for physics/AI data center twins (tracker source only, unverified). https://newmarketpitch.com/blogs/news/digital-twin-list-deals
- None of these do contract-linked impact analysis.

### MOP / SOP / EOP procedure tools
- **MOPstar** — digitizes MOPs and daily maintenance checklists for mission-critical facilities; founded 2018 (Frisco, TX per Mergr); reportedly acquired by Chekhub in Aug 2020 (single source). DataBank deployed it across its portfolio. https://mergr.com/company/mopstar , https://aithority.com/data-center-and-co-location/databank-selects-mopstar-as-a-strategic-partner-to-ensure-uptime-efficiency-and-scale/ , https://www.thecompanycheck.com/company/b/mopstar/rnod0epazqf4b0jn8 , https://datacenterfrontier.com/mops-ensure-military-grade-precision-in-the-data-center/
  - Workflow/checklist tool. **No evidence it computes electrical impact or redundancy from a model.**
- **ETAP Switching Management** (above) is the model-driven counterpart, but electrical-engineer-oriented.
- I found **no 2022–2026 funded startup** specifically doing AI-generated or model-validated MOPs for data centers. Searches returned nothing; that does not prove none exist (stealth/early companies may not be indexed).

### AI ingestion of messy sources (relevant to differentiator b)
- **Mapped** — AI tags and maps raw BMS points into Brick/Haystack/REC ontologies, exposes a knowledge graph via GraphQL; ML on point names, time-series clustering, causality. Funding: $9.5M seed (2021) plus strategic investors incl. Honeywell and NTT; totals reported inconsistently ($26M–$35M). https://blog.mapped.com/originally-posted-at-https-www-nexuslabs-online-content-partner-pulse-whats-new-with-mapped-3aeecdb5418b , https://www.extruct.ai/hub/mapped-com-funding , https://startup-seeker.com/company/mapped~com
  - Commercial buildings focus; not data-center power chain specific. Closest prior art for "AI from BMS point lists".
- **OpenDrawing.ai** — markets AI digitization of data center electrical drawings (switchgear one-lines, UPS single-lines, cable schedules) into asset records for Maximo/SAP PM. https://opendrawing.ai/blog/uc-data-centers-energy/
- **Drawer AI** — extracts equipment lists from single-line PDFs for estimating; SLD detection slated for Q2 2026. https://drawer.ai/blog/how-to-read-a-single-line-diagram-for-electrical-estimating
- Microsoft published a GPT + Document Intelligence recipe for extracting BOMs from electrical drawings, calling it a hard parsing problem — signals the technique is becoming commodity tooling. https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/extracting-boms-from-electrical-drawings-with-ai-azure-openai-gpt-5-4--azure-doc/4506891
- **Willow** (WillowTwin, built on Azure Digital Twins, partnered with Johnson Controls) — building digital twins assembling static, spatial and live data; no data-center-specific case found. https://partner.microsoft.com/fr-ma/blog/article/partner-innovation-series-smarter-buildings-with-azure-digital-twins , https://www.johnsoncontrols.com/media-center/news/press-releases/2023/02/08/johnson-controls-and-willow-to-collaborate-on-digital-solutions

---

## 4. CMMS / EAM in data centers

### MCIM (formerly Fulcrum Collaborations)
- Mission Critical Information Management platform; rebranded to MCIM in Jan 2026 (single-source profile); described as unifying CMMS, EAM and BI on Salesforce; claims 1M+ data center assets tracked and "3 of the top 4" colo/hyperscale operators (vendor claim, unverified). https://yespress.io/mcim , https://www.controleng.com/products/mission-critical-information-management-mcim/ , https://www.gartner.com/reviews/product/mcim
- Partnership with Salute on operational intelligence. https://salute.com/?p=3021132
- **Impact analysis / redundancy modeling: no evidence found.** Strong incumbent for the asset register and maintenance workflow — and therefore an integration source (or a natural acquirer) for Cascade.

### IBM Maximo
- Asset criticality from risk scoring; hierarchy and FMECA practices; no native power-chain impact simulation found in IBM sources. https://community.ibm.com/community/user/blogs/david-iiguez/2025/04/04/risk-assessment-for-assets-in-manage-ibm-maximo-ap , https://maven-asset-management-insights.github.io/content/glossary/

### ServiceNow
- CMDB-based impact analysis for change/incident on IT services. https://www.servicenow.com/docs/r/q4dSP2Icgr1SFv5wanVXvQ/~p6mlH3iSpQH9FQYNZo24w
- Physical power chain usually comes from DCIM integrations (e.g., Nlyte). https://www.nlyte.com/blog/servicenow-dcim-integration-closing-the-loop-between-logical-incidents-and-physical-impact/
- **Partial:** strong at "which business services depend on this server," weak at "which servers depend on this UPS" without DCIM.

### Nuvolo (ServiceNow-based), Fiix, Facilio, UpKeep
- Nuvolo: data center asset/work-order management, vendor SLA tracking (vendor performance SLAs, not customer SLAs); used by STACK EMEA. https://www.nuvolo.com/story/high-tech-government-agency/ , https://www.nuvolo.com/story/stack-streamlines-data-center-maintenance-processes/
- Facilio: condition-triggered work orders; positions alongside DCIM, not replacing it. https://facilio.com/industry/data-centers/
- Fiix: data center maintenance software, 365 Data Centers case study. https://fiixsoftware.com/resources/case-studies/365-main/
- UpKeep: markets escalating overdue PMs on N+1 systems so "loss of redundancy is a decision rather than a discovery" — redundancy awareness is entering CMMS messaging, though not as model-driven simulation. https://upkeep.com/solutions/data-centers/
- **None model electrical/cooling dependencies or simulate impact.**

---

## 5. Comparison table

Legend: **Y** = yes, documented; **P** = partial / marketing-only / narrow; **N** = no evidence after searching; **?** = unknown (couldn't verify either way).

| Vendor | Power chain dependency model | Failure / redundancy-loss simulation | Cooling failure sim | Planned-maintenance impact | Customer / tenant mapping | SLA $ pricing | AI build from messy sources | Key source |
|---|---|---|---|---|---|---|---|---|
| Schneider EcoStruxure IT Advisor | Y | Y | Y | P (same sim; not maintenance-specific) | P | N | N | community.se.com/t5/Impact-simulation/Simulating-impact/ta-p/447332 |
| Sunbird dcTrack/Power IQ | Y | Y (rack/PDU/panel) | ? | Y ("performing maintenance on panel") | P (colo consumption) | N | P (AI only for load-shift detection) | sunbirddcim.com/.../AN021_..._Power_Redundancy.pdf |
| Nlyte (Carrier) | Y | Y | ? | ? | ? | N | N | nlyte.com/blog/nlyte-energy-optimizer-power-failure-simulation-and-prevention/ |
| Vertiv Trellis (discontinued) | Y (historic) | ? | ? | Y (2016 paper) | Y (2016 paper: impact by customer name) | N | N | vertiv.com/.../applying-data-center-infrastructure-management-in-colocation-data-centers.pdf |
| Hyperview | P (power path screenshot) | ? | ? | ? | ? | N | P (network auto-discovery) | trustradius.com/products/hyperview |
| Device42 (Freshworks) | P (to PDU) | N | N | P (change planning) | N | N | P (IT discovery) | device42.com/?p=611 |
| Modius OpenData | P | ? | ? | ? | ? | N | N | datacenterknowledge.com/.../vendor-profile-modius |
| XpedITe (Rittech) | Y | Y (N+1/2N) | ? | Y | P (affected services/users) | N | N | rittech.com/impact-analysis |
| Cadence Reality DC | Y | Y (single + cascade, transient) | Y | P (what-if switch-off) | N | N | N | cadence.com/.../datacenter-design-software-ds.html |
| ETAP | Y (electrical) | Y (contingency) | N | Y (switching management) | N | N | N | etap.com/.../smart-data-centers.pdf |
| NVIDIA Omniverse DSX | P (blueprint) | P | P | N | N | N | N | docs.omniverse.nvidia.com/dsx/latest/overview.html |
| EkkoSense | N | P (cooling failover) | Y | P | N | N | N | atlas.verdantix.com/vendors/ekkosense |
| Phaidra | N | N | P (control, not what-if) | N | N | N | P (learns from plant data) | geekwire.com/2025/phaidra-raises-50m-... |
| MOPstar | N | N | N | P (MOP workflow, no model) | N | N | N | aithority.com/.../databank-selects-mopstar-... |
| MCIM | N | N | N | P (maintenance workflow) | ? | N | ? | controleng.com/products/mission-critical-information-management-mcim/ |
| IBM Maximo | P (asset hierarchy) | N | N | N | N | N | N | community.ibm.com/.../risk-assessment-for-assets-in-manage-ibm-maximo-ap |
| ServiceNow (+DCIM) | P (via DCIM) | P (IT services) | N | P (change impact) | P (business services) | N | P (IT discovery) | servicenow.com/docs/... |
| Nuvolo / Fiix / Facilio | N | N | N | N | N | N (vendor SLAs only) | N | nuvolo.com/story/high-tech-government-agency/ |
| Mapped | N (building graph) | N | N | N | N | N | Y (BMS points) | blog.mapped.com/... |
| OpenDrawing.ai / Drawer AI | N | N | N | N | N | N | P (SLD → asset list) | opendrawing.ai/blog/uc-data-centers-energy/ |
| Equinix (in-house) | Y (patent) | ? | ? | ? | Y (customer power path) | ? | ? | patents.justia.com/patent/20170200240 |

Full URLs for the key sources appear in the sections above.

---

## 5b. Adjacent industrial AI agent and field-service platforms

These rows come from a separate landscape scan done the same day (2026-11-07) for an earlier, non-data-center version of the project. They describe general industrial agent and maintenance platforms, not data-center products, and their overlap with Cascade was **not** assessed for data centers. Confidence labels are that scan's: **H** = primary document; **M** = trade press, reputable secondary source; **L** = vendor marketing, a search summary that could not be opened, or inference. Absence of a capability in public marketing is not proof of absence.

| Product | What it does | Source (conf.) |
|---|---|---|
| **Microsoft Dynamics 365 Field Service + Copilot** | IoT alert → work order → AI scheduling. A "Scheduling Operations Agent" is described in 2025–26 partner material | [MS Learn release plan 2025 W1](https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave1/service/dynamics365-field-service) (M); [partner blog](https://dynamics.folio3.com/blog/copilot-in-dynamics-365-field-service/) (L) |
| **Cognite Atlas AI** (with NVIDIA, 2026) | Low-code industrial agents on the CDF knowledge graph. Aker BP RCA agents cut analysis time by more than 70% (vendor figure). 2026: agents "bridge the gap between model outputs and work orders" | [World Oil Sep 2025](https://www.worldoil.com/news/2025/9/16/aker-bp-expands-ai-first-strategy-with-cognite-atlas-ai-to-transform-e-p-efficiency/) (M); [BusinessWire Mar 2026](https://www.businesswire.com/news/home/20260323390546/en/) (L, not opened) |
| **Palantir AIP** (APA, bp) | At APA: "supply chain management, operational planning, production optimisation, maintenance planning". bp: digital twin over more than 2 M sensors, AIP "suggest[s] courses of action". Could build custom planning apps on one ontology | [Offshore Technology on APA](https://www.offshore-technology.com/news/apa-partners-with-palantir/) (M); [Oilfield Technology on bp, 2024](https://www.oilfieldtechnology.com/digital-oilfield/11092024/bp-extends-partnership-with-palantir-to-integrate-ai-capabilities) (M) |
| **Honeywell Forge Production Intelligence assistant** (Feb 2025); **Forge Cognition / Plant Cognition** (Oct 2026, NVIDIA + Dell) | GenAI assistant with "case management integration". Cognition is an agentic + simulation platform with "manual, semi-autonomous or autonomous modes with operator override". Refinery/LNG/buildings focus | [Honeywell PR Feb 2025](https://www.honeywell.com/us/en/news/press-releases/2025/02/honeywell-unveils-innovative-ai-assistant) (M); [Hydrocarbon Processing Oct 2026](https://hydrocarbonprocessing.com/news/2026/10/honeywell-technologies-launches-forge-plant-cognition-with-dangote-built-with-nvidia-ai-and-dell-technologies-capabilities/) (M) |
| **AVEVA Industrial AI Assistant** (CONNECT, 2024 →) | Natural-language queries over process data. Hannover 2025 demo: from "investigating abnormal performance… to preparing the required maintenance actions". Agentic twin builder planned for Q1 2027 | [AVEVA World 2024 PR](https://www.aveva.com/en/about/news/press-releases/2024/aveva-unveils-its-connected-roadmap-for-the-future-of-industrial-intelligence-at-aveva-world-paris/) (M); [AVEVA blog](https://aveva.com/en/perspectives/blog/leveraging-the-power-of-generative-ai-in-aveva-operations-control) (L) |
| **Emerson AspenTech AVA** (May 2026) | Four agentic "advisors" for performance, strategy and reliability. A partner says it connects to Aspen Mtell for natural-language RCA and remediation | [World Oil May 2026](https://worldoil.com/news/2026/5/11/emerson-launches-aspentech-industrial-ai-platform-for-enterprise-operations/) (M); [4Sight](https://4sight.cloud/clusters/operational-technologies/offerings/aspentech-ava/) (L) |
| **Seeq** (AI Assistant 2024; Seeq Intelligence / Agent Q, Mar 2026) | Time-series analytics agents. "Agent Extensibility" connects to external systems "such as work orders" | [Hydrocarbon Processing Mar 2026](https://www.hydrocarbonprocessing.com/news/2026/03/seeq-intelligence-bridging-industrial-ai-and-human-expertise-for-smarter-operational-decisions/) (M) |
| **Siemens Industrial Copilot / Senseye** (2025) | Maintenance copilot, "25% of reactive maintenance time" saved in pilots. Orchestrator over specialized agents (May 2025). Manufacturing focus | [Siemens PR Mar 2025](https://assets.new.siemens.com/siemens/assets/api/uuid:54c9d134-1eb8-49a8-a451-d5d3595ab25c/HQDIPR202503217126EN.pdf) (M); [ARC](https://www.arcweb.com/blog/siemens-introduces-ai-agents-industrial-automation) (M) |
| **IBM Maximo + AssetOpsBench** | Open benchmark with IoT, FMSR, TSFM and work-order agents; Maximo is adding a "Condition Insights agent". Benchmark details are in `12-prior-work-and-evaluation.md` | [arXiv](https://arxiv.org/abs/2506.03828) (H); [IBM Research blog](https://researchweb.draco.res.ibm.com/blog/asset-ops-benchmark) (M) |
| **ServiceChannel AI** | Work-order anomaly flags, triage agents, "dispatch-ready work orders"; trained on more than 300 M work orders | [ServiceChannel Spring 2026 release](https://servicechannel.com/blog/spring-2026-product-release/) (L) |
| **CBRE Smart FM** | AI and analytics across more than 20,000 sites. Details in `05-cbre-insights.md` §11 | [CBRE PR Aug 2023](https://www.cbre.com/press-releases/cbres-ai-powered-facilities-management-solutions-reaches-1-billion-sf-of-deployment) (M, vendor claim) |
| **NVIDIA Omniverse / Nemotron** | Digital-twin and agent toolkits; a stack, not a competitor. See §2 (Omniverse DSX) and `11-nemotron-integration.md` | [NVIDIA Omniverse](https://www.nvidia.com/omniverse) (L) |

---

## 6. Where the white space is (be skeptical)

**(c) Pre-maintenance impact analysis — mostly served, so it can't be the main differentiator.**
Sunbird explicitly sells "see the impact... performing maintenance on panel," XpedITe sells maintenance impact on live services with N+1/2N checks, Schneider and Nlyte sell failure and redundancy-loss simulation, and Cadence and ETAP do it at engineering grade. The honest gap is *practical*, not *capability*. These tools only work when someone has built and maintained an accurate model, and Schneider's own FAQ shows how modeling choices break redundancy results. Many sites probably still run on spreadsheets and Visio, which is how Vertiv's own paper describes colo operations, but that is an adoption gap, not a missing feature. Cascade can win on (c) only by being faster to a trustworthy model and by speaking in MOP terms ("step 4 opens breaker X; hall 2 drops to N"), which the DCIM tools don't appear to do. ETAP's switching management comes closest.

**(a) Customer contracts and SLA dollars — half served; the dollar half looks open.**
- "Which customers are affected by this failure or maintenance" was marketed by Vertiv in 2016, is marketed by Schneider, and is patented by Equinix for customer-facing power paths. This half is **not new**.
- Pricing that exposure in **SLA dollars from actual contract terms** (credit schedules, per-feed vs. per-cabinet commitments, A+B vs. single-corded, cumulative downtime already used this period) showed up in **no product I found**. Insurers and brokers (Parametrix, Aon, Gallagher) describe SLA exposure as a top financial risk for data centers and lenders, but as advisory and underwriting content. https://www.parametrixinsurance.com/reports-white-papers/an-introduction-to-data-center-slas-key-terms-financial-risk-underwriting-implications , https://www.aon.com.au/apac/insights/blog/default/balancing-growth-and-risk-how-data-centres-can-res , https://www.ajg.com/news-and-insights/managing-sla-liability-in-data-center-projects/
- Skeptical read: this layer is thin to build once an incumbent has the customer-to-equipment map. Schneider or Sunbird could add a "credit $ at risk" column. Its defensibility comes from contract ingestion and from new buyers (CFO, risk, insurers, lenders), not from the math. Insurer and lender demand for SLA-exposure data may be a better wedge than ops.

**(b) AI-built dependency model from messy sources — under-served in data centers, but the tooling is commoditizing.**
No DCIM vendor I found advertises AI-built power chain models. They rely on manual modeling, templates, or network discovery of IT devices, and Sunbird generates SLDs *from* its model rather than reading them. Mapped proves that AI-tagging of BMS points works in commercial buildings. OpenDrawing.ai and Drawer AI are extracting SLDs into asset lists. Microsoft publishes a recipe for it. So (b) is real white space today, but it is a moat only if Cascade owns a validated data-center-specific ontology and a reconciliation workflow (SLD vs. BMS vs. spreadsheet vs. field truth). Parsing alone won't be one.

**Bottom line**
The space is **crowded at the simulation layer** and **empty at the contract/dollar layer**. The defensible version of Cascade is (b) plus (a)-dollars: ingest messy sources into a model fast, then translate every failure or maintenance scenario into contractual exposure. Pitch (c) as the daily-use workflow that keeps the model honest, not as the novelty. Cascade should also expect to coexist with, integrate with, or be acquired by DCIM/CMMS incumbents (MCIM, Schneider, Sunbird) rather than displace them.

**Open questions this research could not settle**
- Whether Schneider's tenant impact or Sunbird's colo features already attach contract or SLA metadata (needs demos).
- Whether large colos (Equinix, Digital Realty) have internal SLA-exposure tooling that makes them non-buyers.
- Whether stealth or early-stage startups are doing AI MOP validation; none surfaced in search.
- Pricing for every vendor listed: not verified.
