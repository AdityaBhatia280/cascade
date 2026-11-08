i# Cascade: Project Blueprint (HackUTD 2026)

Nov 7, 2026 · @Victor

## Concept and track fit

Cascade is an agent that reads a legacy real estate software stack, finds the dependencies nobody documented, predicts what breaks when one part fails, and acts after a human approves.

One demo serves three tracks: a COBOL lease-billing system and a data center cooling loop turn out to be connected, and the agent proves it, prices it, and fixes it.

| Track | What the judges asked for | What Cascade shows live |
| --- | --- | --- |
| 8090 | Agents and tools that make legacy software easier to understand, improve, or replace | COBOL billing code explained, rewritten in TypeScript, and scored for parity against real compiler output; a code-versus-lease billing bug with a dollar figure |
| CBRE | Connect fragmented real estate data to predict cascades, quantify impact, and act before disruption spreads | A telemetry anomaly triggers a predicted cascade with minutes to impact, tenants hit, and SLA credit dollars, then an email, a calendar invite, and a briefing call |
| NVIDIA | Nemotron beyond a chatbot: multi-step workflows, tool use, real-world fit | A planner loop with typed tool calls, a visible step trace, replanning on failure, and a human approval gate |

**Pitch.** "Medicare lost $28.8B in improper payments to code nobody fully understands. Cascade finds what is hidden between systems, prices the risk, acts before it spreads, and writes a verified replacement." The $28.8B figure comes from the 8090 track brief.

**Use 8090's vocabulary.** 8090 describes its Software Factory as Refinery, Foundry, Planner, Assembler, and Validator, with an audit trail from intent to code. Name the agent's five stages Refine (understand the legacy rules), Map (dependency graph), Plan (cascade and remediation plan), Assemble (generated code and tests), and Validate (parity and accuracy), and keep an audit log of every decision.

## Scope and priorities

Build every P0 item first; cut from the bottom of the table upward, never the other way.

| Tier | Item | Why it is here |
| --- | --- | --- |
| P0 | Seeded legacy portfolio (COBOL, SQL, BMS JSON, access CSV, leases) with 10 planted dependencies | Everything else reads it |
| P0 | Dependency graph where every edge cites a file and line | The core CBRE and 8090 claim |
| P0 | Deterministic cascade simulation with redundancy, delays, and SLA credit math | Produces the number the demo lands on |
| P0 | Live telemetry stream whose anomaly detector triggers the agent unprompted | Moves past passive visualization |
| P0 | Nemotron planner with typed tool calls, visible trace, and approval gate | The NVIDIA requirement |
| P0 | Parity check against output captured from the real GnuCOBOL compiler | The 8090 credibility point |
| P0 | Billing finding: code base year conflicts with the lease amendment ($6,970 per year) | The improper-payments tie-in |
| P1 | Two actions that really fire: email via Resend and a calendar invite file | Delivers "execute direct solutions" |
| P1 | Briefing call through Retell's browser web call | The memorable demo moment |
| P1 | TypeScript replacement plus generated characterization tests | Closes the modernization loop |
| P1 | Risk ranking, KPI strip, and extraction accuracy panel (found X of 10) | Answers "how do you know it is right" |
| P2 | Replay of the ASHRAE RP-1043 chiller data through the anomaly detector | Real-data credibility |
| P2 | CardDemo analysis tab (graph and explanations only) | Shows it works beyond our seed data |
| Cut | Login, multi-user, file upload UI, model training, contacting real tenants | No demo value in a hackathon |

Anomaly detection stays statistical (no model training); the RP-1043 replay validates it offline.

## Platform constraints found in research

Eight constraints change how we build; the sharpest are Resend's recipient limit, the missing COBOL runtime, and Nemotron's free-tier rate limit.

| Area | What we found | What we do about it |
| --- | --- | --- |
| Leap | Builds an Encore.ts backend with a React and TypeScript frontend, keeps API keys as Encore secrets set in the Infrastructure tab, supports streaming endpoints, and deploys from a button ([Leap docs](https://docs.leap.new/getting-started/quickstart.md); [conventions, third-party writeup](https://www.mintlify.com/x1xhlol/system-prompts-and-models-of-ai-tools/commercial/leap), unofficial) | Name secrets NvidiaApiKey, ResendApiKey, RetellApiKey. Use a streaming endpoint for the agent trace. Give every endpoint a unique name. Verify the conventions in the Leap UI |
| COBOL runtime | The backend is TypeScript, so a COBOL compiler is probably unavailable there (our assumption, untested). GnuCOBOL runs in [Docker](https://marketplace.visualstudio.com/items?itemName=OlegKunitsyn.gnucobol-debug) or compiled to WebAssembly in the browser ([LiveCodes](https://dev.livecodes.io/docs/languages/cobol-wasm)) | Compile and run the COBOL once on a laptop, commit the input and output table as golden data plus the script. The app compares the TypeScript against it. A live WebAssembly run is a stretch goal |
| Nemotron | OpenAI-compatible endpoint at integrate.api.nvidia.com/v1. NVIDIA docs list nvidia/nemotron-3-super-120b-a12b (131,072-token context) and a smaller nvidia/nemotron-3-nano-30b-a3b ([NVIDIA](https://docs.nvidia.com/nemoclaw/latest/reference/inference-profiles.html)). Free tier is about 40 requests per minute per model ([genblaze](https://pypi.org/project/genblaze-nvidia/)). One integration guide says JSON output is not enforced on some NIM versions ([h2o](https://docs.h2o.ai/enterprise-h2ogpte/guide/models-section/nvidia-nim-llms)) | Keep model names in config constants. Planner on Super, bulk extraction on Nano to split the rate limit. Stay under 20 model calls per incident. Validate every JSON output and retry once. Cache a full run for replay |
| Resend | From onboarding@resend.dev it delivers only to the account owner's own email and returns 403 otherwise; free tier is reported at 100 emails a day ([Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). Domain verification can take hours | Send every demo email to one team inbox and show the simulated tenant address in the UI. Do not plan on a verified domain |
| Retell | Outbound phone calls need a purchased or imported number; Test Web Call needs none; $10 free credit reported ([Retell docs](https://docs.retellai.com/deploy/outbound-call.md); [pricing summary](https://www.toolworthy.ai/en/tool/retell-ai)). Bring-your-own-LLM over websocket exists | Demo with a browser web call that receives incident context as dynamic variables; keep a simulated call screen as fallback. Nemotron inside the voice loop is P2 |
| Calendar | Google Calendar needs OAuth setup | Generate an .ics invite and attach it to the Resend email: same visible result, no OAuth (our recommendation) |
| 8090 | The Software Factory is organized around requirements, architecture, task planning, validation, and an audit trail with human-led oversight ([profile](https://yespress.io/8090-solutions); [overview](https://www.beri.net/tools/8090-software-factory)) | Mirror those stages; make the audit log and approval gate prominent |
| Leap plan | Leap's credit or prompt limits are unknown to us | Check before starting; the phased prompts below assume 5 to 8 generations |

## Architecture

Nemotron decides what to do, but code produces every fact, number, and verification.

&#91;embedded content: architecture · 4 layers, LLM only in the agent layer\]

Data flows down the layers; the agent calls the engines as tools, and nothing reaches the outside world without passing the approval gate.

## Data model and API

Keep the schema small; the trace and audit tables are what the judges will look at.

| Table | Key fields |
| --- | --- |
| source\_files | id, path, kind (cobol, copybook, sql, bms, access, lease), content |
| nodes | id, type (system, module, tenant, lease, utility, sensor, sla), name, aliases, k\_required, n\_total, capacity\_kw, monthly\_fee\_usd, sla\_target\_pct, risk\_score |
| edges | id, from, to, kind (reads, feeds, powers, cools, bills, grants), delay\_min, weight, confidence, evidence\_file, evidence\_line, verified |
| lease\_terms | tenant\_id, base\_year, cap\_type, cap\_pct, pro\_rata\_pct, gross\_up, sla\_credit\_schedule, amendment\_ref |
| telemetry\_points | id, node\_id, name, unit, scale, expected\_min, expected\_max |
| telemetry\_readings | point\_id, ts, value, quality (ok, stale, suspect) |
| anomalies | id, point\_id, ts, kind (threshold, trend, sensor\_fault), severity, incident\_id |
| incidents | id, root\_node, status, predicted\_timeline (json) |
| simulations | id, incident\_id, root\_node, steps (json), total\_usd, assumptions (json) |
| impacts | simulation\_id, node\_id, t\_min, state, usd |
| findings | id, kind (billing\_discrepancy, hidden\_dependency, hardcoded\_value), evidence, usd\_per\_year |
| agent\_runs | id, incident\_id, status, started\_at |
| agent\_steps | run\_id, idx, stage, tool, args, result\_summary, status, latency\_ms, model |
| actions | id, run\_id, tool, args, requires\_approval, approved\_by, status, result |
| parity\_cases | id, input, expected\_output (captured from real COBOL) |
| parity\_results | run\_id, case\_id, actual\_output, pass |
| ground\_truth\_edges | from, to, kind (feeds the accuracy panel) |

| Endpoint (unique names) | Purpose |
| --- | --- |
| seedPortfolio | Load seed files, nodes, leases, and ground truth |
| analyzePortfolio (stream) | Run the Refine and Map stages and emit trace steps |
| getGraph | Nodes and edges with evidence |
| simulateFailure | Run the cascade for a chosen node |
| streamTelemetry (stream out) | Push readings every 2 seconds and flag anomalies |
| runIncidentAgent (stream) | Plan and propose actions for an incident |
| approveAction, rejectAction | The human gate |
| generateRemediation | Explanation, tests, and TypeScript replacement |
| runParity | Compare the TypeScript against golden outputs |
| getEvalReport | Extraction found X of 10, precision, recall |
| replayLastRun | Serve a cached run for demo safety |

## Agent design

The agent is a bounded planner loop: Nemotron chooses the next tool, deterministic code runs it, and short structured results come back.

1. An anomaly event or a user click creates an incident.
2. The planner call receives the incident, a graph summary, and the tool list, and returns a JSON plan of ordered tool steps.
3. The executor validates each step's arguments against the tool's schema, runs it, and stores the result as a trace step.
4. After each step a rule or one short model call decides: continue, replan, or stop.
5. Action steps stop at the approval gate. The UI shows what will happen, to whom, and the dollar impact; the human approves, edits, or rejects.
6. After approval the tool runs, writes an audit record, and the trace shows the result.

| Tool | Kind | Runs as | Needs approval |
| --- | --- | --- | --- |
| parse\_files | analyze | Code | No |
| extract\_entities | analyze | Nemotron, checked by code | No |
| propose\_edges | analyze | Nemotron, output validated | No |
| verify\_edge | analyze | Code: confirms the cited file and line exist and match | No |
| build\_graph | analyze | Code | No |
| detect\_anomaly | analyze | Code | No |
| simulate\_cascade | analyze | Code | No |
| price\_impact | analyze | Code | No |
| rank\_risk | analyze | Code | No |
| explain\_module | analyze | Nemotron | No |
| generate\_tests, generate\_replacement | build | Nemotron plus a code template | No |
| run\_parity | verify | Code | No |
| create\_work\_order | act | Database write | Yes |
| send\_email | act | Resend | Yes |
| schedule\_maintenance | act | .ics file sent through Resend | Yes |
| place\_call | act | Retell web call | Yes |
| failover\_to\_backup | act | Mocked | Yes, labeled high risk |

- **Division of labor.** Nemotron never does arithmetic, graph traversal, or test execution.
- **Validation.** Every model output is checked against a schema; on failure retry once with the error text, then fall back to a cached plan.
- **Replanning triggers.** A tool error, an edge confidence below 0.6, a parity failure, or a rejected action. Example: place\_call fails, so the plan becomes send\_email plus create\_work\_order, and the trace shows "Replanned: \<reason>".
- **Trace content.** Decision summaries, tool, arguments, result summary, latency, and model. Do not show raw reasoning text.
- **Budget.** At most 20 model calls per incident. On a 429, back off exponentially and switch to the smaller model.
- **Safety.** Actions go only to configured demo contacts, and the approval gate cannot be bypassed in code.

## Deterministic engines

Every number the demo shows comes from code that can be unit-tested; the model only chooses tools and explains results.

| Engine | Rules |
| --- | --- |
| Graph | Node types: system, module, tenant, lease, utility, sensor, SLA. Each edge has a kind, a delay in minutes, a confidence from 0 to 1, and a cited file and line. Edges without evidence are drawn dashed as unverified and excluded from dollar totals |
| Cascade simulation | One simulated minute per step. States: healthy, degraded (a capacity fraction), failed. A node with k-of-n redundancy fails only when fewer than k upstream units are healthy. A failure crosses an edge after its delay. State is recomputed each step, so cycles cannot loop forever. Output: an ordered timeline of node, minute, and state |
| Thermal model | After total cooling loss, hall temperature rises linearly: minutes to shutdown = (limit minus current) divided by rise rate, with rise rate scaling with rack kW. Calibrate so a 5 kW cabinet shuts down in about 3 minutes, as one study reported ([source](https://www.datacenterknowledge.com/outages/additional-details-on-rackspace-outages)), and label it an assumption. Higher kW means faster |
| Cost and SLA | Allowed downtime from the SLA target (99.99% is about 52 minutes a year). Credit of 5 to 30% of the monthly fee per incident by duration, capped at one month's fee ([source](https://www.datacentres.com/faq/what-are-data-centre-slas)). One credit per root cause; scheduled maintenance excluded ([source](https://www.ptc.org/download/data-center-service-level-agreements)). Plus configurable emergency response and hardware damage lines. All inputs sit in an assumptions panel labeled illustrative |
| Risk score | Blast radius (weighted downstream tenants) times dollars at risk times code fragility (paragraph count, hardcoded literals, COMP-3 fields, missing tests), each normalized to 0 to 1 |
| Anomaly detection | EWMA baseline; alert when the z-score exceeds 3 for 3 consecutive samples, or an absolute limit or rate-of-change limit is crossed. Sensor-fault rules: flatline (zero variance for N samples), out of range, missing data for N intervals, 10 times scale mismatch. Faults raise a maintenance notice, never a thermal incident. A 60-second cooldown prevents flapping |
| Parity runner | Golden table captured from real GnuCOBOL. The TypeScript uses integer cents or a decimal library. Compare as formatted PIC strings. Cases include rounding boundaries, negative adjustments, zero, and overflow |
| Evaluation | 10 planted dependencies plus 3 decoys. Report found, missed, false positives, precision, and recall |

## Seed data spec

The seed data is the product: spend the first hours here, because a thin seed makes every later step look fake.

| File | Contents | Planted issue |
| --- | --- | --- |
| LEASEBIL.cbl | Monthly rent and CAM billing with paragraphs for lease read, base rent with escalation, CAM share, base-year stop, cap, and SLA credit; reads COOLFLAG.DAT | Reads a thermal flag (D1); hardcodes base year 2019 (D4); one COMPUTE without ROUNDED; a two-digit year window |
| LEASECPY.cpy | Lease record layout with COMP-3 amounts and a REDEFINES | Shared by two programs (D3) |
| CAMCALC.cbl | Called subprogram for pro rata share and caps | Uses occupied area as the denominator where the lease says total area |
| INVBATCH.jcl | Nightly invoice job | Runs before the BMS export, so it reads a stale flag (D10) |
| schema.sql | tenants, leases, units, invoices, work\_orders, and a trigger on work\_orders | Trigger grants vendor badge access (D5) |
| bms\_config.json | BACnet objects for 3 chillers (2 required), CRAH units, UPS panels, power meters, and point scales | One point scaled by 10, one in Fahrenheit; chiller controls and CRAH 4 share UPS panel B (D6, D7) |
| access\_export.csv | Readers, doors, controllers, badge groups | Hall door controller depends on the BMS network switch (D8) |
| leases/\*.txt | Six tenant lease excerpts: base year, cap type, pro rata, SLA clause, amendments | Northwind amendment moves the base year from 2019 to 2021 (D4); the data center tenant has a 99.99% SLA tied to cooling (D9) |
| Telemetry generator | Readings every 2 seconds for chiller supply temperature, loop flow, hall inlet temperature, UPS load, door state | Scripted scenario below |

**Billing bug, with numbers.** Northwind Retail leases 8,200 sf. Operating expense per sf: $11.20 in 2019, $12.05 in 2021, $13.40 in 2024. The lease bills the increase over 2021: (13.40 minus 12.05) times 8,200 divided by 12 equals $922.50 a month. The code uses 2019: (13.40 minus 11.20) times 8,200 divided by 12 equals $1,503.33. The overcharge is $580.83 a month, or $6,970 a year. Add three more cases engineered to land on a half-cent boundary and take their expected values from the real compiler.

**Incident scenario script.**

1. For 40 seconds everything is normal.
2. Chiller CH-2 trips. Two of three chillers still meet demand, so the UI shows a degraded warning and no cascade. This proves the model respects redundancy.
3. At 90 seconds a power-quality event on UPS panel B trips CH-1. One chiller remains where two are required.
4. The anomaly detector fires on the loop supply temperature, and the agent starts without a click.
5. The predicted timeline shows hall inlet temperature crossing its limit in minutes, the Acme Cloud SLA breaching, LEASEBIL reading the thermal flag and applying a credit, and the dollar total.

| ID | From to | Kind | Evidence planted in |
| --- | --- | --- | --- |
| D1 | LEASEBIL to COOLFLAG.DAT | reads | LEASEBIL.cbl, thermal flag read paragraph |
| D2 | BMS export job to COOLFLAG.DAT | writes | bms\_config.json export block |
| D3 | CAMCALC to LEASECPY | shares layout | COPY statements in both programs |
| D4 | LEASEBIL to Northwind lease amendment | code versus contract | LEASEBIL.cbl working storage versus leases/northwind.txt |
| D5 | work\_orders trigger to badge access | grants | schema.sql trigger |
| D6 | Chiller loop to UPS panel B | powers | bms\_config.json |
| D7 | CRAH 4 to UPS panel B | powers | bms\_config.json |
| D8 | Hall door controller to BMS switch | network | access\_export.csv |
| D9 | Acme Cloud SLA to hall cooling loop | contractual | leases/acme.txt |
| D10 | INVBATCH to BMS export timing | schedules | INVBATCH.jcl |

Record the exact file and line for each so verify\_edge can check it. Plant 3 decoys with similar names that are not dependencies, so the precision number means something.

## Real data options

Keep the synthetic scenario as the primary demo because it is controllable, and add real data as a validation layer if time allows.

| Source | What it gives | How to use it | Caveat |
| --- | --- | --- | --- |
| [AWS CardDemo](https://aws.amazon.com/blogs/opensource/introducing-open-source-aws-carddemo-for-mainframe-modernization) | Open source (Apache 2.0) COBOL and CICS credit card application with copybooks and screen maps | A second system for graph and explanation only, to show the tool generalizes | CICS and BMS screens do not run under GnuCOBOL, so no parity test; AWS sells its own transformation service, so expect judges to know it |
| [ASHRAE RP-1043 chiller data](https://figshare.com/articles/dataset/Chiller_operation_data_set/28435232) | Sensor data from a 90-ton centrifugal chiller under fault-free and 8 injected fault conditions, at 27 operating conditions ([paper](https://arxiv.org/pdf/1902.06366)) | Replay through the anomaly detector and report detection results | Different point names and units than our seed; check the license before redistributing |
| [LBNL labeled HVAC fault datasets](https://link.springer.com/10.1038/s41597-023-02197-w) | Largest known public set of labeled faulted and fault-free HVAC operation, including chiller plants | Labels for validating detection; realism for slides | Mostly simulated; large downloads |
| CBRE Discord resources | Real property data promised after opening ceremony | Use if usable | The brief is marked proprietary and confidential: keep their data out of public repos and Devpost |

If you replay RP-1043, label it "offline validation on public research data" so nobody mistakes it for CBRE data.

## UI spec

One screen, dark operations-center style: the graph in the middle, the agent trace on the right, and detail tabs along the bottom.

| Area | Content |
| --- | --- |
| Top KPI strip | Dollars at risk, hidden dependencies found (X of 10), critical modules, current incident status, and a Live or Replay mode switch |
| Center graph | Force-directed dependency graph. Node color shows risk. Dashed edges are unverified. Clicking a node or edge opens a panel with its evidence: file, line, and code snippet. The cascade animates outward from the failed node in simulated minutes |
| Right sidebar | Agent trace as streaming step cards: stage (Refine, Map, Plan, Assemble, Validate), tool, arguments, result summary, latency, model, status. Replans are highlighted |
| Bottom tabs | Telemetry (live chart with anomaly markers), Cascade (timeline and per-tenant impact), Risk ranking, Findings (billing discrepancy cards), Remediation (explanation, tests, TypeScript), Parity (per-case pass or fail), Actions (audit log), Eval (extraction accuracy) |
| Approval modal | Each pending action with recipient, content, dollar impact, and Approve, Edit, Reject |
| Assumptions panel | Editable SLA credit, hardware, and response cost inputs, labeled illustrative |
| Banner | "Demo mode: no real tenants are contacted" |

For the graph, let Leap pick a standard npm force-graph library; ask for node click and animated state changes, not a specific package.

## Build plan and Leap prompts

Send Leap five smaller prompts in order instead of one giant one; each ends in something that runs, so a bad generation costs one step.

**Phase 0, before Leap.**

- Create keys: NVIDIA (build.nvidia.com, starts with nvapi-), Resend (use your own account email), Retell (an agent set up for a web call).
- Call the NVIDIA models endpoint (GET /v1/models with your key) to confirm the exact Nemotron model names.
- Compile LEASEBIL with GnuCOBOL on a laptop (Docker or apt) and capture at least 40 input and output cases as the golden table.
- Write the seed files and the ground-truth table with exact file and line numbers.
- Check Leap's credit limits.

**Phase 1: data layer, seed data, graph UI (no AI).**

```text
Build a full-stack app called Cascade for commercial real estate operators. This first step is the data layer, seed data and graph UI only; no AI yet.

Backend (Encore.ts), separate services: portfolio, graph, telemetry. Use a Postgres database with tables: source_files, nodes, edges, lease_terms, telemetry_points, telemetry_readings, incidents, findings, ground_truth_edges. Give every endpoint a unique name (seedPortfolio, getGraph, getFindings).

seedPortfolio loads the seed data I will paste in: source files, 3 properties (one is a data center), nodes, edges with evidence_file and evidence_line, lease terms, and ground-truth dependencies.

Frontend (React and TypeScript, dark operations-center style): a top KPI strip (dollars at risk, hidden dependencies found, critical modules; placeholders for now); a force-directed dependency graph where node color shows risk, edge style shows confidence (dashed = unverified), and clicking a node opens a side panel with its evidence (file name, line number, code snippet). Bottom tabs: Cascade, Risk, Findings, Telemetry, Parity, Actions (empty for now).
```

**Phase 2: deterministic engines and telemetry.**

```text
Add deterministic engines in plain TypeScript with no LLM calls, each with unit tests.
1. simulateFailure(nodeId): time-stepped cascade, one simulated minute per step. Node states: healthy, degraded (capacity fraction), failed. Nodes have k_required and n_total redundancy: a node fails only when fewer than k upstream units are healthy. Edges have delay_min. Must be cycle-safe. Return an ordered timeline.
2. priceImpact(simulation): per tenant SLA credit of 5 to 30 percent of the monthly fee by outage duration, capped at one month's fee, one credit per root cause, scheduled maintenance excluded; plus configurable emergency response and hardware damage lines. Put every input in an editable assumptions table shown in the UI as "illustrative".
3. rankRisk(): blast radius times dollars at risk times code fragility, each normalized 0 to 1.
4. Telemetry: a generator emitting a reading every 2 seconds for chiller supply temperature, loop flow, hall inlet temperature, UPS load; a streaming endpoint pushes them to the UI. Anomaly detector: EWMA baseline, z-score above 3 for 3 consecutive samples, absolute limits, rate of change. Sensor-fault rules (flatline, out of range, missing data, 10x scale mismatch) raise a maintenance notice, not an incident. 60-second cooldown.
5. A button "Run incident scenario": CH-2 trips (absorbed, shown as degraded), 90 seconds later a power event on UPS panel B trips CH-1, leaving one of the two required chillers.
UI: animate the cascade spreading across the graph, show predicted minutes to impact per tenant, and put total dollars in the KPI strip.
```

**Phase 3: the Nemotron agent.**

```text
Add the Nemotron agent. Use the OpenAI-compatible API at https://integrate.api.nvidia.com/v1 with an Encore secret named NvidiaApiKey. Keep MODEL_PLANNER = "nvidia/nemotron-3-super-120b-a12b" and MODEL_FAST = "nvidia/nemotron-3-nano-30b-a3b" as config constants.

runIncidentAgent (streaming): triggered automatically when the anomaly detector raises an incident, or by a button. Loop: (1) a planner call returns a JSON plan of tool steps; (2) a typed tool registry executes each step: detect_anomaly, simulate_failure, price_impact, rank_risk, create_work_order, send_email, schedule_maintenance, place_call, failover_to_backup; (3) after each step, decide continue, replan, or stop; (4) action tools never run directly: they create an Action with status pending and wait at an approval gate.

Requirements: validate every model JSON output against a schema, retry once with the error text, then fall back to a cached plan; on HTTP 429 back off and switch to MODEL_FAST; at most 20 model calls per incident; a tool error produces a visible "Replanned: <reason>" step; arithmetic, graph traversal and test execution stay in code.

UI: the right sidebar shows the agent trace as step cards (stage, tool, arguments, result summary, latency, model, status); an approval modal lists each pending action with recipient, content and dollar impact with Approve, Edit and Reject; an Actions tab is the audit log.
```

**Phase 4: modernization pipeline.**

```text
Add the modernization pipeline for the COBOL billing module as five visible stages named Refine, Map, Plan, Assemble, Validate.
- Refine: explainModule uses Nemotron to explain what LEASEBIL does in plain English and list its business rules, each with the paragraph that implements it.
- Map: extract dependency edges with a deterministic parser (regex over COBOL paragraphs, COPY statements, file reads, JCL steps, SQL triggers). Nemotron may propose extra edges, but verifyEdge must confirm the cited file and line exist, otherwise mark the edge unverified. Show an Extraction accuracy panel from ground_truth_edges (found, missed, false positives, precision).
- Findings: compare lease_terms with constants hardcoded in the code and show Billing discrepancy cards with the lease clause and the code line side by side and the dollar impact per year.
- Assemble: generateReplacement creates a TypeScript version using integer cents or a decimal library, never floating point, plus characterization tests.
- Validate: runParity compares the TypeScript output with parity_cases.expected_output (captured from the real GnuCOBOL compiler and pasted into the seed) for every case, showing per-case pass or fail with diffs. Include cases at rounding boundaries.
Each stage writes agent_steps so it appears in the trace.
```

**Phase 5: real actions and demo safety.**

```text
Add real actions and demo-safety features.
- send_email: Resend API with Encore secret ResendApiKey. From address onboarding@resend.dev. Deliver every message to one configured DEMO_INBOX and show the simulated tenant address in the UI. Include an incident summary and an SLA notice template.
- schedule_maintenance: generate an .ics calendar invite and attach it to the email.
- place_call: Retell AI (secret RetellApiKey, agent id as a config constant). Start a browser web call, no phone number, with incident context passed as dynamic variables. If the call cannot start, show a simulated call screen with a transcript and mark the step failed so the agent replans to email plus a work order.
- Replay mode: store one complete successful run (trace, simulation, actions) and add a "Replay last run" toggle that serves it with no external calls.
- An assumptions panel and a banner reading "Demo mode: no real tenants are contacted".
```

## Team split, timeline, and demo

The schedule assumes roughly 20 build hours; compress it by cutting P1 and P2 items, never P0.

| Role | Owns |
| --- | --- |
| Data and COBOL lead | Seed files, golden COBOL outputs, ground-truth table, telemetry scenario |
| Agent and backend lead | Nemotron loop, tool registry, engines, Resend and Retell |
| Frontend and demo lead | Graph UI, trace sidebar, approval modal, pitch, Devpost, video |

| Hours in | Output | Leap prompt |
| --- | --- | --- |
| 0 to 1 | Keys, model names confirmed, Leap limits checked | Phase 0 |
| 1 to 5 | Seed files done; app scaffold with graph and evidence panel | Phase 1 |
| 5 to 9 | Cascade, pricing, telemetry, anomaly trigger working | Phase 2 |
| 9 to 14 | Agent loop, trace, approval gate | Phase 3 |
| 14 to 18 | Modernization stages, parity, findings, accuracy panel | Phase 4 |
| 18 to 20 | Email, calendar invite, web call, replay mode | Phase 5 |
| Last 3 | Rehearse, record the replay run, write Devpost, record the video | None |

**Three-minute demo script.**

1. 0:00. Show the graph: 3 properties, hidden dependencies found, KPI strip. Click D1 and show the LEASEBIL line that reads the thermal flag.
2. 0:30. Open Findings: the billing discrepancy of $6,970 a year, lease clause beside code line.
3. 0:55. Press Run incident scenario. CH-2 trips; the UI shows degraded and no cascade, because redundancy absorbed it.
4. 1:15. The second failure fires the anomaly detector. The agent starts on its own, the trace streams, the cascade animates, and minutes to impact, tenants, and dollars appear.
5. 1:50. The approval modal opens. Approve the email and calendar invite; the agent briefs the engineer on a call.
6. 2:20. Open Parity: the TypeScript matches the real GnuCOBOL output on every case. Show extraction found X of 10.
7. 2:45. Close with the pitch line and name each track's requirement as you point to it.

| Likely judge question | Answer |
| --- | --- |
| How do you know the graph is right? | Every edge cites a file and line, and we score against 10 planted dependencies plus decoys |
| Is the dollar figure real? | It follows published SLA credit norms; inputs are editable and labeled illustrative |
| Why not just ask an LLM? | Math, graph traversal, and tests are code; the model plans and explains |
| What if a sensor lies? | Fault rules separate sensor faults from thermal events |
| Is the parity test real? | Expected outputs come from the real GnuCOBOL compiler; the script is in the repo |
| Does it run on our network? | Nemotron is open; the same code can point at a self-hosted NIM endpoint |

## Risks and edge cases

The likeliest failures are rounding mismatches in parity, rate limits during the live demo, and Leap drifting from the spec; each has a fallback.

| Risk | Mitigation or fallback |
| --- | --- |
| Parity fails on rounding or overflow | Use integer cents; take expected values from the real compiler; keep boundary cases in the test table |
| Nemotron returns invalid JSON or hits the rate limit | Schema validation, one retry, cached plan, switch to the smaller model, replay mode |
| Model invents dependencies | Edges without a verified file and line stay dashed and are excluded from totals |
| Simulator shows catastrophe for every failure | k-of-n redundancy; the scenario's first failure must show no cascade |
| Dollar figures challenged | Assumptions panel, editable inputs, labeled illustrative |
| Telemetry glitch pages someone | Sensor-fault rules route to a maintenance notice; 60-second cooldown |
| Resend returns 403 | Send only to the account owner's inbox from onboarding@resend.dev |
| Retell web call will not start | Simulated call screen; the agent replans to email plus a work order |
| Venue wifi fails | Replay mode with a recorded run, plus a screen recording backup |
| Leap output drifts from the spec | Five small prompts; review each before the next; keep the spec doc open |
| Leap credits run out | Check limits first; commit generated code to GitHub after each phase |
| Secrets leak in the repo | Keys only as Encore secrets; never in prompts or seed files |
| CBRE material is confidential | Do not publish their data or document text publicly |
| Real people get contacted | All recipients are demo contacts; the UI states it; only call yourselves, since unsolicited calls with AI voices are legally restricted in the US |

## Domain cheat sheet and sources

Figures below come from search results for the linked pages, which were not opened in full; treat them as approximate and verify any number you will say out loud.

| Term | What to know |
| --- | --- |
| Uptime Institute tiers | Expected availability per year: Tier I 99.671%, Tier II 99.741%, Tier III 99.982%, Tier IV 99.995% ([source](https://w.media/microsofts-singapore-data-center-experiences-outage-due-to-cooling-units-failure/)). Tier III allows maintenance without taking the site down; Tier IV is fully fault tolerant |
| Colocation SLA | Commonly 99.99% (about 52 minutes a year) or 99.999% (about 5.3 minutes); credits of 5 to 30% of monthly fees per incident, capped at one month ([source](https://www.datacentres.com/faq/what-are-data-centre-slas)) |
| N+1 and 2N | One spare unit versus a full duplicate path. Redundancy is why one chiller failing usually does not cascade |
| Thermal runaway | After cooling stops while UPS-backed IT keeps running, temperature can pass limits within minutes or seconds ([source](https://upsite.com/?p=3601)). AI clusters raise rack density, which shortens the window |
| CAM and base year | Common area maintenance pass-through. A base-year lease recovers only the increase over the base year, so a wrong base year is wrong every year |
| Most billing errors | Mostly input errors (wrong base year, wrong cap type, missing exclusion), not arithmetic ([source](https://rets.ai/blog/what-is-lease-reconciliation)). One vendor estimates about 40% of reconciliations have a material error ([source](https://www.prophia.com/blog/the-15-billion-blind-spot-why-cam-rec-errors-are-draining-cre-owners-noi)); that is a software seller's figure |
| Caps and gross-up | Caps can be annual, cumulative, or compounding. Gross-up must be applied consistently to the base year and the reconciliation year |
| COMP-3 and ROUNDED | Packed decimal maps to a decimal type, never float. Without ROUNDED, COBOL truncates; compilers have been reported to differ on intermediate rounding ([thread](https://lists.gnu.org/archive/html/gnucobol-users/2010-02/msg00015.html); [migration note](https://mecanik.dev/en/cobol-to-java/)) |
| BACnet and Modbus | Field devices such as chillers mostly speak Modbus, the building system speaks BACnet, and a gateway maps registers to BACnet objects ([source](https://bliiot.com/cases-detail/modbus-to-bacnet-gateway-in-hvac-systems)) |
| Point scaling | Some Modbus points are stored as integers times 10; watch units (C versus F) |

**Sources searched.** [Leap quickstart](https://docs.leap.new/getting-started/quickstart.md); [Leap conventions](https://www.mintlify.com/x1xhlol/system-prompts-and-models-of-ai-tools/commercial/leap); [NVIDIA inference profiles](https://docs.nvidia.com/nemoclaw/latest/reference/inference-profiles.html); [genblaze NVIDIA notes](https://pypi.org/project/genblaze-nvidia/); [h2o NIM guide](https://docs.h2o.ai/enterprise-h2ogpte/guide/models-section/nvidia-nim-llms); [Resend 403 note](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain); [Retell outbound calls](https://docs.retellai.com/deploy/outbound-call.md); [Retell overview](https://docs.retellai.com/skill.md); [Retell pricing summary](https://www.toolworthy.ai/en/tool/retell-ai); [AWS CardDemo](https://aws.amazon.com/blogs/opensource/introducing-open-source-aws-carddemo-for-mainframe-modernization); [8090 profile](https://yespress.io/8090-solutions); [8090 overview](https://www.beri.net/tools/8090-software-factory); [RP-1043 data](https://figshare.com/articles/dataset/Chiller_operation_data_set/28435232); [LBNL fault datasets](https://link.springer.com/10.1038/s41597-023-02197-w); [GnuCOBOL WebAssembly](https://dev.livecodes.io/docs/languages/cobol-wasm); [GnuCOBOL Docker](https://marketplace.visualstudio.com/items?itemName=OlegKunitsyn.gnucobol-debug); [data center SLA terms](https://www.ptc.org/download/data-center-service-level-agreements); [thermal shutdown study](https://www.datacenterknowledge.com/outages/additional-details-on-rackspace-outages).

Resend's daily limit comes from a third-party guide: [RedwoodSDK email guide](https://docs.rwsdk.com/guides/email/sending-email/).
