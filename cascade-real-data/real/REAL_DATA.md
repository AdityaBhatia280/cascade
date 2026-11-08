# Cascade: real data pack

Everything here is real and public. Use it to answer "would this work on real systems?"

## 1. Real legacy COBOL: AWS CardDemo
- Source: github.com/aws-samples/aws-mainframe-modernization-carddemo (Apache 2.0). A real mainframe credit card app AWS publishes for modernization testing.
- We ran Cascade's dependency extractor over it: **31 COBOL programs, 20,650 lines, 30 copybooks, 38 JCL jobs → 224 nodes, 732 edges, every edge with file + line** (`carddemo_graph.json`).
- What it surfaces:
  - Copybook `CVACT03Y` (card cross-reference layout) is compiled into **12 programs**. Change it and 12 programs break.
  - Dataset `CARDXREF.VSAM.KSDS` is touched by **7 different JCL jobs**. `TRANSACT.VSAM.KSDS` is touched by 7 too.
  - 16 CICS XCTL hand-offs between screens, 30 CALLs, 51 CICS file reads/writes.
- Caveat for judges: CardDemo is CICS online code, so we show the graph and explanations only, not parity. Parity runs on our LEASEBIL program, which compiles under GnuCOBOL.

## 2. Real building telemetry: detector validation
- Source: Building Data Genome Project 2 (Miller et al., *Scientific Data*, 2020). 10 real office buildings at one site (coordinates in the Phoenix area), hourly chilled-water meters, 2016-2017: **175,109 building-hours**.
- Same detector rules as the app (EWMA baseline on hour-of-week residuals, |z| > 3 for 3 consecutive samples, flatline = sensor fault):
  - **92 alerts total = 0.38 alerts per building per month.** That's quiet enough that operators won't ignore it.
  - **14 real stuck-meter periods** (13 in one building) routed to maintenance notices, **not** false incidents.
  - It does not flag single-hour blips by design. When we tried flagging them, noisy buildings produced hundreds of alerts a month.
- File: `bdg2_detector_validation.json`

## 3. Real incidents (for the opening)
- **Equinix Singapore, Oct 14 2023.** During a planned upgrade, a contractor "incorrectly sent a signal to close the valves from the chilled water buffer tanks." Halls overheated, and DBS and Citibank went down for about two days. **2.5 million payment/ATM transactions and 810,000 access attempts failed.** MAS penalized DBS (including a 1.8x operational-risk capital multiplier) because backup sites failed to take over. (DCD; The Register)
- **Google Cloud London (europe-west2), Jul 19 2022.** On a 40°C day, a "simultaneous failure of multiple, redundant cooling systems" forced a partial shutdown. A routing mistake then spread it to all 3 zones. Oracle and an NHS trust went down the same day. (DCD; Google incident report)
- Both stories show Cascade's point: **redundancy on paper is not redundancy in practice, and the damage spreads through connections nobody mapped.**

## 4. Real SLA terms (validates our numbers)
- A published Equinix colocation SLA (resold by Verizon) defines temperature as unavailable **below 18°C or above 27°C (80.6°F)**, with a **99.99% target = under 52 minutes a year per cabinet**. That's the same 27°C limit and 99.99% target Cascade uses for Acme Cloud.
- Real credit mechanics in that SLA: 1/30th of the monthly recurring charge per breach, plus 1/30th per extra full hour, capped at one month's charge, claimed in writing within 14 days.

## 5. Real cost of downtime
- ITIC 2024 survey: one hour of downtime costs **over $300,000 for more than 90%** of mid-size and large enterprises.

## Datasets to download by hand (blocked from our build machine)
- ASHRAE RP-1043 chiller faults (90-ton centrifugal chiller, 8 fault types): https://figshare.com/articles/dataset/Chiller_operation_data_set/28435232
- LBNL labeled HVAC fault datasets: https://faultdetection.lbl.gov/data
Drop them in `seed/real/` and the detector can be replayed on them.
