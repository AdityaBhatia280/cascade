# Cascade research

**Scope:** the research behind Cascade's data center direction: building a power and cooling dependency model from operators' documents, auditing A/B and N+1 redundancy, simulating failures and maintenance, pricing customer revenue exposed, and planning fixes behind an approval gate. **Researched:** 2026-11-07/08.

Every file cites URLs for its claims and keeps sourced fact separate from inference. Labels differ by file (`[Inference]`, `[INFERENCE]`, `[inferred]`, H/M/L, high/medium/low, [P]/[S]/[V], Verified/Corrected); each file defines its own at the top. Dates are as originally researched.

## Files

| File | Question it answers |
|---|---|
| `01-outage-evidence.md` | Is the pain real? Causes and costs of data center outages, and public incidents where documented redundancy turned out to be false |
| `02-competitors.md` | Who already sells this? DCIM, digital-twin, AI-ops, CMMS and industrial-agent vendors, and where the white space is |
| `03-buyers-and-workflow.md` | How is maintenance risk handled today (MOPs, change control, standards), what do colo SLAs say, who buys, which segment first, and which alarm/HMI/automation standards apply to an operator tool |
| `04-why-now.md` | Why it matters more now: AI rack density, liquid cooling, power constraints, retrofits, regulation, funding |
| `05-cbre-insights.md` | What CBRE's own 2025–26 data center publications say (quotes re-verified), and what CBRE claims for Smart FM |
| `06-cooling-physics.md` | What happens when cooling fails: rise rates, ASHRAE limits, chiller/pump/CRAH reliability and restart times, mitigation costs, SLA terms, a heat model |
| `07-fragmented-sources-and-entity-resolution.md` | Which data silos and open standards (Brick, Haystack, 223P, RealEstateCore, OSCRE, Green Button) describe a facility, and how to resolve one asset's different IDs across them |
| `08-equipment-reliability.md` | What failure rates, repair times and failure modes to assume for electrical distribution gear and centrifugal pumps |
| `09-maintenance-workforce-and-work-orders.md` | What maintenance labor costs, how fast FM contracts require a response, which electrical-work rules apply, and what a CMMS asset/work-order record looks like |
| `10-sponsor-tracks.md` | What the HackUTD 2026 CBRE and NVIDIA tracks ask for, how judging works, and what past winners did |
| `11-nemotron-integration.md` | How to run Cascade's tool-using agent on Nemotron: models, hosting, tool-calling quirks, frameworks, reliability, cost |
| `12-prior-work-and-evaluation.md` | What prior work exists on maintenance scheduling and LLM agents for industrial operations, and how to evaluate Cascade's agent and planner |

## What we concluded

**The pain is real but procedural.** Uptime Institute data puts power as the top cause of serious outages and finds most major human-error outages involve procedures not followed or flawed. Several public incidents (Alibaba's standby chillers on a shared loop, Delta's servers without backup power, GleSYS on one UPS mid-maintenance) are cases of redundancy that existed only on paper (`01`). No public statistic gives the share of outages that happen during planned maintenance (`01`).

**The simulator is not the moat.** Sunbird, Nlyte, Schneider and others already sell failover and maintenance-impact simulation. What is open: building and maintaining the dependency model automatically from the documents operators already have, and pricing exposure against customer contracts (`02`).

**Frame dollars as revenue exposed, not credits owed.** Colo power SLAs usually pay only when both A and B feeds fail and often exclude scheduled maintenance (`03`). Temperature SLAs often have no "both feeds" analogue (`03`, marked inference there; terms in `06`).

**Lead with planned change in live facilities.** CBRE recommends tracking "the levels of redundancy available at every stage of the project" and a cause-and-effect matrix per SLA, including "an uptime commitment for redundant power (A+B power)" — the artifacts Cascade's what-if engine can compute (`05`).

**Cooling failures give minutes; repairs take hours.** Total cooling loss crosses the ASHRAE A1 allowable limit within minutes, and even a 10% deficit reaches it in about 35 minutes in a modeled hall (our derived arithmetic), while chiller repairs average about 12.6 hours (`06`). AI racks shrink thermal ride-through further, from minutes to seconds (`04`). Dependencies have to be known before the failure.

**The document model needs extension classes and entity resolution.** Brick v1.5.0 has no UPS or PDU class, no standard models SLA clauses, and BMS point names are inconsistently applied, so one asset carries a different ID in every system (`07`). Mapped, OpenDrawing.ai and Drawer AI show that AI parsing of BMS points and drawings is commoditizing; the moat would be a validated ontology plus a reconciliation workflow, not parsing (`02`).

**Keep the LLM on orchestration, not arithmetic.** Agent benchmarks (ITBench, τ-bench, AssetOpsBench) show LLM agents are unreliable end to end; the literature supports an LLM in a loop with deterministic verifiers and a code-enforced approval gate (`11`, `12`). Alarm and HMI standards argue for a calm 2D primary view with 3D as a secondary or briefing view (`03` §7).

## Open questions to test with real people

Not established by any source:

- Is mid-size multi-tenant colo the right first segment, given growth is concentrated in hyperscale and AI (`05` §10)? Alternatives: retrofit portfolios, outsourced operators such as CBRE Data Center Solutions, investors doing due diligence on existing assets (`05` §5).
- Will operators pay for model building and upkeep, or only for the simulation they already get from DCIM (`02`)?
- How accurate is Cascade on a real operator's documents? The DFW1 seed result (8/8 planted defects) measures internal consistency only.
- How long does MOP review take today, who signs, and in which tools (Word, SharePoint, CMMS)? No practitioner threads were found (`03` gaps).
- Do Schneider's tenant impact or Sunbird's colo features already attach contract or SLA metadata, and do large colos (Equinix, Digital Realty) have internal SLA-exposure tooling that makes them non-buyers (`02` §6)?

## Target tracks

CBRE ("Predict Before It Spreads") and NorthMark (NMC²); NVIDIA ("Use Nemotron Beyond a Chatbot") undecided. CBRE's prompt names data centers, hidden dependencies, tenant SLAs and cascading power outages explicitly. No NMC² track text was captured in this research; the only related evidence is a 2025 data-center technician copilot that won NVIDIA + Northmark. See `10-sponsor-tracks.md`.

## What was removed

An earlier oilfield project contributed several files to this folder. Its oilfield-only material (produced-water economics and logistics, well and trucking operations, the oilfield sponsor track, a design draft that no longer exists) was dropped in this consolidation. Each trimmed file (`08`, `09`, `10`, `12`) ends with a "Dropped" note listing what was removed.
