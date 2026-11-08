# Cascade

Cascade builds a data center's power and cooling dependency model from the documents operators already
have, checks whether the redundancy those documents promise is real, and plans the cord and feed moves
that fix what isn't. A facilities manager learns whether this week's maintenance is safe, what goes
dark, whose it is, and how to fix it. Nothing a human hasn't approved changes the model.

It runs on one fictional site, **DFW1**: a mid-size multi-tenant colocation hall with 6 customers,
52 cabinets, 101 cords and 108 circuits, described in deliberately messy documents under
`seed/sites/dfw1/docs/` (an asset register, a BMS point list, a circuit roster, a Maximo work order export,
and an MSA plus order form per customer).

## What it does

- **Builds the model from documents.** Deterministic parsers read each document into plain values.
  When two documents disagree, live measurement wins over paperwork. The BMS point list beats the
  circuit roster, the roster beats the equipment register, and the register beats the contracts. A
  value no document states is missing, and any outcome that needs it comes back `unknown`.
- **Audits redundancy.** Seven rules: single-corded cabinets, A/B paths that converge upstream, failover
  overload, over-committed circuits, cooling capacity (N+1 derived from capacity vs heat load, not
  declared), cooling common cause, and contract promises the topology doesn't deliver.
- **What-if.** Fail any component or take it out for maintenance and watch the cascade: A/B cords,
  ATS transfer, UPS battery then bypass, capacity re-share and overload trips, cooling pools and
  thermal ride-through. Per customer: which cabinets go down or lose redundancy, and monthly revenue
  exposed.
- **Plans fixes.** A search finds the fewest cord re-homes, added cords and panel re-feeds that clear
  findings without overloading anything on failover, then re-audits the whole model to confirm what each
  plan clears and that it introduces nothing.
- **Shift handoff.** One printable page for a given moment: work in progress or due in 24 hours with
  its assessment, redundancy lost now, BMS and power monitoring events in the last 12 hours and alarms
  still active, work waiting on materials or plant conditions, alarm limits to watch, and the vendor and
  lead Maximo lists per job. The page says where the exports end.
- **Customer maintenance notices.** One per customer for a work order, each opening with whether the
  customer is affected and how ("your A feed will be de-energized; your B feed remains"). When the
  records show a cabinet going dark, the notice is blocked with the reason: for the PDU-3A shutdown,
  Halcyon's B feed lands on RPP-4B, which is fed from PDU-3A, so no honest notice can say it remains.
- **Email behind the gate.** A person approves the exact words (by content hash) and Cascade sends them
  through Resend, once per notice, and logs who approved it. Every email goes to one demo inbox
  (`NOTIFY_TO`) and names its intended recipient. Without an email key nothing is sent: the message
  is written to `data/<site>/outbox/` and reported as not sent.
- **Approval gate.** Plans become proposals. Only a human can approve, reject or mark them completed.
  Approving re-verifies against the current model (a proposal whose base changed goes stale). Repeated
  requests with the same `Idempotency-Key` replay the first result.
- **Companion.** Ask in plain words (`POST /api/companion`): is this week safe, what if UPS-A fails,
  fix PDU-3A, draft the notice for Halcyon. It answers in a sentence or two and tells the view what to
  switch off, select and highlight. It works over the same engine the UI uses: the model chooses the
  tool, code computes every fact and number. It can submit a fix for approval but never approves or
  sends. Without an LLM key a fixed intent table answers the same questions.
- **3D + one-line views.** A generated 3D model of the site and a 2D one-line diagram share one
  selection. X-ray a cabinet to see its A and B paths and where they meet.

## What it is not

- DFW1, its customers and contracts are invented. `seed/sites/dfw1/ground_truth.json` records the
  planted defects, conflicts and decoys; only tests read it, never the app.
- The DFW1 accuracy test (8/8 planted defects found, 0/4 decoys flagged) measures internal
  consistency: the engine and the seed were written against the same design. Accuracy on a real
  operator's documents is unmeasured.
- Single-line diagram PDFs are not read, and contract clauses are read only in their one-line form. No
  live telemetry, no auth or multi-user.
- Dollar figures are monthly revenue exposed, not SLA credits owed.

## Run

```sh
npm install
npm run dev     # server on 127.0.0.1:5001, UI on 127.0.0.1:5173
npm test        # core, server and frontend tests
```

On first boot the server registers every document under `seed/sites/<CASCADE_SITE>/docs/` into an
append-only event log at `data/<CASCADE_SITE>/events.jsonl`. Delete that file to start over.
Copy `.env.example` to `.env` to set the port, site, CORS origins, or an OpenAI-compatible LLM
(`LLM_API_KEY` or `NVIDIA_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`; default NVIDIA Nemotron), and email
(`RESEND_API_KEY`, `NOTIFY_FROM`, `NOTIFY_TO`).

Things to try:

- **Facility**: x-ray cabinet E01. Its "B" cord lands on RPP-4B, which is fed from PDU-3A on the A side.
- **Facility**: what-if `UPS-A fails`, then scrub the timeline.
- **Findings**: open "Cabinet D06 is single-corded", plan a fix, submit it, approve it on **Proposals**.
- **Planned work**: open WO-26-1230, then **Prepare notices**. Halcyon's notice is blocked; Lone Star's
  says its B feed remains.
- **Shift handoff**: set the time to 2026-11-09 18:00 and read what the next shift inherits.
- **Findings**: open the RPP-3A convergence. The roster puts D03's B cord on RPP-3B, but the BMS
  puts it on RPP-3A, so both D03 cords meet there.
- **Companion**: ask "is this week safe?", then "fix PDU-3A", then approve the proposal it queued.

## Layout

| Path | What it is |
|---|---|
| `core/` | `@cascade/core`: pure, deterministic model and analysis. No I/O beyond reading what it's given |
| `core/src/contract.ts` | Vocabulary and wire DTOs, imported by `server/` and `frontend/` as `@cascade/core/contract` |
| `core/src/facility/` | `Fact<T>` (a value, or missing), typed entities, assembly, compare-and-set patches |
| `core/src/ingest/` | The DFW1 document parsers and the source precedence table |
| `core/src/physics/supply.ts` | The one propagation engine used by what-if, SPOF analysis, audit and plan verification |
| `core/src/analysis/` | `analyze()`: audit rules, exposure, planner; `money.ts` is the only place dollars are computed |
| `core/src/view/scene.ts` | Scene for both views: 3D boxes, one-line positions, links, x-ray |
| `server/` | Express shell: per-site event log, workspace (sole writer), approval gate, routes typed by `ApiRoutes`, SSE, agent loop |
| `frontend/` | React 19 single-page app built with Vite (TanStack Router/Query, Radix + Tailwind, React Three Fiber, xyflow). Conventions in `frontend/AGENTS.md` |
| `seed/sites/dfw1/` | The fictional site: documents, `generate.ts` that regenerates them, test-only ground truth |
| `docs/research/` | Sourced research notes: equipment reliability, data center cooling, CRE data sources, sponsor tracks |

## History

Cascade started at HackUTD 2026 as a staged demo: an "agent" that read legacy code and acted on approval,
mostly scripted. An honest-scope pass cut it down to a what-if simulator over a hand-written graph.
v2 rebuilt it for data center operations: the dependency model now comes from documents, redundancy
semantics are physical (A/B any-cord, capacity pools) instead of a k-of-n count, and the agent's
actions go through the same verified, approval-gated path as a human's. The original is at commit
`0647d97`.
