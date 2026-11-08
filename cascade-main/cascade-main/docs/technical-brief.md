# Cascade technical brief

Cascade reads a colocation data center's existing documents into one power and cooling dependency model, checks whether the redundancy those documents promise is real, and plans the cord and feed moves that fix what isn't, with a person approving every change.

## How data flows

```
upload       8 export kinds (CSV, JSON) + contract PDFs       POST /api/uploads
  |
classify     Nemotron proposes a kind; that kind's parser must accept the file
read         a parser reads every file; Nemotron also reads contracts
verify       a model value counts only if it is in the text, on its own clause,
  |          and agrees with the parser; otherwise it is dropped with a reason
precedence   BMS point list, then circuit roster, then register, then contracts
  |
typed facility model       every field is a Fact, known or missing
supply graph + propagate   the one engine for "what loses power or cooling"
  |
  +-- audit (7 rules) --+-- what-if, work orders, notices, MOP --+
  +-- fix planner (fewest moves, re-audited) --+-- money (one module) --+
  |
approval gate   human only; re-verify on submit and approve; idempotency
  |             keys; append-only event log
  |
UI (Site, Week, Handoff, Procedures, Approvals) + companion (Nemotron picks tools)
```

BMS, power monitoring and Maximo exports are records about the site. They feed the work-order grades, the shift handoff and the history views, and they never become topology.

## Design choices and why

- **Code computes every number.** The LLM classifies files, reads contracts, maps unfamiliar CSV headers and picks which tool to call. It never produces a fact, a finding, a dollar amount or a patch. An outage answer has to come out the same every time and trace back to a record.
- **One propagation engine.** `propagate` in `core/src/physics/supply.ts` answers what-if, the single-point-of-failure matrix, the audit, plan verification, work-order grading and MOP steps. There is no second evaluator to drift from it.
- **Missing is a value.** `Fact<T>` is known or missing (`core/src/facility/fact.ts`). An outcome that depends on a missing fact comes back `unknown` and names the fact, instead of guessing.
- **Fixed source precedence.** `SOURCE_PRECEDENCE` in `core/src/ingest/sources.ts` ranks live measurement above paperwork. `assemble` is pure, so the same documents give the same model and the same revision hash.
- **Append-only event log.** Each site's state is a fold over `data/<site>/events.jsonl`. A command builds the new state, appends its entry and result with fsync, and only then swaps the state in (`server/src/workspace.ts`). A repeated idempotency key replays the recorded result. The same key with a different request is refused.
- **Approval gate.** Only a human can approve, reject, complete or send (`server/src/actors.ts`). Approval re-verifies the patch against the current model. A proposal whose base changed goes stale (`server/src/proposals.ts`).
- **Money in one place.** `core/src/analysis/money.ts` is the only module that creates a `Usd` value. A contract's monthly fee is split over its cabinets by committed kW, or equally when any cabinet lacks one.

<div style="page-break-after: always;"></div>

## Questions judges are likely to ask

### 1. What happens if Nemotron is wrong?

Nemotron proposes and code checks. A file's kind counts only if that kind's parser accepts the file. Otherwise Cascade tries the rule-based kind, and then rejects the file with a reason (`classify` in `server/src/uploads/uploads.ts`). A contract value counts only if it appears in the text on its own clause and does not contradict the parser, and it can only fill fields the parser missed (`checkReading` in `core/src/ingest/reading.ts`). The test "with a model: a wrong contract value is dropped and the parser value stands; a wrong kind is overruled by the parser" in `server/src/uploads/uploads.test.ts` covers both cases.

### 2. Why not let the LLM do the analysis?

Finding single points of failure means failing every upstream component one at a time and following load re-share, breaker overload, UPS battery and bypass, and cooling deficits through the model. On DFW1 that model has more than 330 entities (measured). That is a computation that has to be exact and repeatable, so it lives in `core/src/analysis/analysis.ts` and `core/src/physics/supply.ts`. In the companion, the view actions come from the tools the model called, so the model never writes an id the UI acts on (`server/src/agent/loop.ts`).

### 3. How are dependencies modeled?

Topology lives in the entities as typed reference facts: a cord names its circuit, a circuit its panel, a PDU its UPS (`core/src/facility/entities.ts`). The kind fixes the supply rule. A breaker or panel is in series, an ATS transfers, a UPS has battery and bypass, a cabinet stays up while any cord is up, and cooling is a capacity pool where N+1 is derived from capacity against heat load, not taken from a label. `propagate` moves each node only toward `down` through the states `up`, `exposed`, `unknown` and `down`, so it terminates even when power and cooling depend on each other.

### 4. How do you handle records that disagree?

`normalizeTag` first makes "PDU-3B", "PDU 3B" and "pdu_3b" one entity (`core/src/ingest/sources.ts`). For each field, the source that ranks highest in `SOURCE_PRECEDENCE` wins. DFW1 plants 3 disagreements, and `core/src/dfw1.test.ts` checks that each resolves to the BMS value. One of them, the D03 B cord, becomes a real A/B convergence finding at RPP-3A. The losing value is not kept in the model today, so the UI cannot show which document lost.

### 5. What is real and what is synthetic?

The site is synthetic. DFW1, the provider Blackland Colocation LLC, its 6 customers, account numbers and asset tags are invented (`seed/sites/dfw1/README.md`). The August outdoor air trend is real NOAA hourly data for DFW Airport, and two utility sags sit on real high-load ERCOT days, though the sags themselves are modeled (`seed/sites/dfw1/external/`). The code paths are real too: the parsers, the engine, the Nemotron calls through NVIDIA's API and the email through Resend.

### 6. How do you know the documents are realistic?

Where a vendor publishes an export layout, the seed copies it. The Desigo CC event log uses the Log Viewer default columns from Siemens' help, the PME Data Export uses Schneider's Data Export Extended columns, and the Maximo export uses Maximo attribute names as headers. The PME event history is modeled on Schneider's alarm fields, because the reference page could not be checked. Where no layout is published, as for the Desigo trend export, the layout is modeled and `seed/sites/dfw1/README.md` says so. The files also carry deliberate mess: tags spelled differently per system, mixed units (kW, kVA, tons, amps), retired assets left in place, and sources that disagree.

### 7. How accurate is it?

On DFW1 the audit finds 8 of 8 planted defects and 7 of 7 of their consequences, flags 0 of 4 decoys, and reports no unexplained findings (`core/src/dfw1.test.ts`). The decoys look like defects but are not, such as a shared utility service and a normally open tie. This measures internal consistency, not accuracy, because the engine and the seed were written against the same design. Accuracy on a real operator's documents is unmeasured.

### 8. How do you know a planned fix is safe?

`core/src/analysis/planner.ts` searches for the cheapest set of moves (re-home a cord, add a cord, re-feed a panel) that clears the target findings without overloading any circuit, panel or UPS when the other side fails. Move costs are 1, 1 and 3, and the search stops at 50,000 nodes and marks the plan not optimal when it does (`core/src/constants.ts`). Every returned plan is applied to a copy of the model and fully re-audited, so it states what it clears and what it introduces. The server re-verifies again at submit and at approval, and refuses a plan that introduces any finding (`server/src/workspace.ts`).

### 9. What stops the agent from changing the model or emailing a customer?

The companion has 9 tools, and none of them approves, rejects, completes or sends (`server/src/agent/tools.ts`, checked by a test in `server/src/agent/companion.test.ts`). Those commands need a `HumanActor`, which only `humanFrom(req)` creates from an HTTP request, and agent code never sees a request (`server/src/actors.ts`). `submit_fix` runs the planner itself, so the model never writes a patch. An email goes out once per notice, only with the exact words a person approved, matched by content hash (`server/src/api.ts`, `server/src/workspace.ts`).

### 10. Where do the dollar figures come from?

Every dollar figure is a sum of per-cabinet shares from `revenueBook` in `core/src/analysis/money.ts`. A contract's monthly fee is split over its cabinets by committed kW when every cabinet has one, and equally otherwise. Cascade reports monthly revenue exposed, not SLA credits owed. The reason, recorded in that file, is that colocation SLAs usually exclude scheduled maintenance and pay only when both feeds fail.

### 11. How does it scale to a real site and multiple halls?

On DFW1 (52 cabinets, 101 cords, 108 circuits), assembly takes about 13 ms, analysis plus the full audit about 45 ms, and the all-fixable plan about 220 ms (measured, 3 cold runs on the development laptop). The single-point-of-failure matrix runs one propagation per upstream component, so its cost grows roughly with component count times graph size (inferred, not measured beyond DFW1). Halls are entities and cooling pools per hall, and the seed README defines how a second hall would be named, but no second hall exists in the seed or the tests yet. One server process serves one site, and its event log sits behind an interface that a database table could replace (`server/src/log.ts`).

### 12. What are the latency and cost of the model?

The default model is `nvidia/nemotron-3-super-120b-a12b` on NVIDIA's hosted API, called at temperature 0 (`server/src/agent/llm.ts`). Latency is not measured. The code allows 90 s per HTTP call, 60 s and up to 6 tool steps per companion turn, and 120 s per upload read with 4 files read at once. The research note estimates the cost at $0 on the build.nvidia.com trial, which forum posts put at about 40 requests per minute (inferred, `docs/research/11-nemotron-integration.md`).

### 13. What about security and multiple users?

There is no authentication. The operator names themselves with an `X-Cascade-User` header, and the frontend always sends `facilities-manager` (`server/src/actors.ts`, `frontend/src/lib/api.ts`). The server binds to 127.0.0.1 and accepts only the configured CORS origins (`server/src/index.ts`). Commands run through one serial queue per site, so two approvals cannot apply a patch twice, but there are no roles, sessions or per-user permissions.

### 14. What would you build next?

These are plans, not shipped work:

1. Sign-in with roles, so approving and sending need an authenticated person.
2. Keep the losing value when sources disagree, and show it next to the winner.
3. Read live BMS and power monitoring data instead of exports.
4. Run the audit on one real operator's documents and score the findings against their engineers' review.
5. Check every number in the companion's reply against the tool results it called.

### 15. How does Cascade meet each track's brief?

- **CBRE, "Predict Before It Spreads."** The brief asks to connect fragmented data to predict failures, quantify impact or execute solutions. Cascade joins 8 kinds of operator exports and 12 contract PDFs into one model, shows what goes dark when a component fails, prices it per customer, and plans fixes that a person approves.
- **NorthMark (NMC²).** The brief names a missed warning, an unclear handoff, and the wrong information at the wrong time. The audit catches hidden convergence such as cabinet E01's B cord landing on RPP-4B, which PDU-3A feeds, and the week view grades each scheduled work order before it starts. The shift handoff page (`core/src/handoff/handoff.ts`) lists work in progress, lost redundancy and active alarms. A customer notice is blocked when the records show a cabinet going dark, and the server refuses to send words that no longer match the records.
- **NVIDIA, "Use Nemotron Beyond a Chatbot."** In the upload pipeline Nemotron sorts files, reads contracts and maps unknown CSV headers with no chat at all. In the companion it chains up to 6 tool calls, for example a what-if, then a plan, then a submit for "fix PDU-3A". The external services are NVIDIA's API and Resend email. The 9 tools themselves are in-process calls to the engine.

## Honest limits

- **No live telemetry.** Cascade reads exported files. BMS and power monitoring history feed the handoff and history views, never the model's topology.
- **No authentication.** Anyone who can reach the server can approve under any name. The server binds to 127.0.0.1, so today only the local machine can reach it.
- **Prediction is topology-based.** Cascade says what fails if a component fails, given the documented topology, ratings and loads. It does not estimate how likely a failure is or when one will happen. Its timelines come from documented battery minutes, generator start delays and a lumped heat model for thermal ride-through (`core/src/physics/heat.ts`).
- **The site is synthetic.** DFW1 is one invented hall, and the accuracy test measures internal consistency. Accuracy on a real operator's documents is unmeasured.
- **The losing value of a disagreement is not shown.** The model keeps only the winning value.
- **The companion's sentence is model-written.** The prompt requires every number to come from a tool result, and `plain` in `server/src/agent/companion.ts` strips ids and caps the length. No code checks the sentence's numbers against the tool output.
- **Some documents are out of reach.** Single-line diagram PDFs and scanned PDFs are not read. The contract parser reads a clause only when it sits on one line or one PDF paragraph.
- **Some state is in memory.** Upload batch progress and the companion's reply replay are lost on restart. Proposals, approvals and sent messages are in the event log.

## How to check these numbers

Every count above comes from commit `9165479`. To re-run the tests, run `npm test` (180 tests: 112 core, 39 server, 29 frontend, all passing). To print the DFW1 accuracy and planner reports, run `npm test -w core`.
