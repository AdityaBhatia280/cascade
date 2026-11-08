# DFW1: fictional colocation site

DFW1 is a made-up, mid-size, multi-tenant colocation facility in Garland, Texas, just outside Dallas. It exists so Cascade has a realistic site to ingest. Every company, account number, address and asset tag in it is invented.

## The building

There is one data hall today, **DH-1**, on the first floor of Building 1. It is a 30.5 m x 22.0 m raised floor designed for 600 kW of IT load and is a little over half sold. The hall has five rows of cabinets, lettered A through E, with 10 to 12 cabinets per row and 52 cabinets in all.

**Power.** Power arrives on a 12.47 kV Oncor service (UTIL-1). A separate small service (UTIL-2) feeds the office. The critical chain is split into an A side and a B side. Each side has:

- a 2 MW Caterpillar generator
- an automatic transfer switch
- a 3000 A switchboard
- a 750 kVA Eaton UPS with a maintenance bypass

Below the UPSs are three pairs of 150 kVA floor PDUs. Rows A and B take branch circuits straight from PDU-1A/1B. Row C is a high-density row fed from PDU-2A/2B. Rows D and E are served by remote power panels (RPPs) that hang off PDU-3A/3B. RPP-5B was added in 2024 for a tenant expansion.

**Cooling.** A central plant on the pad behind the building has three 90-ton Trane air-cooled chillers on two primary supply headers, plus three secondary pumps, all on one chilled-water loop. The plant feeds eight 105 kW Liebert chilled-water CRAHs, four along the north wall and four along the south. Mechanical loads are split across the two switchboards through motor control centers MCC-A and MCC-B and mechanical panels MP-A and MP-B.

The plant is built for phase 1, not for the full hall. Two chillers make 633 kW at their 95 °F rating and 589 kW at 105 °F, which carries about 545 kW of IT at the 1.08 cooling-to-IT ratio below. That holds N+1 at today's 347 kW, but not at the 600 kW build-out (648 kW of cooling). The register's loop note says so and reserves a pad and an MCC-A bucket for a fourth chiller. Cascade audits measured load, so this gap is a documented design limit, not a finding. Raising the chillers to cover the build-out would also let CH-1 alone carry today's load, which would erase the planted MCC-B common-cause defect.

**Tenants.** Six customers occupy the hall:

| Account | Customer | Cabinets |
|---|---|---|
| C1041 | Mesquite Cloud | rows A and B |
| C1077 | Pecan Street Media | row B |
| C1102 | Caddo AI | row C, high density |
| C1129 | Trinity Logistics | row D |
| C1156 | Halcyon Health | row E |
| C1183 | Lone Star Genomics | row E expansion |

Each customer has a master services agreement and an order form. Together these set out price, licensed cabinets, committed kW per cabinet, power and cooling redundancy, and two service levels with credit schedules. Power availability is measured over the calendar year (99.999% allows 5.26 minutes of outage a year, and the first credit band starts there; Pecan's single-feed 99.99% allows 52.6). The environmental commitment holds the cold aisle inlet inside the ASHRAE A1 recommended range, 64.4 to 80.6 °F, with credits per excursion longer than 10 minutes. Every MSA requires ten business days' notice of scheduled maintenance and one contracted feed kept energized during it.

## The documents (`docs/`)

These are written the way real operator records look. Tags are spelled differently from one system to the next. Units are mixed (kW, kVA, tons, amps with volts and phases). Notes are free text, retired assets are left in place, and the sources do not always agree.

| File | What it is |
|---|---|
| `equipment_register.csv` | Asset export from the CMMS. One row per asset: tag, class, make/model, rating as written on the nameplate, what feeds it, alternate source, system/side, location, status, notes. |
| `bms_points.json` | BACnet point table from the BMS (Siemens Desigo CC): the controllers and gateways, then one row per point with its designation, equipment, object type and instance, units, alarm limits and state text. Designations match the event log and trends. It covers the chillers, pumps, loop, CRAHs, cold aisles, UPSs, PDUs and switchboard meters, plus branch-circuit monitoring on the row D RPPs and on the installed spare breakers (no cord) on PDU-1A/1B and RPP-3B. Nameplate and topology are not point properties. A rating appears only where the integrator typed it into a description, and two of those labels disagree with the register (PDU 2B at 225 kVA, SWGR-B CB-1 at 1600 A). Each branch-circuit description names the cord it meters, or SPARE, and the breaker size. |
| `circuit_roster.csv` | The power roster kept by the site team. One row per cabinet cord: customer, cage, cabinet, cord side, panel, breaker position, breaker size, voltage, phase, contracted kW, measured cabinet kW and measured circuit kW. |
| `maximo_workorders.csv` | IBM Maximo Work Order Tracking list download (attribute names as headers, site-local times as Maximo prints them). DFW1 work orders reported since May 2025, the older ones the register and roster cite (WO-22-0418, MOP-0117, the 2024 RPP-5B install, the March 2025 RPP-3B IR scan), and the approved schedule for the week of Monday 2026-11-09. `ASSETNUM` is the register's `asset_id`, not a tag. |
| `contracts/*-msa.txt` | Master services agreement excerpts (service levels, credits, maintenance). |
| `contracts/*-order-form.txt` | Order forms (MRC, licensed cabinets, power and cooling redundancy, committed kW per cabinet). |
| `desigo_event_log_2026-05-01_2026-11-07.csv` | Siemens Desigo CC Log Viewer export from the BMS (`DFW1-BMS-01`): alarms with their acknowledge, return-to-normal and close records, status changes, and plant commands. |
| `desigo_trend_2026-08-22_2026-08-26.csv`, `desigo_trend_2026-11-01_2026-11-07.csv` | Desigo CC trend exports at 15-minute intervals for 25 points: outdoor air, chiller supply temperature and kW, loop supply and return, pump speed, CRAH supply air, cold aisles, UPS load. The first window covers the August heat event and the second the last full week. |
| `pme_event_history_2026-05-01_2026-11-07.csv` | Schneider EcoStruxure Power Monitoring Expert event history: utility sags and swells, open-transition interruptions, ATS transfers, generator, UPS (Eaton 9395P) and MCC feeder events. |
| `pme_data_export_2026-08-22_2026-08-26.csv`, `pme_data_export_2026-11-01_2026-11-07.csv` | PME Data Export - Extended at 15-minute intervals for the same two windows: mains kW and power factor, MCC feeder kW and current, UPS output kW, generator kW. |

## The upload bundle (`upload/`)

`upload/` is what an operator drags onto an empty Cascade: a copy of every CSV and JSON export above, plus the twelve contracts as the PDFs the provider sent. The provider is Blackland Colocation LLC, also fictional. Each PDF has a letterhead, a document number, a parties block, numbered clauses, the pricing and committed-power tables as real tables, and signature blocks. It states the same terms as its `.txt` excerpt. The one difference is Caddo's availability clause: the `.txt` wraps it across two lines, and the PDF states it in one sentence. The `.txt` files stay as the parsers' test fixtures.

## Operating history

The six BMS and PME exports are time-based records. Like the Maximo export, they never become facts about topology. A source name joins the model through the register: the last dot-separated part that is a register tag, or a tag plus a hyphenated suffix, names the entity (`DFW1.SWGR-A-MAIN` is SWGR-A and `DFW1.Bldg1.DH-1.CRAH-5.SAT` is CRAH-05). The outdoor air point names no register asset, so it is reported as unresolved.

**Formats.**

- **Desigo CC event log.** The columns are the Log Viewer defaults, plus Source Designation and Discipline ([Siemens Desigo CC help](https://gbscampus.vu.nl/WebApp/Help/EngineeringHelp/en-US/13024995595.html)). Times use en-US `MM/DD/YYYY HH:MM:SS` in site time. Record Type uses the values that help page lists (`Event`, `Activity`). Event State, Event Category, Event Cause (`To Offnormal`, `To Fault`, `To Normal`, `Status Changed`), Log Type, the designations and the alarm wording are modeled.
- **Desigo CC trend export.** Siemens does not publish this layout. It is modeled as long format: `Date/Time,Source Designation,Source Description,Value,Unit,Quality`.
- **PME event history.** The columns are modeled on the PME 2024 Alarms view: `ID,Source,Timestamp,Timestamp UTC,Event,Condition,Measurement,Value,Type,Priority`. Source is `Group.Device`, with ION9000 meters on the mains and PM8000 meters on the CB-3 feeders. Eaton event names follow the Sunbird plugin list. ATS events and the `Under Current` setpoint (below 25 A for 5 s at SWGR-A/B CB-3) are site-defined.
- **PME Data Export - Extended.** The columns are verbatim: `Timestamp UTC,Timestamp,Value,Source,Measurement,Unit`. Values are 15-minute snapshots.

Local times follow US Central. On 11/01 the 01:00 to 01:45 samples appear twice, and PME's UTC column tells them apart.

**Sourced.** The outdoor air trend in the August window is NOAA LCD hourly dry bulb at DFW Airport (`external/noaa_kdfw_lcd_*.csv`), interpolated to 15 minutes and moved from local standard time to site time. Two utility sags fall on the two highest ERCOT North Central load days outside the heat event, 2026-07-22 and 2026-08-18 (`external/ercot_np6-345-cd_*.csv`). The sags themselves are modeled. No real grid event is claimed.

**Lined up with Maximo.** Each monthly generator load run and ATS transfer test sits inside its work order's actual start and finish. Both UPS semi-annual maintenance-bypass windows do too, as do the CH-2 coil cleaning and CH-1 oil analysis chiller swaps, the CHWP-1 lube in July, and the CRAH filter changes. The CRAH-07 fan 2 fault is still active, as is its work order (WO-26-1259).

**The 2026-08-24 heat event.** KDFW reads 108 °F. CH-2's condenser coil is fouled, so CH-2 ran in condenser pressure limit on 08/23. On 08/24 it enters the limit again at 15:38 and trips on High Discharge Pressure at 16:04:12. The MCC-B feeder meter picks up Under Current at 16:04:18. The sequencer starts standby CH-3 at 16:06:08 and it runs from 16:06:51. Loop supply crosses its 50 °F limit at 16:07, peaks at 50.9 °F at 16:09:30 and is back below 49 °F by 16:19. The row C cold aisle peaks at 78.3 °F (78.0 °F in the 15-minute trend), below ASHRAE's recommended 80.6 °F. CH-2 is reset and running at 18:40, matching WO-26-0971's actual finish, and CH-3 returns to standby at 19:10.

**Modeled.** Everything else in the six exports is modeled. These are the assumptions behind it:

- **Chilled water.** The supply setpoint is 44 °F, per the register ("44F supply") and the BMS point table's 50 °F high limit on each chiller's supply and on the loop supply. The cold aisle points alarm outside 64.4 to 80.6 °F, the contracts' environmental range. Return runs about 10.6 °F above supply. Chiller capacity derates 0.7 % per °F above 95 °F ambient (Trane CG-SLB055). kW per ton is 1.15 x (1 + 0.017 x (ambient - 95)), never below 0.70. Until its 08/28 coil cleaning, CH-2 makes 80 % of rated capacity.
- **Losing a chiller.** When one of the two required chillers stops, loop supply heads toward 44 °F + 14 °F x (unloaded fraction), with 1.5 °F more above 100 °F ambient. It rises with a 2.5-minute lag and recovers with a 10-minute lag as a replacement loads.
- **Load.** IT load is the roster's measured kW with a 2.5 % afternoon swing. Cooling load is 1.08 x IT. The A/B split follows each cord's panel to its UPS (RPP-4B's cords land on UPS-A).
- **Open transitions.** The ASCO 7000s are open transition. Each transfer and retransfer interrupts that side for 0.15 to 0.33 s. The UPS rides through on battery, and running chillers on that MCC drop out on Momentary Power Loss and restart 150 to 200 s later.
- **November outdoor air.** NCEI publishes LCD about two weeks behind, so the file ends 2026-10-26 05:53 LST. The November outdoor air is a modeled diurnal curve, not an observation. Values for May events, before the NOAA file starts, assume 85 °F.

## Adding a second hall

The documents are keyed so a second hall can be added without renaming anything already in DH-1:

- **Hall and rows.** Name the hall DH-2. Continue the site-wide row letters from F, and keep cabinet tags in the same row-letter-plus-number form (F01, F02 and so on).
- **Register.** Add the hall's PDUs, RPPs and CRAHs as new register rows with new numbers (PDU-4A/4B and up, CRAH-09 and up), fed from new UPS output-board breakers.
- **Roster and contracts.** Add roster rows with `hall` set to DH2, and list the new cabinets in the customers' order forms.

## Ground truth

`ground_truth.json` sits next to this README, outside `docs/`. Accuracy tests use it, and the application must never load it.

`generate.ts` regenerates the documents, the upload bundle and the ground truth together, so line references cannot drift:

```sh
npx tsx seed/sites/dfw1/generate.ts
```

Edit the generator rather than the documents by hand.
