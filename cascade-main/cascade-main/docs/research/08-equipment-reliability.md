# 08 — Equipment Reliability Parameters (electrical distribution + centrifugal pumps)

**Scope:** failure rates, repair times, failure modes and distribution shapes for electrical distribution gear (transformers, breakers, switchgear, bus, motors, VFDs) and centrifugal pumps such as chilled-water pumps, for synthetic asset registers, maintenance records and any probabilistic extension of Cascade's what-if engine. **Researched:** 2026-11-07.

None of these populations are data-center-specific. They come from industrial, utility, offshore (OREDA), refinery and nuclear surveys. Cooling-plant rates from the US Army PREP data (chillers, CHW pumps, AHUs, cooling towers) are in `06-cooling-physics.md` P23–P34. Any synthetic records generated from these numbers must be labeled synthetic.

This file was trimmed from an earlier scan that also covered produced-water (oilfield) pumps. Those field studies, vendor case studies and well-pump precursor signals were dropped as oilfield-only; see "Dropped" at the end.

Confidence: **high** = I read the primary source or a document that reproduces it with a table or page citation. **medium** = a secondary source quotes the number. **low** = vendor claim, single anecdote, or my own derivation.

## Summary

- **Centrifugal pumps fail often; the electrical gear that feeds them fails rarely but stays down longer.** OREDA topside multistage centrifugal pumps: MTTF ≈ 2.9 yr for all failures. Refinery and petrochemical centrifugal pumps: MTBF 3–10 yr. Electrical distribution equipment runs at about 0.001–0.07 failures per unit-year, depending on the asset.
- **Repair time depends on whether a spare is on hand.** OREDA pump external-leakage repairs ≈ 42 h. Breakers take about 2 h to swap a spare versus about 83–129 h to repair. Transformers take a few hours (utility swap from stock) to about 174 h (industrial, IEEE survey) and up to 480 h (substation).
- **Mechanical seals are the main pump failure mode.** The most-cited figure is about 60–70% of pump failures. Bearings are the main motor failure mode, at about 41–51%.
- **Distributions.** At the assembly level, failure times are Weibull with β close to 1, so an exponential approximation is reasonable. Barringer's typical β is 1.2 for centrifugal pumps and AC motors, 1.1 for transformers and 1.5 for breakers. Repair times are conventionally lognormal (MIL-HDBK-472).
- **Biggest gaps.** I could not open the OREDA pump tables (licensed). I found no credible field failure rate for VFDs or MCCs.

**Conflict with `06-cooling-physics.md`.** The PREP data (TM 5-698-5) gives pumps λ = 0.0063/yr (all) and 0.0058/yr (centrifugal), i.e. MTBF on the order of 160 years, with MTTR ≈ 7 h. The OREDA figure here (MTTF 2.9 yr) and the refinery/ANSI figures (MTBF 1.5–10 yr) are one to two orders of magnitude worse. The populations, failure definitions and service conditions differ (building-services pumps vs. process pumps); I did not reconcile them. Pick one source deliberately and cite it.

## Parameter table

### A. Centrifugal pumps

| Parameter | Asset | Value / range | Units | Source | Confidence |
|---|---|---|---|---|---|
| MTTF, all failure modes | Topside multistage centrifugal pumps (OREDA, n=156, 3.24×10⁶ calendar h) | 2.9 (≈ 39 failures/10⁶ calendar h, derived) | years | Krish et al., ASME GT2015-42774, Table 3 and text, citing OREDA. https://energyrecovery.com/wp-content/uploads/2023/11/ASME_2015-Final-Paper_v2-PDF.pdf | medium (OREDA quoted by a third party; the per-10⁶ h conversion is mine) |
| MTTF excluding seals, gaskets and couplings | Same OREDA population | 8.9 | years | Same as above | medium |
| MTBF | Centrifugal pumps, US refineries and petrochemical plants | 3–10 (worked example 7.7: 1,200 pumps, 156 repairs/yr) | years | H. Bloch, *Pump User's Handbook*, as quoted by ReliaMag. https://reliamag.com/topics/guides/pump-reliability-mtbf-statistics | medium |
| MTBF | ANSI B73.1 process pumps | 1.5–2.0 poor; 2.5 average; 4.5 excellent | years | A. Budris (WaterWorld), as quoted by ReliaMag (same URL) | medium |
| Global failure rate | NGL centrifugal pumps, gas plant (seal-dominated) | 1.69×10⁻⁴ – 2.81×10⁻⁴ | failures/h | F. Vicente, ABB Service, "Reliability Analysis of Centrifugal Pumps System…", Table 4. https://library.e.abb.com/public/1356aa74240e5e4f85257789004b63ce/Reliability+Analysis+applied+on+centrifugal+pumps.pdf | high (case study) |
| MTTR | Same NGL pump system | 21 (system); 10 per seal repair | h | Same as above, Table 5 and cost section | high (case study) |
| Failure rate, reduced output | Large vertical centrifugal pump (nuclear/IAEA) | 1.4×10⁻⁵ (repair 12 h) | /h | IAEA 1988, quoted in Cadwallader, INEEL/EXT-98-00892 (1998), p.36. https://www.osti.gov/servlets/purl/752571 | medium |
| Failure rate, fail to run | Same | 4×10⁻⁶ (repair 15 h) | /h | Same as above | medium |
| Failure rate, external leakage | Same | 3.6×10⁻⁵ (repair 5 h) | /h | Same as above | medium |
| Repair time, external leakage | Pumps (OREDA 1992, p.185) | 41.6 mean; 146 bounding | h | OREDA 1992, quoted in INEEL/EXT-98-00892 p.36 | medium |
| Fail to start on demand | Pumps (OREDA 1992) | 2.5×10⁻² per demand; repair 12 h mean, 150 h upper bound | – | Same as above | medium |
| Weibull β / η, pump assembly | Centrifugal pumps | β 0.5 / **1.2** / 3; η 1,000 / **35,000** / 125,000 (low / typical / high) | –, h | Barringer & Associates Weibull Database (archived). https://web.archive.org/web/20151230001252/http://www.barringer1.com/wdbase.htm | high (database read directly; Barringer warns the values are generic) |
| Weibull β / η | Mechanical seals | β 0.8 / **1.4** / 4; η 3,000 / **25,000** / 50,000 | –, h | Barringer (same URL). The ABB/Vicente paper also cites β 1.4, η 25,000 h as typical for O&G | high |
| Weibull β / η (field) | Mechanical seals, NGL pumps (dry-running, unstable process) | β 0.84–1.13; η 4,866–6,513; MTTF 4,661–7,164 | –, h | Vicente/ABB, Tables 1 and 3 | high (case study) |
| Weibull β / η | Pump impellers | β 0.5 / 2.5 / 6; η 125,000 / 150,000 / 1,400,000 | –, h | Barringer | high |
| Weibull β / η | Pump wear rings | β 0.5 / 1.1 / 4; η 10,000 / 50,000 / 90,000 | –, h | Barringer | high |
| Weibull β / η | Pump shafts | β 0.8 / 1.2 / 3; η 50,000 / 50,000 / 300,000 | –, h | Barringer | high |
| Weibull β / η | Ball bearings; roller bearings | β 0.7 / 1.3 / 3.5; η 14,000 / 40,000 / 250,000 (ball); 9,000 / 50,000 / 125,000 (roller) | –, h | Barringer | high |
| Weibull β / η | Couplings | β 0.8 / 2 / 6; η 25,000 / 75,000 / 333,000 | –, h | Barringer | high |
| Seal life reference | API 682 design target | 25,000 (≈ 3 yr); suggested site seal MTBF ≈ 60 months (48 often accepted in midstream) | h / months | European Sealing Association 2025, as quoted by ReliaMag (pump MTBF URL above) | medium |

### B. Electrical distribution

| Parameter | Asset | Value / range | Units | Source | Confidence |
|---|---|---|---|---|---|
| Failure rate | Liquid-filled power transformer (industrial) | 0.0041 (1973-74 survey) – 0.0062 (1979 survey) | failures/unit-yr | IEEE 493 surveys, as quoted by ReliaMag. https://reliamag.com/topics/maintenance-and-reliability/electrical-equipment-failure-rate-benchmarks | medium |
| Failure rate | Pad-mounted distribution transformer (utility) | 2.0×10⁻³ – 4.73×10⁻³ (Table 3-5); Table 3-1 gives up to 4.5×10⁻² | failures/yr | EPRI 1001873, *A Review of the Reliability of Electric Distribution System Components*, 2001, Tables 3-1, 3-5. https://restservice.epri.com/publicdownload/000000000001001873/0/Product | high |
| Failure rate | Substation transformer | 1.5×10⁻² – 7.0×10⁻² | failures/yr | EPRI 1001873 Table 3-1 | high |
| Repair / replace time | Industrial transformer 601 V–15 kV | 174 | h | Heising 1974 (IEEE survey behind IEEE 493), via EPRI 1001873 Table B-2 | high |
| Repair / replace time | Pad-mounted transformer (utility, replace from stock) | 2.0–7.0 | h | EPRI 1001873 Table B-2 (Willis 2001, Volkmann 1991, Godfrey 1996) | high |
| Repair time | Substation power transformer | 15–480 | h | EPRI 1001873 Table B-2 (Willis 2001 low/high) | high |
| Repair time | Forced-air transformer | 132.4 | h | EPRI 1001873 Table B-2 (Hale 2000) | high |
| Failure rate | Metal-clad drawout circuit breaker | 0.0036 (58 failures / 16,280 unit-yr) | failures/unit-yr | IEEE 493-1980 Table 24, via Eaton AP083006EN, as quoted by ReliaMag (URL above) | medium |
| Failure rate | MV circuit breaker | 0.001 | failures/unit-yr | IEEE 493-1997 App. E Table I, quoted in Paoletti & Baier (Eaton/Cutler-Hammer), "Failure Contributors of MV Electrical Equipment…", IEEE 2002. http://pps2.com/PDF/Failure-Contributors-MV-Gear-IEEE-Nov2002.pdf | high (table and page cited) |
| Failure rate | Circuit breakers (utility distribution) | 2.0×10⁻⁴ – 3.6×10⁻² | failures/yr | EPRI 1001873 Table 3-1 | high |
| Downtime | Circuit breaker | ≈ 2 (replace with spare) vs ≈ 83 (repair) | h/failure | IEEE 493 breaker data, as quoted by ReliaMag | medium |
| Downtime | Circuit breaker, MV | 28 | h/failure | IEEE 493-1997 App. E Table I, via Paoletti & Baier | high |
| Repair time | Drawout breaker | 3.1 (Hale 2000) – 129 (Heising 1974) | h | EPRI 1001873 Table B-2 | high |
| Repair time | Circuit breakers (general) | 4–80 | h | EPRI 1001873 Table B-2 (Willis, Mok, Godfrey) | high |
| Failure rate | Switchgear bus | 0.015 | failures/unit-yr | IEEE 493-1997 App. K Table I p.388, via Paoletti & Baier | high |
| Downtime | Switchgear bus | 29 (IEEE 493); bare bus 17.3–27.3; insulated bus 261 | h/failure | Paoletti & Baier; EPRI 1001873 Table B-2 (Heising 1974, Hale 2000) | high |
| Failure rate | Busbars (utility) | 1.5×10⁻³ – 1.1×10⁻² | failures/yr | EPRI 1001873 Table 3-1 | high |
| Failure rate | Induction motors > 200 hp (industrial) | 0.0708 avg (≈ 8.1/10⁶ h, derived); 0.052–0.217 by speed/size class | failures/unit-yr | IEEE Motor Reliability Working Group, *IEEE Trans. IA*, 1985 Parts I-II, as quoted by ReliaMag. https://reliamag.com/topics/guides/electric-motor-failure-statistics | medium |
| Failure rate | Utility motors ≥ 100 hp | 0.031–0.035 | failures/unit-yr | EPRI EL-2678 (1982), as quoted by ReliaMag | medium |
| Failure rate | Motors with embedded thermal protection vs minimal protection | 0.0202 vs 0.0707 | failures/unit-yr | Thorsen & Dalva, *IEEE Trans. IA*, 1995, as quoted by ReliaMag | medium |
| Failure rate | Industrial motors, general | 3–5 %/yr (up to 12% in mining, pulp and paper) | %/yr | IEEE Houston Section motor-control seminar, 2016, slide 14. https://r5.ieee.org/houston/wp-content/uploads/sites/32/2016/09/IEEE-HOU-Sec-20160922-Motor-Control-Seminar2.pdf | medium (no underlying survey cited) |
| Downtime (median) | Motors > 200 hp | 8 (excellent maintenance) – 165 (fair maintenance) | h/failure | IEEE MRWG 1985, as quoted by ReliaMag | medium |
| Repair time | Pump motor, all modes (nuclear) | failure rate 1.6×10⁻⁵/h; repair 184 h | – | IAEA 1988 p.152, quoted in INEEL/EXT-98-00892 | medium |
| Repair time | Pump main motor (OREDA 1992) | 12 mean; 150 upper bound | h | OREDA 1992 p.185, quoted in INEEL/EXT-98-00892 | medium |
| Weibull β / η | AC motors | β 0.5 / 1.2 / 3; η 1,000 / 100,000 / 200,000 | –, h | Barringer (archived URL above) | high |
| Weibull β / η | Transformers | β 0.5 / 1.1 / 3; η 14,000 / 200,000 / 14,200,000 | –, h | Barringer | high |
| Weibull β / η | Circuit breakers | β 0.5 / 1.5 / 3; η 67,000 / 100,000 / 1,400,000 | –, h | Barringer | high |
| MTBF, fleet | TMEIC MV drives (VFD) | 15.8 (derated) – 19.7 (raw) | years | Westech/TMEIC article, EnergyNow 2020. https://energynow.ca/2020/06/guide-to-variable-frequency-drive-reliability-and-how-to-compare-them/ | low (vendor) |
| MTBF, FIT-predicted | Hypothetical MV drive (thyristor + SGCT) | 17,737 h (≈ 2 yr) | h | Same article (shown as an example of pessimistic prediction) | low |
| Failure rate | MCC / motor starters | **not found** in a verifiable source | – | – | – |

UPS, ATS and generator failure *shares* within data center power outages (not per-unit rates) are in `01-outage-evidence.md` §1.

## Failure-mode notes

**Centrifugal pumps**
- OREDA failure-mode vocabulary for centrifugal pumps (ISO 14224 style), useful as a `failure_mode` enum: abnormal instrument reading, breakdown, erratic output, structural deficiency, vibration, external leakage (process / utility medium), fail to start on demand, noise, high output, low output, overheating, parameter deviation, spurious stop (ASME GT2015-42774 Table 1). "Low output" fits pump degradation; "breakdown / spurious stop / fail to start" fit pump failure.
- **Seals dominate.** Removing seal, gasket and coupling failures from the OREDA pump data raises MTTF from 2.9 to 8.9 yr. That implies those items cause ≈ 67% of failures (my derivation; medium/low). The European Sealing Association (2025, via ReliaMag) records seals at 60.4% of 3,500 pump failures across 18 end users. Root causes of premature seal failure: operations 49%, maintenance 28%, engineering 23%. Industry estimate: seal-related work is 60–70% of centrifugal pump maintenance (secondary).
- **Bearings** (NASA RCM Guide 2008, §5.5.2.1, citing Conyers 2003): poor lubrication 36%, fatigue 34%, poor installation 16%, contamination 14% of premature bearing failures. Only 10–20% of rolling bearings reach design life. https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf
- I found no sourced percentage for cavitation's share in field data. A test-rig thesis (Chittora, DiVA) attributes about 25% of pump and seal failures to cavitation, but that is lab data (low).

**Motors** (cause shares, via ReliaMag; medium)

| Study | Bearings | Stator / windings | Rotor | Other |
|---|---|---|---|---|
| EPRI EL-2678, 1982 (utility, ≥ 100 hp) | 41% | 36% | 9% | 14% |
| IEEE-IAS MRWG, 1985 (industrial, > 200 hp) | 44% | 26% | 8% | 22% |
| Thorsen & Dalva, 1995 (offshore / petrochem / refinery) | ~51% | ~16% | small | ~15–16% external |

IEEE Houston 2016 seminar uses a different grouping: electrical 33%, mechanical 31%, environmental / maintenance / other 36%.

**Switchgear and breakers** (IEEE 493-1997 via Paoletti & Baier; high)
- Combined switchgear failure-contributing causes: exposure to moisture 17.7%, dust and contaminants 11.4%, normal deterioration from age 9.8%. Insulated bus alone: moisture 30%. Bare bus alone: dust 19%.
- MV breakers, normalized across 601 V–138 kV: lubricant loss 18%, lack of preventive maintenance 18%, persistent overload 12.5%, age 11%, other 40.5%.
- About 22% of causes are addressable by partial-discharge monitoring and about 12% by IR thermography.

**Transformers** (EPRI 1001873, citing Allan 1995): a CIGRE survey found windings 29% and terminals 29%. A US survey found external corrosion, aging and insulating oil together at 37%. Aging effect for pad-mount units over 10→30 yr ranges widely across sources: +6% to ×125.

**VFDs.** Electrolytic DC-bus capacitors and cooling fans are the wear items. ABB's rule: a 10 °C rise halves capacitor life (hardware manual, secondary). Yang et al. (*IEEE Trans. IA* 47(3), 2011) survey of power-electronic converters ranks power semiconductors as the most fragile part. I could not access a percentage breakdown.

## Precursor signals (degradation vs. failure)

| Signal | What it indicates | Lead time | Source | Confidence |
|---|---|---|---|---|
| Narrowband vibration (bearing defect frequencies, imbalance, misalignment, cavitation, flow turbulence) | Mechanical degradation | "several weeks or months" | NASA RCM Guide 2008 §6.3.1.2 (vibration monitoring). §4 adds: once the alert level is crossed, cut the monitoring interval to ⅓–¼ | high (guidance, not measured) |
| Electrical (IR thermography, MCSA, insulation, PD) | Connection, insulation and winding degradation in switchgear and motors | "several weeks to several years" (technology-dependent) | NASA RCM Guide §6.7.3.3 | high (guidance) |
| Lubrication degradation / misalignment / bearing outer race / insulation | Per failure mode | 3–12 mo / 1–3 mo / ~3–6 mo / weeks–years. Cage failures: hours (high speed) | ReliaMag, "Early Failure Detection" (no primary cited). https://reliamag.com/topics/articles/early-failure-detection | low |
| Combined vibration + stator current | Off-design operation and cavitation detection (lab) | n/a | Han et al., *Sensors* 2024 | medium (lab) |

Modeling implication (my inference, low): for synthetic telemetry, give mechanical pump failures (bearing, seal wear, impeller and wear-ring wear) a gradual pre-failure ramp lasting days to weeks. Effective output (flow and discharge pressure) drifts down, and vibration and motor current change before the stop. Give electrical faults (breaker trip, transformer fault, VFD trip) no telemetry precursor at coarse (minutes) resolution: the equipment stops abruptly. Cooling-specific event signatures (pump failure, degradation, chiller trip, leak, sensor fault) are in `06-cooling-physics.md` §5.

## Distribution-shape guidance

- **Failure times.** Use a Weibull. At the assembly level, typical β is near 1: pumps 1.2, AC motors 1.2, transformers 1.1, breakers 1.5 (Barringer). An exponential (β = 1) is therefore a defensible simplification for pump, motor and transformer assemblies. Wear-out components (seals β 1.4, impellers β 2.5, couplings β 2) should use Weibull with β > 1 if they are modeled separately. NASA RCM Guide (Fig. 4-5; UAL 1968, Bromberg 1973, US Navy 1982): 77–92% of failures are random (age-independent) and only 8–23% are age-related.
- **Repair times.** Use a lognormal. MIL-HDBK-472 (1966/1984) prediction methods assume lognormal corrective repair times, and Kline, *Reliability Engineering* 9(2):65-80, 1984 assessed that assumption (secondary references only: https://reliabilityanalyticstoolkit.appspot.com/maintainability_analysis, https://www.jseepub.com/EN/Y2019/V30/I6/1260). Right-skewed with a long tail, which is consistent with OREDA's 41.6 h mean / 146 h bounding repair.
- **Mixture to model.** Downtime depends on whether a spare is available: breaker swap ≈ 2 h vs repair ≈ 83 h, and utility transformer swap 2–7 h vs industrial repair 174 h. A Bernoulli(spare available) choice feeding two lognormals reproduces this.
- I found no published lognormal σ for pump or electrical repair times. Any σ we choose is our own assumption.

## Suggested synthetic defaults (derived from the table, all low confidence, label as assumptions)

| Asset | TTF distribution | Repair-time distribution |
|---|---|---|
| Centrifugal pump | Weibull β ≈ 1.2, η chosen to give MTBF ≈ 0.5–3 yr. The original range ran from oilfield "bad-actor" pumps (3–6 months, sources dropped) to OREDA-like; for building-services pumps see the PREP conflict above | Lognormal, median ≈ 10–30 h, long tail to ~150 h |
| Pump motor | Weibull β ≈ 1.2, rate ≈ 0.03–0.07/yr | Lognormal, median 8–24 h; tail to ~165–184 h (rewind or replace) |
| Pad-mount / distribution transformer | Exponential, rate ≈ 0.002–0.006/yr | Mixture: 2–7 h (spare) or ~174 h (repair or replace, no spare) |
| MV breaker / switchgear | Exponential (β 1.5 optional), rate ≈ 0.001–0.016/yr | Mixture: ~2 h (spare) or ~28–129 h |
| VFD | Exponential, MTBF ≈ 2–20 yr (very weakly sourced) | No source found; treat as an assumption |

## Open gaps

1. **OREDA pump tables.** I did not see the per-failure-mode critical/degraded rates (per 10⁶ h) or the mean active repair / man-hours for centrifugal pumps. OREDA is licensed. A participant copy, or the Hadaoui UiO thesis (2016, 2,047 failures on 796 OREDA pumps, https://hdl.handle.net/10852/42376, not opened), would fill this. The pump figures I have are a third-party OREDA summary (MTTF 2.9 yr) and 1992 repair times via INEEL.
2. **IEEE 493 tables.** I did not read the Gold Book directly. Values come through Eaton/Paoletti (table and page cited) and ReliaMag. Motor starters, MCCs, cables and the full 1974 survey table are still unverified. IEEE 493-2007 is now inactive-reserved, and IEEE 3006.8-2018 is the current recommended practice.
3. **VFD and MCC field failure rates.** The only VFD data is vendor fleet MTBF (TMEIC). No independent field survey was found.
4. **Precursor lead times.** No peer-reviewed field study gives days-ahead detection for surface centrifugal pumps. What exists is NASA guidance ("weeks to months") and trade articles.
5. **Lognormal σ** for repair times: no published values found.
6. **NERC / utility data.** I did not pursue NERC GADS. It covers generating units, not on-site distribution, and is unlikely to fit.
7. **No UPS, ATS, PDU or generator per-unit failure rates** were collected in this scan.

## Dropped (oilfield-only)

Removed from the earlier version of this file: produced-water reinjection pump field data (Petroamazonas Block 18, Chávez-Cadena et al. 2020: MTBF, Weibull fits, MTTR, availability, lognormal repair-time confirmation); produced-water booster pump, water-injection seal and saltwater-disposal horizontal pump vendor case studies (Westpower, AESSEAL CS0129, SLB East Texas); a Colombian water-injection pump thesis; electric-submersible (well) pump precursor sources (US patent 10,962,968, SPE 214462); positive-displacement disposal-pump gaps.
