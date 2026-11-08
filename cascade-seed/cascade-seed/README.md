# Cascade seed pack (Phase 0, done)

Everything the blueprint's Phase 0 asked for. The golden outputs come from the real GnuCOBOL 3.1.2 compiler.

## What's here
| Path | What |
|---|---|
| `legacy/LEASEBIL.cbl` | COBOL billing: base rent with escalation, CAM, base-year stop, cap, SLA credit. Reads COOLFLAG.DAT |
| `legacy/CAMCALC.cbl` | Called subprogram for the pro rata CAM share |
| `legacy/LEASECPY.cpy` | Shared lease record layout (COMP-3 + REDEFINES) |
| `legacy/INVBATCH.jcl` | Nightly job at 01:00 |
| `legacy/schema.sql` | Property DB with the work order trigger that grants badge access |
| `legacy/bms_config.json` | Chillers (2 of 3 required), UPS panels, CRAH units, points (one x10, one in °F), BMSEXP job at 02:00 |
| `legacy/access_export.csv` | Doors and controllers (Data Hall A door hangs off the BMS switch) |
| `leases/*.txt` | 6 tenant lease excerpts (Northwind amendment, Acme 99.99% SLA, etc.) |
| `golden/parity_cases.json` / `.csv` | **47 cases run through the real COBOL**: 7 tenants, 18 edge cases, 6 half-cent boundaries, 4 CAM truncation, 12 random |
| `golden/ground_truth.json` | The 10 planted dependencies (D1-D10) with exact file + line + snippet, 3 decoys, 5 findings |
| `reference/leasebil.ts` | TypeScript port, BigInt fixed-point. **47/47 byte-for-byte parity** |
| `reference/naive.ts` | A typical float translation. **11/47**. Use it in the demo to show parity catching bugs |
| `seed_portfolio.json` | **One file for Leap's seedPortfolio**: properties, source files, 33 nodes, 38 edges, lease terms, telemetry points, incident script, ground truth, findings, parity cases |
| `tools/` | Scripts that regenerate everything |

## Numbers to say out loud (all verified)
- **F1 Northwind base year:** code bills $1,503.33/mo of OPEX, the lease says $922.50, so **$580.83/mo, $6,969.96/yr** overcharge (golden case T01).
- **F2 Northwind CAM denominator:** CAMCALC divides by occupied SF; the lease says total SF. $3,784.60 billed vs $3,280.00, so **$504.60/mo, $6,055.20/yr** more. Bonus finding not in the blueprint.
- **F3:** invoice fields can't print $1,000,000 or more. COBOL drops the leading digit (`,926,335.84`, case E12).
- **F4:** CAM is truncated, not rounded (COMPUTE without ROUNDED).
- **F5:** the two-digit year window pivots at 50.
- **Parity:** naive port 11/47, verified port 47/47.

## Where the 10 dependencies live
| ID | Edge | Evidence |
|---|---|---|
| D1 | LEASEBIL → COOLFLAG.DAT | LEASEBIL.cbl:16, :180 |
| D2 | BMSEXP → COOLFLAG.DAT | bms_config.json:41, INVBATCH.jcl:11 |
| D3 | CAMCALC ↔ LEASECPY | CAMCALC.cbl:12, LEASEBIL.cbl:46 |
| D4 | LEASEBIL vs Northwind lease | LEASEBIL.cbl:51, northwind.txt:13 |
| D5 | work_orders → badge DC-HALL-A | schema.sql:79, :74 |
| D6 | CHW loop → UPS-B | bms_config.json:22 |
| D7 | CRAH-4 → UPS-B | bms_config.json:28 |
| D8 | Hall A door → BMS-SW-02 | access_export.csv:5 |
| D9 | Acme SLA → CHW loop | acme.txt:5-6 |
| D10 | INVBATCH 01:00 before BMSEXP 02:00 | INVBATCH.jcl:5, bms_config.json:40 |

Decoys: COOLFLAG.BAK (commented-out JCL), CH-3B label on UPS-B (spare breaker), v_coolflag_history view.

## Regenerate
```bash
sudo apt install gnucobol            # or: docker run -it --rm -v $PWD:/w -w /w olegkunitsyn/gnucobol:3.1
python3 tools/make_golden.py         # runs the real COBOL
python3 tools/make_ground_truth.py   # line numbers recomputed from the files
python3 tools/make_seed.py           # rebuilds seed_portfolio.json
node --experimental-strip-types reference/parity.ts   # expect 47/47
```

## Using it in Leap
Don't paste 63 KB into the prompt. Add `seed_portfolio.json` to the repo, or tell Leap: "seedPortfolio reads seed_portfolio.json from the repo root; the tables match its top-level keys." Copy `reference/leasebil.ts` into the backend as the known-good replacement the Validate stage scores against.
