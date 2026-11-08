# 07 — Fragmented Sources and Entity Resolution

**Scope:** the data silos CBRE names (facilities management, access control, HVAC, lease contracts, utility connections), the open standards that model them (Brick, Haystack, 223P, RealEstateCore, OSCRE, Green Button), how to merge them into one dependency graph with entity resolution, and a synthetic multi-source dataset with deliberately inconsistent IDs. **Researched:** 2026-11-07.

Workforce, wages and the work-order schema are in `09-maintenance-workforce-and-work-orders.md`; CBRE Smart FM is in `05-cbre-insights.md` §11. Neither is repeated here.

Confidence: **high** = primary source read directly (spec file, official doc, contract PDF, CISA page). **medium** = secondary source or search excerpt only. **low** = inference.
Note: the session's web-search budget ran out partway through, so a few items below rest on search excerpts (marked medium) and §8 lists what is still unverified.

---

## 1. Summary

- **Pick Brick as the graph backbone, with RealEstateCore (REC) for leases and 223P/Haystack as reference vocabularies (high).** Brick v1.5.0 (released 2026-10-29) defines `feeds/isFedBy`, `hasPart/isPartOf`, `hasPoint/isPointOf`, `hasLocation`, and two relationships new in v1.5, `hosts` (BACnet device → point) and `controls` (controller → equipment). It has classes for `Switchgear`, `Automatic_Transfer_Switch`, `Bus_Riser`, `Chiller`, `Chilled_Water_Loop`, `Computer_Room_Air_Handler`, `ICT_Rack`, `Access_Reader` and `Electrical_Meter`. **Brick has no UPS or PDU class** (I grepped v1.4.4 and v1.5.0), so we need a small extension class. REC adds `Lease` (`leasee`, `leasor`, `leaseOf`, `regulatedBy → LeaseContract`) and `Premises`. Its `feeds` relationship carries a `substance` enum (ACElec, ChilledWater, …) and every REC entity has an `identifiers` map, which is the natural home for cross-system IDs.
- **Lease/SLA data (high, for the contracts read).** A real colocation SLA (OneColo) has three objectives. Power: 100% availability, credits tiered 1→50% of monthly recurring charge (MRC) by monthly downtime minutes. Environmental: 64–78 °F and 40–60% RH, credit 5% MRC per 60 min, capped at 50%. **Physical security**: any unauthorized access to customer space earns a 50% MRC credit. That last clause ties the access-control log directly to dollars. Other public SLAs: 99.9% power with 5% MRC per extra 30 min, capped at 100% (Euronodes); 1/30 MRC per hour beyond a 99.99% threshold (Verizon/Equinix, search excerpt). OSCRE's lease abstract has no SLA/credit fields, so we model SLAs ourselves.
- **Cyber angle (high).** CISA advisories show that BACnet has no network-layer authentication. Automated Logic WebCTRL (ICSA-26-078-08, Mar 2026, Commercial Facilities, CVSS 9.1) "does not add validation of BACnet traffic", so spoofed packets "may be processed as legitimate". Siemens APOGEE PXC (ICSA-25-135-14) can be pushed into a BACnet broadcast storm that needs a power cycle. KNX CVE-2023-4346 lets an attacker lock building devices with a BCU key, and CISA reports active exploitation. The real KNX lockout of a German office building in 2021 cost over €100k (medium). FrostyGoop (Lviv, 2024) used Modbus writes to heating controllers and cut heat to more than 600 buildings for about 2 days (medium). MITRE ATT&CK for ICS T0836 "Modify Parameter" is the right label for a malicious setpoint write.
- **Real non-cyber precedent (medium).** On Nov 27–28, 2025 a cooling/chiller-plant failure at CyrusOne CHI1 in Aurora, IL pushed temperatures above 100 °F and took CME markets down for more than 10 hours. CyrusOne later attributed it to staff and contractors not following cooling-tower draining procedures before a freeze.
- **Utility (high for structure, 2024 rates).** Oncor (DFW) bills commercial service above 10 kW on **demand**: distribution $5.12/kW, TCRF $4.37/kW and DCRF $0.61/kW (total $10.16/kW, July 2024), plus $32.43/mo in fixed charges. Billing kW is the greater of the actual NCP or **80% of the highest demand in the prior 11 months** (ratchet). IDR meters bill transmission on 4CP. One bad 15-minute interval can therefore raise demand charges for 11 months. Green Button (ESPI) models interval data as UsagePoint → MeterReading → IntervalBlock → IntervalReading (`timePeriod.start`, `duration`, `value`) plus ReadingType (`intervalLength`, `powerOfTenMultiplier`, `uom`).
- **Entity resolution (high).** BMS point names are "ad-hoc naming conventions that are inconsistently applied", and a BACnet object can validly be named "Bob" (LBNL/NREL/NIST 2020). Manual point mapping is quoted at $230/point up-front to $1,880/point over 5 years (LBNL citing Granderson & Lin 2016). The practical method: parse labels into equipment/part/point tokens, block by location hierarchy, fuzzy-match within blocks, score with Fellegi-Sunter (Splink, unsupervised, runs on DuckDB), have a human confirm low-confidence pairs, and store the result as a crosswalk on each node's external-ID map.
- **Proposed dataset (§6).** Seven files for one synthetic DFW mixed-use property (colo data hall on L1, offices above): BMS points+telemetry, BMS audit log, CMMS assets, CMMS work orders, lease abstracts+SLAs, PACS events, and 15-min utility interval data+notices. A hidden ground-truth topology and crosswalk support scoring. Each asset carries a different ID in each system, by design.

---

## 2. Per-source sections

### 2.1 Building data standards

| Standard | What it models | Key relationships / tags | Status | Source | Conf. |
|---|---|---|---|---|---|
| **Brick** (RDF/OWL) | Equipment, Points (sensor/setpoint/command/status/alarm), Locations, Systems/Loops | `hasPart/isPartOf` (composition); `feeds/isFedBy` ("media flows from subject into object", e.g. AHU feeds VAV); `hasLocation/isLocationOf`; `hasPoint/isPointOf`; **v1.5 new:** `hosts/isHostedBy` (BACnet_Device hosts point), `controls/isControlledBy` | v1.5.0 released 2026-10-29 (GitHub API) | https://docs.brickschema.org/brick/relationships.html ; https://github.com/BrickSchema/Brick/releases/tag/v1.5.0 | high |
| Brick classes relevant to us (grepped from v1.5.0 `Brick.ttl`) | `Switchgear` (def: "A main disconnect or service disconnect feeds power to a switchgear, which then distributes power…"), `Automatic_Transfer_Switch`, `Bus_Riser`, `Transformer`, `Breaker_Panel`, `Electrical_Meter`, `Building_Electrical_Meter`, `Chiller`, `Water_Cooled_Chiller`, `Cooling_Tower`, `Chilled_Water_Loop`, `Chilled_Water_Pump`, `Chilled_Water_Supply_Temperature_Sensor`, `Computer_Room_Air_Handler` (def: "uses fans, cooling coils and a water-chiller system to remove heat"), `Computer_Room_Air_Conditioning`, `ICT_Rack`, `Server`, `Server_Room`, `Access_Control_Equipment`, `Access_Reader`, `Intrusion_Detection_Equipment`, `Surveillance_Camera`, `Battery_Energy_Storage_System` | **No `Uninterruptible_Power_Supply` / UPS / PDU class in v1.4.4 or v1.5.0** (0 grep hits for "uninterrupt") | — | https://github.com/BrickSchema/Brick/releases/download/v1.5.0/Brick.ttl | high |
| Brick external refs | `ref:hasExternalReference`, `ref:BACnetReference`, `ref:hasTimeseriesId`, `ref:IFCReference` (ifcGlobalID) | Links a graph node to a BACnet object, a timeseries DB key, or a BIM GUID. **Use this to attach per-system IDs.** | in v1.4.4 TTL | same TTL | high |
| **Project Haystack** (tags + refs) | Sites, equips, points, spaces as tagged dicts with `id` | Containment: `{parent}Ref` → `siteRef`, `spaceRef`, `equipRef`. Flow: `{substance}Ref` placed on the *receiving* entity → `airRef`, `elecRef` ("Electricity flows from the referent to this entity"), `chilledWaterRef` ("Chilled water flows from the referent to this entity"), `steamRef`, `hotWaterRef`. Meters: `elec-meter`, `submeterOf` ("parent meter which is immediately upstream"), `meterScope`. Queries such as `inputs-hot-water? @hwp` and transitive `containedBy?` | the page flags the query design as a "straw-man proposal" | https://project-haystack.org/doc/docHaystack/Relationships ; https://project-haystack.org/doc/lib-phIoT/elecRef ; .../chilledWaterRef ; .../elec-meter | high |
| Haystack UPS | `lib-phIoT/ups` returned 404. I did not find a UPS def | — | — | — | gap |
| **ASHRAE 223P** (RDF/SHACL) | Physical topology at the connection level: Equipment, ConnectionPoint ("point where one Connectable thing connects to another"), Connection ("a physical thing (e.g., pipe, duct, wire)… carries a medium"), Property ("actuation and measurement points") | Draft TOC includes `s223:mapsTo` (§6.2.5). Brick classes can co-type 223 entities (`bldg:damper a s223:Damper, brick:Supply_Damper`), and REC space types can co-type 223 PhysicalSpace | **Not final.** First public review ran 2025-06-27 → 2025-08-11 (search excerpt of ASHRAE "sajun_27_2025"). DOE calls it "being developed" | https://docs.open223.info/definitions ; https://docs.open223.info/brick-rec ; https://www.energy.gov/cmei/buildings/ashrae-standard-223p | high (concepts) / medium (status) |
| **RealEstateCore (REC) 4.x** (DTDL/OWL) | Real estate + tenancy: Agent (Person/Organization), Collection (Portfolio, RealEstate, **Premises** = "administrative grouping of spaces … used … by a real estate holder or tenant"), Space (Building, Level, Room), Asset/Equipment (Brick-derived), Event (**Lease**), Information/Document (**LeaseContract**) | `Lease.leasee` (agent using the asset), `Lease.leasor`, `Lease.leaseOf` (property/equipment), `Lease.regulatedBy → LeaseContract`; `Equipment.feeds/isFedBy` with `substance` enum (ACElec, DCElec, ChilledWater, CondenserWater, SupplyAir, ReturnAir, …); `Agent.owns`; every entity has `identifiers: map<string,string>` | DTDL source in repo | https://github.com/RealEstateCore/rec/blob/main/Doc/Event/Lease.md ; …/Doc/Collection/Premises.md ; …/Doc/Information/Document/LeaseContract.md ; …/Doc/Agent/Agent.md ; …/Doc/Asset/Equipment/Equipment.md | high |

**Example dependency chain in standard vocabulary.** UPS and PDU are extension classes; everything else is native Brick/REC:

```
Utility service (Oncor ESIID)                         [ext:Utility_Service]
  └─feeds(ACElec)→ Building_Electrical_Meter MTR-MAIN  [brick]
     └─feeds→ Switchgear SWGR-A                        [brick:Switchgear]
        ├─feeds→ Automatic_Transfer_Switch ATS-1 ←feeds─ Generator GEN-1
        │   └─feeds→ UPS-1A                            [ext:UPS ⊂ brick:Electrical_Equipment]
        │       └─feeds→ PDU-1A                        [ext:PDU]
        │           └─feeds→ ICT_Rack R03 ─hasLocation→ Room "Cage C3"
        │                                   ←leaseOf─ rec:Lease L-0007 ─leasee→ Org "Northwind Trading LLC"
        └─feeds→ Motor_Control_Center MCC-M1 ─feeds→ Chiller CH-1, Chilled_Water_Pump CHWP-1, CRAH-2
Chiller CH-1 ─feeds(ChilledWater)→ Chilled_Water_Loop CHWL-1 ─feeds→ Computer_Room_Air_Handler CRAH-2
CRAH-2 ─feeds(SupplyAir)→ HVAC_Zone "Data Hall 1" ─(contains)→ ICT_Rack R03
BACnet_Device DEV-1007 ─hosts→ Chilled_Water_Supply_Temperature_Sensor; Controller BC-07 ─controls→ CH-1, CRAH-2
Access_Reader RDR-DH1-C3 ─hasLocation→ Cage C3
```
Two paths converge on rack R03: power (SWGR→ATS→UPS→PDU) and cooling (MCC→chiller→CHW loop→CRAH→zone). A cooling failure therefore reaches the tenant even though nothing on the power path breaks. That convergence is the hidden dependency CBRE is talking about.

### 2.2 Lease / tenant data

| Item | Content | Source | Conf. |
|---|---|---|---|
| OSCRE Lease Abstract Exchange Standard | v1.0 published 2008 for "condensed summaries of lease documents", U.S. commercial first. It is now part of the OSCRE Industry Data Model (130+ use cases, JSON/XML schemas) | https://www.fmlink.com/oscre-publishes-lease-abstract-standard-for-real-estate/ ; https://www.oscre.org/Industry-Data-Model/Introducing-the-Data-Model (search excerpt) | high / medium |
| OSCRE-format field names (as implemented by VTS export) | `LeaseAbstract` → `TenantDBAName`; `Building{Name, Address{…}, Reference}` → `Unit{UnitNumber, AreaMeasurement{Amount, UnitOfMeasurementCode}}`; `Term{Months}`; `Charge{ChargeDescription, ChargeAmountBasisCode, ChargeFrequencyCode, ChargeType, Schedule{StartDate, EndDate}, ChargeAmount{CurrencyCode, Amount}}`; `Option{OptionTypeCode, EarliestNoticeDate, LatestNoticeDate, …}`; `LeaseDate{Name, EventOrRightTypeCode, Date}`; `SecurityDeposit`; `Reference{ID, AllocatedBy}`; `LeaseContractReference`. **No SLA/clause section.** | https://readme.vts.com/docs/lease-abstract-export | high |
| REC lease model | `Lease` (Event with `start`/`end`) → `leasee`, `leasor`, `leaseOf` (a Premises or equipment), `regulatedBy` → `LeaseContract` ("identifies the Tenant and the leased asset… states lease term and fee (rent), and detailed terms") | REC docs above | high |
| **Colo SLA, OneColo** | **Power**: 100% availability to the receptacle. Monthly downtime 10–43 min → 1% MRC; 43–432 → 2%; 432–864 → 5%; 864–1,296 → 10%; 1,296–2,160 → 25%; >2,160 → 50% (cap 50%). **Environmental**: supply air 64–78 °F and RH 40–60%, 5% MRC per 60-min increment, cap 50%/mo. Requires customer gear "properly oriented to cold/hot aisles". **Physical security**: "any unauthorized access to such Customer Space" → **50% MRC**. All objectives together capped at 100% MRC. Reason for Outage (RFO) within 5 business days. Credits issued proactively within 5 business days. Exclusions: scheduled maintenance, customer request, upstream provider outages, force majeure, localized conditions inside the customer space | https://onecolo.com/legal/OneColo-Service_Level_Agreement.pdf (text extracted) | high |
| Colo SLA, Euronodes | Power 99.9% monthly; "5% of monthly recurring charges for each additional 30 minutes of Downtime", "capped at 100%"; claim "within 10 business days… with documented evidence"; no numeric environmental SLA | https://kb.euronodes.com/agreements/colocation/ | high |
| Colo SLA, Verizon/Equinix | 99.99% redundant power; credit 1/30 MRC per full hour beyond threshold | search excerpt; the PDF URL returned 404 on fetch — https://www.verizon.com/business/service_guide/reg-20190617/cp_colocation_equinix_data_centers_sla.pdf | medium |
| Colo SLA, Bluebird / Savvis tiers | <5 min 0%, 5–60 min 10%, 61–120 25%, 121–360 50%, >361 100% (Bluebird). Savvis: cumulative ≥1 & <45 min → 5% | search excerpts only (pages 404/403 on fetch) | medium |
| PhoenixNAP claim mechanics | Downtime starts when PNAP "receives the email 'ticket' and verifies an outage"; claim within 3 days; one event per report | https://www.phoenixnap.com/cs/legal/colo.html | high |
| Thermal reference (for SLA thresholds) | ASHRAE 2021 Table 2.1: **Recommended** 18–27 °C (A1–A4); **A1 allowable** 15–32 °C; A1 max rate of change 5 °C/h (5/20) | ASHRAE Thermal Guidelines 5th ed. reference card — https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf (text extracted) | high |
| "Critical-load commitment" (contracted kW per cabinet, A+B feeds) | Common in colo order forms, but **I did not find a public primary source** with a kW-commitment clause | — | gap |

### 2.3 Access control (PACS) and BMS/OT security events

**PACS log shape.** No single standard exists. Vendors converge on the same core fields:

| Field (canonical) | DoorFlow name | Solink CSV name | Notes |
|---|---|---|---|
| event_id | `id` | `eventUniqueId` (req.) | |
| ts (UTC) | `occurred_at` ("Timestamp (UTC)") | `startTime` (req.), `endTime` | normalize the time zone before joining |
| door / reader | `channel_id`, `channel_name` | `doorId` (req.), `terminalId` (req.), `doorName` | |
| site / building | — | `locationId` (req.), `buildingId` | |
| person | `person_id`, `person_name` | `actorId` (req.), `actorName` | company is often a free-text field, which is an entity-resolution issue |
| credential / method | `credential_id` | `accessMethod` (Swipe/RFID/Pin/Biometric/Mobile/…) | |
| event type | `event_code`: 10–16 Access Granted (PIN/Mobile); 20–26 Access Denied (No Permission / Invalid Credential); 40–47 Channel Online/Offline/**Tamper Alert/Door Forced Open/Door Held Open**; 60–70 Sync/Configuration Change | `action` ∈ {Access Granted, Access Denied, Exception Event, Informational Event}; `result` ∈ {success, failure, unprocessable}; `state` ∈ {open, close, unknown} | |

Sources: https://developer.doorflow.com/guides/webhooks/audit-trail ; https://help.solink.com/en/articles/13929606-access-control-csv-guidelines (high for those vendors; medium as "industry-typical").

**BMS/OT cyber facts usable for a realistic, defensive scenario:**

| Item | Fact | Source | Conf. |
|---|---|---|---|
| ICSA-26-078-08, Automated Logic WebCTRL Premium Server < v8.5 | Mar 19 2026; sector Commercial Facilities; CVE-2026-32666 auth bypass by spoofing (CWE-290, 7.5), CVE-2026-24060 cleartext (9.1), CVE-2026-25086 (7.7). "BACnet has no network-layer authentication"; spoofed packets "may be processed as legitimate"; impact "read, intercept, or modify communications". Mitigation: BACnet/SC (TLS + mutual auth), segmentation; WebCTRL 7 EOL since 2023-01-27. No known public exploitation | https://www.cisa.gov/news-events/ics-advisories/icsa-26-078-08 | high |
| ICSA-25-135-14, Siemens APOGEE PXC + TALON TC | May 15 2025; CVE-2025-40555; a crafted BACnet `createObject` makes the device "start sending unsolicited BACnet broadcast messages", a partial DoS that needs a power cycle; no fix planned; sectors include Commercial Facilities and IT | https://www.cisa.gov/news-events/ics-advisories/icsa-25-135-14 | high |
| ICSA-23-236-01, KNX Connection Authorization | CVE-2023-4346 (CVSS 7.5, A:H): an attacker can "purge devices… and set a BCU key, locking out the owner"; "CISA has received reports of this vulnerability being actively exploited". Added to the CISA KEV catalog around 2026-07-17 per news (not confirmed on CISA's page) | https://cisa.gov/news-events/ics-advisories/icsa-23-236-01 ; KEV date: securityaffairs excerpt | high / medium |
| Real BMS lockout incident | Oct 2021, German office building: ~¾ of KNX devices locked with an attacker-set key, hundreds of devices lost, replacement > €100k; suspected entry via an IP gateway left from construction (Limes Security) | https://www.darkreading.com/cyberattacks-data-breaches/lights-out-cyberattacks-shut-down-building-automation-systems (search excerpt) | medium |
| FrostyGoop (Lviv) | ICS malware using Modbus TCP writes to ENCO heating controllers; ~2 days without heat for 600+ apartment buildings; Dragos attribution at moderate confidence | https://hub.dragos.com/hubfs/Reports/Dragos-FrostyGoop-ICS-Malware-Intel-Brief-0724_.pdf (search excerpt) ; MITRE S1165 | medium |
| MITRE ATT&CK for ICS T0836 Modify Parameter | "Adversaries may modify parameters used to instruct industrial control system devices"; FrostyGoop is a procedure example | https://attack.mitre.org/techniques/T0836/ | high |
| HVAC vendor as an entry point | Target 2013: attackers reportedly used credentials stolen from HVAC contractor Fazio Mechanical; Target did not confirm | https://www.darkreading.com/attacks-breaches/target-breach-hvac-contractor-systems-investigated (search excerpt) | medium |

Framing for the demo: we **simulate the observable effects** (an unexpected BACnet WriteProperty to a chilled-water setpoint from an unfamiliar host, logged by the BMS audit trail) and show detection plus response. We do not build or describe exploit mechanics.

### 2.4 Utility data

| Item | Fact | Source | Conf. |
|---|---|---|---|
| Interval data model (Green Button / NAESB REQ.21 ESPI) | UsagePoint → MeterReading → IntervalBlock(`interval.start`, `interval.duration`) → IntervalReading(`timePeriod.start`, `timePeriod.duration`, `value`); ReadingType(`intervalLength`, `powerOfTenMultiplier`, `uom`); IntervalBlock start must equal its first reading's start; start times must be unique | https://www.greenbuttonalliance.org/fb04 | high |
| Texas smart meters | Smart Meter Texas holds 15-minute interval data for 2 years and is keyed by ESIID; portal report "Energy Data 15 Min Intervals" | SMT Interface Guide (fetch timed out; search excerpt) https://www.smartmetertexas.com/commonapi/gethelpguide/help-guides/Smart_Meter_Texas_Interface_Guide.pdf ; https://gotrhythm.com/blog/smart-meter-texas-instructions | medium |
| Oncor demand charges (secondary > 10 kW, eff. 2024-07-01) | Customer charge $11.13/mo + meter $21.30/mo; per kWh EECRF 0.0407¢; **per kW**: Distribution System Charge $5.121040, TCRF $4.369967, DCRF $0.614487, nuclear decommissioning $0.045, ITR $0.012192 → **total $10.162686/kW** | TXU "TDU Charges … COMMERCIAL GT10KW" PDF (text extracted) — https://txu.com/-/media/Project/VistraApps/DT/Files/Content-Pages/Help-Center/20240701_-_TDU_Charges_Web_Update_COMMERCIAL_GT10KW_SPA_DETAIL.pdf | high (as of 2024; rates change twice yearly) |
| Billing demand rules | **Ratchet**: billing demand = max(actual NCP, 80% of the highest demand in the prior 11 months). **4CP**: average of the June–Sept coincident peaks at ERCOT system peak in the prior year; IDR meters bill on 4CP, non-IDR on NCP | same TXU PDF glossary | high |
| Oncor charge structure page | TCRF is applied to "NCP kW or 4CP kW"; new customers without history are billed on NCP | Oncor "Delivery charges 101" (cert error on fetch; search excerpt) | medium |
| Utility outage notices | No machine-readable standard found. Treat them as unstructured text or email (planned-outage notice with feeder/ESIID, window, reason) | — | gap |

### 2.5 FM/CMMS
Covered in `09-maintenance-workforce-and-work-orders.md` §3 (Maximo field names: `assetnum`, `location`, `parent`, `wonum`, `status`, …). Here we only add the cross-system ID problem (§4).

---

## 3. Dependency-graph model

**Node types** (each node carries `ext_ids: {bms, cmms, lease, pacs, utility, oneline}`, following Brick `ref:hasExternalReference` and REC `identifiers`):
`UtilityService, Meter, Switchgear, ATS, Generator, UPS*, PDU*, MCC, Chiller, CoolingTower, CHWPump, CHWLoop, CRAH, Zone/Room, Rack, Premises(cage/suite), Tenant(Org), Lease, SLAClause, BACnetDevice, Controller, Point, AccessReader/Door` (* = extension class).

**Edge types:**
| Edge | Meaning | Standard |
|---|---|---|
| `feeds{substance}` | upstream → downstream (ACElec, ChilledWater, SupplyAir) | Brick `feeds`; REC `feeds` + `substance`; Haystack `elecRef`/`chilledWaterRef` (inverse direction) |
| `isPartOf` | component → parent | Brick/REC |
| `hasLocation` | equipment → room/zone | Brick |
| `hasPoint`, `hosts`, `controls` | equipment → telemetry; BACnet device → point; controller → equipment | Brick (v1.5 for hosts/controls) |
| `leaseOf`, `leasee`, `regulatedBy` | lease → premises; lease → tenant; lease → contract | REC |
| `coveredBy` | premises → SLA clause | **our extension** (no standard has SLA clauses) |
| `controlsAccessTo` | reader/door → room/premises | our extension (Brick only gives `hasLocation`) |

**How to build it from the silos:**
1. **Spine from the one-line and mechanical drawings** (in the demo, `topology_ground_truth.ttl`, or hand-entered). Real sites often lack these. Fallbacks: CMMS `parent`, Haystack refs if present, and inference from telemetry (e.g. a CRAH's supply-air temperature lags its chilled-water valve).
2. **Attach points**: BMS point → equipment via label parsing (§4), producing `hasPoint`.
3. **Attach business layer**: rack → premises (lease abstract "Cage C3") → lease → tenant → SLA clauses.
4. **Attach security layer**: PACS door → room; BMS controller → equipment (`controls`), so a suspicious write on controller BC-07 propagates to everything BC-07 controls.
5. **Impact query** (cascade): from a faulted node, traverse `feeds`/`controls` downstream to every reachable Rack, then Premises → Lease → SLA, and compute credit exposure = Σ MRC × credit%(projected minutes). In SPARQL: `?fault brick:feeds+ ?rack . ?rack brick:hasLocation ?cage . ?lease rec:leaseOf ?cage`. In Python, networkx `descendants()` does the same.
6. **Redundancy awareness**: a node fails only if *all* its feeders fail (N+1 CRAHs, A/B power). Store `redundancy_group` on edges and evaluate as AND/OR, not plain reachability. Without this the cascade over-predicts. This is our modeling choice; no standard encodes it.

---

## 4. Entity resolution across silos

**Why IDs differ** (high unless noted):
- BMS labels encode building/system/part/point in vendor-specific, field-engineer conventions. They are "not intended to make them machine-readable", and BIM-to-BAS linkage failed in one study because of "inconsistent naming conventions" (Chamari et al., CEUR Vol-3633 paper 11: https://ceur-ws.org/Vol-3633/paper11.pdf). In that study, 2,338 points dropped to 763 that followed the convention, and some had no Brick class at all.
- "BACnet fields are left blank or incomplete… ad-hoc naming conventions that are inconsistently applied… The 'name' of an object could be 'Bob.'" Point mapping "is often implemented manually by an engineer", at $230/point up-front to $1,880/point over 5-year ownership (citing Granderson & Lin 2016). Source: Bergmann et al., "Semantic Interoperability to Enable Smart, Grid-Interactive Efficient Buildings", ACEEE Summer Study 2020, LBNL — https://escholarship.org/uc/item/1325d5j3
- CMMS asset IDs are assigned by the FM provider at handover. Lease docs use legal/marketing names ("Suite 110", "Data Hall One"). PACS uses door names from the security integrator. The utility uses ESIID/meter numbers. Each system has a different owner and lifecycle (low: inference, but self-evident from the field lists above).
- Prior work: regex rules (Bhattacharya et al., BuildSys 2015, doi:10.1145/2821650.2821667) and active learning that needs 28% fewer examples than regex (per the CEUR survey) (medium: bibliographic or survey excerpt only).

**Practical pipeline (what we will build):**
1. **Normalize**: uppercase; split on `._-/ ` and camelCase; expand an abbreviation dictionary (`CHLR|CH→CHILLER`, `CRAH|CRU→CRAH`, `CHWST→CHW SUPPLY TEMP`, `SAT→SUPPLY AIR TEMP`, `DH1|DATA HALL ONE|DATAHALL 1→DH1`, `L1|FL1|1ST FLR→L1`); strip legal suffixes (`LLC, INC, CORP`) for tenants.
2. **Parse the location hierarchy** into (site, building, floor, room, equipment-type, equipment-number, point-type) with per-source regexes, following the system/part/point split in Chamari et al.
3. **Block**: only compare records sharing (building, floor) **and** a compatible Brick class. This keeps comparisons small and blocks absurd matches.
4. **Score**: Jaro-Winkler or token-set similarity on names, exact match on equipment number, location agreement, and class agreement. Combine with **Fellegi-Sunter** m/u weights. Splink does this "with no labelled training data", locally on DuckDB (https://moj-analytical-services.github.io/splink/). For a hackathon-size set, hand-set weights or rapidfuzz plus rules is enough.
5. **Corroborate with behavior** (our idea, low confidence): a CMMS work order "CRAH-DH1-02 fan fail" should coincide with a fan-status drop on the candidate BMS point. Use this as a tie-breaker.
6. **Human-in-the-loop**: auto-accept ≥0.9, queue 0.6–0.9 for one-click confirmation in the UI (a good live-demo moment), reject <0.6.
7. **Persist** a `crosswalk.csv` (canonical_id, system, system_id, score, method, confirmed_by) and write it onto graph nodes as `ext_ids`. Measure precision/recall against the hidden ground truth.

---

## 5. Cascade scenario the data supports

Synthetic property **"Prairie Creek Tech Center"** (fictional; DFW, so Oncor/ERCOT rules apply). Two-storey building: L1 colocation Data Hall 1 (DH1) with 4 caged tenants; L2 office tenants. Chilled-water plant: CH-1 duty + CH-2 standby; CRAH-1..4 in N+1; UPS-1A/1B A+B power.

| t (local) | Silo | Observable | Why it matters |
|---|---|---|---|
| 01:52 | PACS | `Access Granted` at `L1 MECH RM 104` for a contractor badge from "Lone Star Mechanical", outside any open work order | Physical access with no matching WO (join PACS↔CMMS) |
| 02:11 | BMS audit | WriteProperty `CHW-SP` 44.0→56.0 °F on device 1007 from host 10.20.9.77 (not the BMS server 10.20.1.10); CH-2 auto-start disabled | T0836 Modify Parameter. Only visible by joining the audit log to the asset graph |
| 02:15–02:45 | BMS telemetry | CHWST climbs 44→55 °F; CRAH-2/3 supply-air temperature climbs; CRAH valves pinned at 100% | Early anomaly, while every BMS alarm is still "within limits" |
| 02:48 | BMS | Rack inlet R03 (Cage C3) > 27 °C (above ASHRAE recommended) | Approaching the SLA environmental threshold (78 °F ≈ 25.6 °C) |
| 03:05 | BMS | > 32 °C (above A1 allowable) on 2 racks; tenant servers start thermal throttling/shutdown | Hardware risk, SLA clock running |
| 03:10 | CMMS | Auto WO P1 `CRAH-DH1-02 high SAT` opened against the wrong asset (CMMS ID mismatch) | Shows the cost of unresolved IDs |
| 03:20 | Ops action | Restore setpoint, start CH-2. If both chillers plus pull-down start in the same 15-min window, a **demand spike** occurs | The utility interval shows a new peak kW that is ratcheted at 80% for 11 months |
| 03:00–04:30 | Lease/SLA | Cages C1–C3 environmental breach (5% MRC per 60 min, cap 50%); if a cage door is forced during response, 50% MRC physical-security credit | Business impact in dollars, per tenant |
| +1 day | Utility | Notice of planned feeder maintenance on the same circuit in 3 days (unstructured text) | A second hazard: the platform should flag that CH-2 is now the only healthy chiller |

**What the platform does ("execute", not just display):** isolate host 10.20.9.77 (recommendation to the OT team), roll back the setpoint, open correctly linked WOs, stage the chiller restart to cap 15-min kW, notify the affected tenants with the clauses that apply, and draft the RFO (OneColo requires one within 5 business days).

---

## 6. Proposed synthetic dataset (one property)

Folder `data/prairie_creek/`. **Same asset, different ID in every system** (crosswalk example):

| Canonical (hidden) | BMS | CMMS `assetnum` | One-line / drawings | Lease doc | PACS | Utility |
|---|---|---|---|---|---|---|
| `CRAH-2` | `PCTC.L1.DH1.CRU02` (device 1007, AI:3 = SAT) | `CRAH-DH1-02` "Computer Room Air Handler #2 – Data Hall One" | `CRAH 1-2` | "the Data Hall One cooling system" | — | — |
| `CH-1` | `PCTC.CHLR1` | `CH-0001` "Chiller 1 – 500T centrifugal" | `CH-1` | — | — | — |
| `UPS-1A` | `UPS1A` | `UPS-A-001` | `UPS-1A` | "A-side UPS" | — | — |
| `CAGE-C3` | zone `DH1_Z3` | location `PCTC-L1-110-C3` | — | "Suite 110, Cage 3" | door `DH1-CAGE03-RDR` | — |
| `TENANT-NW` | — | requester "Northwind" | — | "Northwind Trading LLC" | company "NORTHWIND TRADING" | — |
| `SVC-MAIN` | `MTR_MAIN_kW` | `MTR-MAIN-01` | `MSB-A` | — | — | ESIID `10443720000000001` (synthetic, format not verified) |

### 6.1 `bms_points.csv` + `bms_telemetry.csv` (BMS / Haystack-like export)
Fields: `point_id, point_name, bacnet_device, bacnet_object, units, kind, equip_hint`
```
point_id,point_name,bacnet_device,bacnet_object,units,kind,equip_hint
p-0012,PCTC.CHLR1.CHWST,1007,AI:1,°F,Number,
p-0013,PCTC.CHLR1.CHW-SP,1007,AV:4,°F,Number,
p-0031,PCTC.L1.DH1.CRU02.SAT,1007,AI:3,°F,Number,
p-0032,PCTC.L1.DH1.CRU02.CHWV,1007,AO:2,%,Number,
p-0090,DH1_Z3_RACK03_INLET,2011,AI:7,°C,Number,     <- different vendor, different units
p-0101,MTR_MAIN_kW,3001,AI:1,kW,Number,
```
Telemetry (long format; maps to Brick `ref:hasTimeseriesId`): `ts_utc, point_id, value, quality`, 1-min for HVAC, 15-min for the meter.
Source of the field idea: Haystack point `kind`/`unit` and Brick BACnetReference (§2.1).

### 6.2 `bms_audit_log.csv` (OT security)
`ts_utc, device, object, property, old_value, new_value, src_ip, user, service`
```
2026-11-08T08:11:04Z,1007,AV:4,presentValue,44.0,56.0,10.20.9.77,,WriteProperty
2026-11-08T08:11:30Z,1007,BV:9,presentValue,AUTO,DISABLED,10.20.9.77,,WriteProperty
2026-11-08T07:30:00Z,1007,AV:4,presentValue,44.0,44.0,10.20.1.10,svc_bms,WriteProperty   <- normal baseline
```
Basis: BACnet WriteProperty spoofing exposure (ICSA-26-078-08); MITRE T0836. Note: real BMS audit-log formats are vendor-specific. **This schema is ours** (gap).

### 6.3 `cmms_assets.csv` (Maximo-style; see `09-maintenance-workforce-and-work-orders.md` §3.1)
`assetnum, description, location, parent, classstructureid, manufacturer, installdate, priority, brick_class_hint`
```
CH-0001,"Chiller 1 - 500T centrifugal",PCTC-CUP,,"HVAC/CHLR",,2017-05-01,1,Water_Cooled_Chiller
CRAH-DH1-02,"Computer Room Air Handler #2 - Data Hall One",PCTC-L1-DH1,,"HVAC/CRAH",,2018-02-10,1,Computer_Room_Air_Handler
UPS-A-001,"UPS A-side 750kVA",PCTC-L1-ELEC,SWGR-A-01,"ELEC/UPS",,2018-02-10,1,ext:UPS
```

### 6.4 `cmms_workorders.csv` (subset of the `09-maintenance-workforce-and-work-orders.md` §3.2 schema)
`wonum, assetnum, location, description, worktype, wopriority, status, reportdate, reportedby`
```
WO-26-01822,CRAH-DH1-02,PCTC-L1-DH1,"CRU02 high supply air temp",EM,1,WAPPR,2026-11-08T09:10Z,BMS-ALARM
WO-26-01790,CH-0001,PCTC-CUP,"Quarterly chiller PM",PM,3,COMP,2026-11-01T14:00Z,PM-SCHED
```

### 6.5 `leases.json` (OSCRE-style abstract + REC relationships + our SLA block)
```json
{
  "Reference": {"ID": "L-0007", "AllocatedBy": "PCTC-LEASEADMIN"},
  "TenantDBAName": "Northwind Trading LLC",
  "Building": {"Name": "Prairie Creek Tech Center", "Unit": {"UnitNumber": "Suite 110, Cage 3",
               "AreaMeasurement": {"Amount": 400, "UnitOfMeasurementCode": "SQFT"}}},
  "Term": {"Months": 60}, "Schedule": {"StartDate": "2024-03-01", "EndDate": "2029-02-28"},
  "Charge": [{"ChargeType": "Colocation MRC", "ChargeFrequencyCode": "Monthly",
              "ChargeAmount": {"CurrencyCode": "USD", "Amount": 18500}}],
  "rec": {"leaseOf": "Suite 110, Cage 3", "leasee": "Northwind Trading LLC", "leasor": "PCTC Owner LP"},
  "sla": [
    {"objective": "power", "standard": "100% availability",
     "credit_tiers_min_pct": [[10,1],[43,2],[432,5],[864,10],[1296,25],[2160,50]], "cap_pct": 50},
    {"objective": "env_temp", "band_F": [64, 78], "credit_pct_per_60min": 5, "cap_pct": 50},
    {"objective": "env_rh", "band_pct": [40, 60], "credit_pct_per_60min": 5, "cap_pct": 50},
    {"objective": "physical_security", "credit_pct": 50},
    {"overall_cap_pct": 100, "rfo_business_days": 5}
  ]
}
```
OSCRE field names: VTS OSCRE export (§2.2). Lease relationships: REC. SLA tiers copied from the OneColo SLA. The MRC amount ($18,500) is **invented** and must be labeled synthetic (gap: no public colo MRC benchmark was retrieved).

### 6.6 `pacs_events.csv` (canonicalized from DoorFlow/Solink fields)
`event_id, ts_utc, door_id, door_name, building_id, actor_id, actor_name, actor_company, access_method, action, result, state`
```
E-559201,2026-11-08T07:52:13Z,MR104-RDR,"L1 MECH RM 104",PCTC,C-4471,"J. Doe","Lone Star Mechanical",RFID,Access Granted,success,open
E-559230,2026-11-08T08:40:02Z,DH1-CAGE03-RDR,"DH1 CAGE 03",PCTC,,,,,Exception Event,failure,open   <- Door Forced Open
E-559231,2026-11-08T08:41:10Z,DH1-CAGE03-RDR,"DH1 CAGE 03",PCTC,C-1180,"A. Smith","NORTHWIND TRADING",Mobile,Access Granted,success,close
```

### 6.7 `utility_interval.csv` + `utility_notices.jsonl` (Green Button-shaped)
Interval: `usage_point (ESIID), interval_start_utc, duration_s, value_kWh, uom, power_of_ten, quality`
```
10443720000000001,2026-11-08T09:15:00Z,900,412.5,kWh,0,actual
10443720000000001,2026-11-08T09:30:00Z,900,538.0,kWh,0,actual    <- 2,152 kW avg: restart spike
```
(15-min kW = kWh × 4.) Tariff params file: `{"tdu":"Oncor","per_kW_total":10.162686,"ratchet_pct":80,"ratchet_months":11,"eff":"2024-07-01"}`.
Notice (unstructured on purpose): `{"received":"2026-11-09","from":"utility-noreply","text":"Planned maintenance on feeder serving ESI ID 10443720000000001, 11/12 01:00–05:00 CT…"}`

### 6.8 Hidden ground truth (for scoring, not shown to the matcher)
`topology_ground_truth.ttl` (Brick + REC + `ext:UPS/PDU`, `ext:coveredBy`) and `crosswalk_truth.csv`. Used to score entity-resolution precision/recall and the accuracy of cascade predictions.

**Generation notes:** HVAC telemetry can be a first-order lag on CHW setpoint plus noise. Rack inlet ≈ CRAH SAT + offset. Meter kW = base IT load + chiller kW ∝ cooling load. These physics are **our simplifications** (low confidence); `06-cooling-physics.md` supplies cited parameters and a heat model.

---

## 7. Field-to-standard map (quick reference)

| File | Field(s) | From |
|---|---|---|
| bms_points | point/equip/kind/unit; bacnet_device/object | Haystack point tags; Brick `ref:BACnetReference` |
| bms_telemetry | point_id → series | Brick `ref:hasTimeseriesId` |
| bms_audit_log | WriteProperty, presentValue | BACnet service names (per CISA advisories); schema ours |
| cmms_assets / workorders | assetnum, location, parent, wonum, status… | Maximo (`09-maintenance-workforce-and-work-orders.md`) |
| leases | TenantDBAName, Unit, Term, Charge, Reference | OSCRE (via VTS export) |
| leases.rec | leaseOf, leasee, leasor, regulatedBy | RealEstateCore |
| leases.sla | tiers, bands, caps, RFO | OneColo SLA (contract, not a standard) |
| pacs_events | occurred_at/event_code; eventUniqueId/action/result/state/accessMethod | DoorFlow; Solink |
| utility_interval | UsagePoint, IntervalReading timePeriod/value, ReadingType | Green Button / ESPI |
| tariff | per-kW charges, 80%/11-mo ratchet, 4CP | Oncor via TXU TDU sheet |
| graph edges | feeds, isPartOf, hasPoint, hasLocation, hosts, controls | Brick v1.5; REC `feeds{substance}` |

---

## 8. Open gaps (stated plainly)

1. **No UPS/PDU class in Brick v1.5.0**, and no Haystack `ups` def was found (404). We add `ext:UPS` and `ext:PDU` as subclasses of `brick:Electrical_Equipment` and should say so on stage.
2. **ASHRAE 223P is not final.** Public review ran mid-2025, and the `mapsTo`/`cnx` semantics were not retrieved (several open223 doc URLs 404'd). Use 223P as a conceptual reference only.
3. **No standard models SLA clauses or service credits**: not OSCRE, REC or Brick. Our `sla` block is a custom extension based on one real contract (OneColo) plus Euronodes. Verizon/Equinix, Bluebird and Savvis figures are search excerpts only. More colo SLA tables (Cyxtera, CyrusOne, Digital Realty, PhoenixNAP) are in `03-buyers-and-workflow.md` §3 and `06-cooling-physics.md` P61–P63.
4. **No public colo MRC or kW-commitment benchmark** was retrieved in this scan. Any $ MRC in the dataset is invented and must be labeled synthetic. CBRE wholesale asking rates per kW-month are in `05-cbre-insights.md` §8 and `06-cooling-physics.md` P58–P60; Cyxtera's SLA excludes customers above 80% on a redundant pair (`03-buyers-and-workflow.md` §3), the nearest thing to a kW-commitment clause found.
5. **BMS audit-log format** is vendor-specific and no public schema was found. Ours is invented but uses real BACnet service names.
6. **Utility outage notices** have no machine-readable standard (none found). The Smart Meter Texas file layout and the ESIID format were not verified (the guide's fetch timed out).
7. **Oncor rates are as of July 2024** (TXU sheet). Current 2026 rates were not retrieved, and Oncor's own page failed TLS on fetch.
8. **KNX KEV listing date (2026-07-17)**, the German KNX lockout details, FrostyGoop impact figures, the CME/CyrusOne root cause ("human error" per Bloomberg headline) and the Target/Fazio link are all secondary or search-excerpt (medium).
9. **Entity-resolution accuracy figures** for BMS point mapping (beyond the CEUR case study counts) were not retrieved. The Bhattacharya 2015 and Koh 2018 full texts were not read, and the Plaster search failed (budget exhausted).
10. **Data-center incident base rates** (e.g. Uptime Institute outage-cause shares) were not covered here because the web-search budget ran out. They are in `01-outage-evidence.md`, which also covers the CME/CyrusOne root cause from trade-press and Bloomberg reporting.
