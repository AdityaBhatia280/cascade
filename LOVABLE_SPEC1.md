# Cascade — Frontend Build Spec (for Lovable)

You are building the **frontend only** for Cascade, a hackathon project (HackUTD 2026). A separate Node/Express backend already exists and will be connected later. Build a polished enterprise SaaS UI that talks to that backend through one API module, with a fixture fallback so the preview works without the backend.

Read this whole document before generating anything. Sections 1–3 are rules. Sections 4–7 are what to build. Sections 8–10 are the data contract — follow them exactly, because the backend is being built to the same contract.

---

## 1. What Cascade is (context for copy and layout decisions)

Cascade reads a commercial real estate company's legacy software stack (COBOL billing code, SQL schemas, building-management configs, access-control exports, lease documents), finds the dependencies nobody documented, predicts what breaks when one part fails, and takes action after a human approves.

The demo story: a COBOL lease-billing program and a data center cooling loop turn out to be connected. When chillers fail, Cascade's agent predicts the cascade (minutes to impact, tenants hit, SLA credit dollars), proposes actions (email, calendar invite, briefing call), waits for human approval, and also finds a billing bug in the COBOL code ($6,970/year overcharge) and writes a verified TypeScript replacement.

It is judged by three tracks — the UI must make each one obvious:
- **NVIDIA:** a Nemotron-powered agent with visible step-by-step tool calls, replanning, and a human approval gate.
- **CBRE:** fragmented real-estate data connected into a dependency graph that predicts cascades and quantifies dollar impact.
- **8090:** legacy COBOL explained, rewritten in TypeScript, and verified for parity against real compiler output. Use 8090's stage names: **Refine → Map → Plan → Assemble → Validate**, with an audit trail.

---

## 2. Hard rules

1. **No invented data.** Every number on screen comes from the API module (section 9). Do not hardcode metrics, scores, percentages, or counts in components. If data is missing, show an empty state.
2. **Fixtures are allowed only inside `src/lib/fixtures.ts`** and only through the API module's fallback. Use the exact values in section 10 — do not make up additional records.
3. **Label simulated data.** A persistent banner reads: "Demo mode — simulated building data. No real tenants are contacted." Dollar figures from the cost engine carry an "Illustrative" label linking to the Assumptions page.
4. **Never present an AI hypothesis as confirmed.** Edges with `verified: false` render dashed, are labeled "Unverified," and are excluded from dollar totals. Suspected causes and confirmed faults look different.
5. **The approval gate cannot be bypassed in the UI.** Any action with `requires_approval: true` only executes through the Approve button in the approval dialog.
6. **Don't show raw model reasoning.** The agent trace shows decision summaries, tool names, arguments, results, latency, and model — not chain-of-thought text.
7. **Do not build:** login/auth, multi-user, file upload, an inspector portal, a marketing landing page, or a logo drawn in CSS/SVG. Leave a 28×28 placeholder `<div>` with the text "C" where the logo goes; the real asset will be added later.

---

## 3. Design system (follow strictly)

**Direction:** premium, minimal, architectural enterprise SaaS. Inspiration: Linear, Vercel, Stripe, Brex. Predominantly white. **Avoid** gradients, glows, glassmorphism, neon, dark "hacker" themes, decorative illustrations, constant pulsing, and overly rounded components.

### Tokens

```css
:root {
  --color-primary: #ff5900;      /* Cascade Orange — accents and primary actions ONLY */
  --color-black: #111111;
  --color-white: #ffffff;
  --color-background: #fafafa;   /* app background */
  --color-surface: #ffffff;      /* cards, panels */
  --color-surface-secondary: #f3f4f6;
  --color-border: #e5e7eb;
  --color-text: #111111;
  --color-text-secondary: #6b7280;
  --color-success: #15803d;
  --color-warning: #b45309;
  --color-critical: #dc2626;
  --color-info: #2563eb;
  --radius-sm: 6px;   /* badges */
  --radius-md: 8px;   /* buttons, inputs */
  --radius-lg: 12px;  /* cards, modals, panels */
  --sidebar-width: 240px;
  --header-height: 64px;
  --font-family: "Inter", Arial, Helvetica, sans-serif;
}
```

Map these into the Tailwind theme and shadcn CSS variables. Use shadcn/ui components, restyled to these tokens.

### Typography (Inter)
| Element | Size | Weight |
|---|---|---|
| Page heading | 32px | 650–700, tight tracking |
| Section heading | 24px | 600 |
| Card heading | 18px | 600 |
| Body | 14–16px | 400 |
| Labels | 12–13px | 500 |
| Metadata | 12px | 400 |
| Metric values | 28–36px | 650–700, `font-variant-numeric: tabular-nums` |

Sentence case for labels. Tabular numbers for all metrics, timestamps, and readings. Use a monospace font (JetBrains Mono or ui-monospace) **only** for code, file paths, and line numbers.

### Color rules
- Orange is for: active nav item indicator, primary buttons, selected graph node, key highlights. Never as a large background. Never to mean "warning."
- Green/amber/red only for real status. Status is never color-only — always pair with a text label (Healthy, Degraded, Failed, Unverified, Pending, Approved, Rejected).

### Components
- **Buttons:** primary = orange bg, white text, 8px radius, 40px height. Secondary = white bg, gray border, black text. Danger = red outline. Visible focus ring.
- **Cards:** white, 1px `#e5e7eb` border, 12px radius, 20–24px padding, no heavy shadow.
- **Tables:** subtle horizontal dividers, clear headers, row hover, right-aligned numbers.
- **Badges:** 6px radius, concise labels.
- **Charts (Recharts):** orange for the main series, muted gray for secondary, no 3D, minimal decoration. Include a text summary for accessibility.

### Motion and accessibility
Transitions 150–250ms only. Respect `prefers-reduced-motion`. WCAG 2.2 AA contrast, keyboard navigable, 44px minimum touch targets, no hover-only interactions.

---

## 4. App shell

- **Stack:** React + TypeScript + Vite + Tailwind + shadcn/ui + react-router-dom + Recharts + `@xyflow/react` (React Flow) for the graph + lucide-react icons.
- **Left sidebar (240px, white, right border):** logo placeholder + "Cascade" wordmark at top, grouped nav (below), gray icons, black text, orange left-bar indicator on the active item. Collapses to icons on tablet and to a sheet on mobile.
- **Top header (64px):** page title, property selector (static: "Cascade Tower — Chicago, IL"), last-updated timestamp, Live/Replay segmented toggle, primary button **"Run incident scenario"**, and a pending-approvals indicator (bell with count from `GET /api/actions?status=pending`).
- **Demo banner:** thin strip above the header with the text from rule 3. Neutral gray, not orange.
- **Global approval dialog:** opens automatically when a new pending action arrives over the agent stream (section 9.3), and from the bell. Content in section 6.
- **Content:** max width 1440px, 32px padding on desktop, 16–24px card gaps.

### Navigation
```
Overview
  Dashboard                 /
Infrastructure
  System intelligence       /intelligence     ← signature screen
  Equipment                 /equipment
Operations
  Incidents                 /incidents
  Actions & audit log       /actions
  Voice agent               /voice
Legacy code
  Billing findings          /findings
  Modernization             /modernization
  Parity                    /parity
  Extraction accuracy       /accuracy
Management
  Assumptions               /assumptions
```

---

## 5. Screens

### 5.1 Dashboard `/`
- **Four metric cards** (from `GET /api/overview`): Dollars at risk (Illustrative label), Hidden dependencies found ("X of Y" from the eval report), Critical single points of failure, Incident status (Nominal / Degraded / Critical — with text label).
- **Left column:** "Infrastructure health" — groups nodes by category (Cooling, Power, Network & access, Legacy software, Tenants) showing count per status.
- **Right column:** "Active incident" card (or empty state "No active incidents"), "Top findings" (3 highest-dollar findings), "Highest-risk components" (top 5 from `GET /api/risk`).
- **Bottom:** a compact telemetry chart (loop supply temperature and hall inlet temperature over time from the telemetry stream), with anomaly markers.

### 5.2 System intelligence `/intelligence` (signature screen)
Three-pane layout: graph (flexible) | analysis panel (360px, collapsible) — and the agent trace available as a toggleable right drawer.

**Graph (React Flow):**
- Nodes are **simple rectangular cards** (not circles): label, type tag (System, Module, Tenant, Utility, SLA), status badge, and a small "2 of 3" redundancy tag when `n_total > 1`.
- Edges are thin neutral gray lines with a small kind label (`reads`, `powers`, `cools`…). Verified = solid. Unverified = dashed + "Unverified" tooltip.
- Selected node: orange border. Failed node: red status badge + red left border. Degraded: amber. Status always also shown as text.
- Layout: auto-layout left-to-right with dagre (`@dagrejs/dagre`) so upstream dependencies sit left of dependents. Include zoom, fit-view, and minimap controls. Must never push other panels off screen on resize.
- **Cascade playback:** when a simulation result arrives, step through `timeline` entries in minute order (one step every ~600ms, skipped if reduced motion), updating node status. A scrubber shows "T+0 min … T+N min."
- Filter chips above the graph: All, Cooling, Power, Network, Legacy software, Tenants.

**Analysis panel (on node or edge click):**
- Node: name, type, status, redundancy, monthly value, SLA target, risk score with its factor breakdown.
- **Evidence** list — every connected edge with: `source → target`, kind, confidence (0–1 shown as %), Verified/Unverified badge, `evidence_file:evidence_line`, and the code snippet (fetched from `GET /api/source`), rendered in a monospace block with the cited line highlighted.
- Buttons: "Simulate failure" (calls `POST /api/simulate`, then plays the cascade), "Create work order" (creates a pending action — goes through the approval gate).

### 5.3 Equipment `/equipment`
Read-only table of nodes where `type` is `system` or `utility`: name, ID, category, status, redundancy, upstream/downstream counts. Search and status filter. Row click → opens the node in System intelligence.

### 5.4 Incidents `/incidents`
- List of incidents (`GET /api/incidents`), newest first.
- **Incident detail** (`/incidents/:id`), two columns:
  - Left: header (title, root node, opened time, status), **Predicted timeline** (vertical list: T+minute, node, new state, reason), **Per-tenant impact** table (tenant, minutes to impact, SLA credit $ — Illustrative), total.
  - Right: **Agent trace** (section 6) streaming live, with the approval queue below it.

### 5.5 Actions & audit log `/actions`
Table of every action ever proposed (`GET /api/actions`): time, tool, recipient (show the *simulated* recipient, with "Delivered to demo inbox" note), status badge, approved/rejected by, dollar impact, result. Filters by status. Row expands to show the full payload and result.

### 5.6 Voice agent `/voice`
- Agent availability indicator, current incident context card (root cause, impact, actions taken), a large **"Start briefing call"** button.
- Starting a call: `POST /api/voice/web-call` returns `{ access_token }`; start it with the `retell-client-js-sdk` package (`new RetellWebClient().startCall({ accessToken })`). Show call state (Connecting, Live, Ended) and a live transcript from the SDK's `update` events.
- If the call fails or the API returns an error, show a clearly labeled **"Simulated call"** panel with a scripted transcript from the incident context — never pretend it is live.
- Distinguish: Suggestions (gray), Recorded actions (green check), Requires confirmation (orange outline).

### 5.7 Billing findings `/findings`
Cards from `GET /api/findings`, sorted by dollar impact. Each: severity badge, title, description, annual impact, linked nodes. For `billing_discrepancy` findings show a **side-by-side comparison**: left "Code" (`code_file:code_line` + snippet), right "Contract" (`contract_file:contract_line` + snippet), with the computed monthly and annual difference below. Button: "Generate verified replacement" → navigates to Modernization.

### 5.8 Modernization `/modernization`
A horizontal stepper with the five 8090 stages: **Refine → Map → Plan → Assemble → Validate**. Data from `GET /api/modernization`.
- Refine: plain-English explanation of `LEASEBIL` + list of business rules, each with the paragraph name that implements it.
- Map: the extracted dependencies for this module (links into the graph).
- Plan: the remediation plan steps.
- Assemble: generated TypeScript (syntax-highlighted, read-only, copy button) and generated tests.
- Validate: link/summary of the parity run.
Each stage shows status (Pending, Running, Done, Failed) and which model or engine produced it.

### 5.9 Parity `/parity`
Header: pass count "X of Y cases match GnuCOBOL output" and a "Run parity" button (`POST /api/parity/run`). Table: case ID, description, inputs, **expected (GnuCOBOL)**, **actual (TypeScript)**, Pass/Fail badge, diff. Failed rows highlight the differing characters. Note under the header: "Expected outputs were captured from the real GnuCOBOL compiler."

### 5.10 Extraction accuracy `/accuracy`
From `GET /api/eval`: found X of Y planted dependencies, precision, recall, F1. A table of every ground-truth item: ID, from → to, kind, Found/Missed badge; decoys listed separately as Correctly rejected / False positive.

### 5.11 Assumptions `/assumptions`
Editable form (`GET`/`PUT /api/assumptions`) for SLA credit tiers, emergency response cost, hardware damage cost, thermal rise rate. Header label: "Illustrative inputs — edit to see how totals change." Save button re-runs pricing.

---

## 6. Shared components

### Agent trace
Vertical list of step cards, newest at the bottom, auto-scroll unless the user has scrolled up.
Each card: stage badge (Refine/Map/Plan/Assemble/Validate — neutral gray badges, not rainbow), tool name (monospace), one-line decision summary, collapsible arguments (JSON), result summary, latency (ms), model or engine name, status badge (Running, Done, Error, Replanned, Awaiting approval).
**Replanned** steps: amber left border + "Replanned: {reason}" line. Empty state: "Waiting for an incident. The agent starts automatically when the anomaly detector fires."

### Approval dialog
Title "Approval required." One row per pending action: tool icon + name, **recipient** (simulated) with "Delivered to demo inbox" note, content preview (expandable), dollar impact, risk tag (e.g., `failover_to_backup` is "High risk"). Buttons per row: **Approve** (primary), **Edit** (secondary — inline editable content, then approve), **Reject** (danger outline). Footer: "Every decision is written to the audit log." Responsive: max-width 640px, max-height 85vh, internal scroll.

### Status badge, metric card, empty state, error state, loading skeleton
Build these once and reuse everywhere.

---

## 7. Live behavior

- On load, subscribe to `GET /api/telemetry/stream` (SSE). Keep the last 120 readings per point in memory for charts.
- When the header's **Run incident scenario** is clicked: `POST /api/scenario/start`, then subscribe to `GET /api/agent/stream` (SSE). The backend scripts the chiller failures; the anomaly detector creates the incident; the agent starts by itself.
- **Replay mode** (header toggle): send `?mode=replay` on scenario start; the backend serves a recorded run. Show a "Replay" badge in the header while active.
- On SSE disconnect, show a small "Reconnecting…" pill and retry with backoff.

---

## 8. Project structure

```
src/
  lib/
    types.ts        ← paste section 9.1 exactly
    api.ts          ← the ONLY place that fetches; falls back to fixtures
    fixtures.ts     ← section 10 values only
    sse.ts          ← EventSource helper with reconnect
  components/       ← shared components (section 6)
  pages/            ← one file per route
  hooks/            ← useTelemetry, useAgentStream, useGraph
```

`api.ts` behavior:
- `const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'`.
- `const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true'`.
- If `USE_FIXTURES`, or a request fails with a network error, return fixture data and set a global `usingFixtures` flag. When the flag is on, show a small gray "Preview data" pill in the header.
- For SSE in fixture mode, simulate the agent stream by emitting the fixture agent steps on a timer.
- In Lovable's preview, set `VITE_USE_FIXTURES=true`.

---

## 9. API contract

### 9.1 Types (`src/lib/types.ts`)

```ts
export type NodeType = 'system' | 'module' | 'tenant' | 'utility' | 'sla';
export type NodeStatus = 'healthy' | 'degraded' | 'failed';
export type NodeCategory = 'cooling' | 'power' | 'network' | 'legacy' | 'tenant' | 'data';
export type EdgeKind =
  | 'reads' | 'writes' | 'feeds' | 'powers' | 'cools' | 'bills'
  | 'grants' | 'shares' | 'schedules' | 'contractual' | 'network';
export type Stage = 'refine' | 'map' | 'plan' | 'assemble' | 'validate';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  category: NodeCategory;
  status: NodeStatus;
  k_required: number;          // redundancy: fails when fewer than k upstream units are healthy
  n_total: number;
  monthly_fee_usd: number;
  sla_target_pct: number;
  risk_score: number;          // 0..1
}

// Convention: source is the upstream dependency, target is the dependent.
// Failure propagates source -> target after delay_min.
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  delay_min: number;
  confidence: number;          // 0..1
  evidence_file: string;       // '' when unverified
  evidence_line: number;       // 0 when unverified
  verified: boolean;
}

export interface SourceSnippet {
  file: string;
  line: number;
  start_line: number;
  lines: string[];             // includes a few lines of context around `line`
}

export interface Overview {
  dollars_at_risk_usd: number;
  dependencies_found: number;
  dependencies_total: number;
  critical_spofs: number;
  incident_status: 'nominal' | 'degraded' | 'critical';
  active_incident_id: string | null;
  updated_at: string;
}

export interface RiskEntry {
  node_id: string;
  label: string;
  risk_score: number;          // 0..1
  factors: { blast_radius: number; dollars_at_risk: number; fragility: number }; // each 0..1
}

export interface TimelineEntry {
  t_min: number;
  node_id: string;
  state: NodeStatus;
  reason: string;
}

export interface TenantImpact {
  tenant_id: string;
  tenant_label: string;
  minutes_to_impact: number;
  sla_credit_usd: number;
}

export interface Simulation {
  id: string;
  root_node: string;
  timeline: TimelineEntry[];
  impacts: TenantImpact[];
  total_usd: number;
  assumptions_version: number;
}

export interface Incident {
  id: string;
  title: string;
  root_node: string;
  status: 'open' | 'mitigating' | 'resolved';
  opened_at: string;
  simulation_id: string | null;
  agent_run_id: string | null;
}

export interface Finding {
  id: string;
  kind: 'billing_discrepancy' | 'hidden_dependency' | 'hardcoded_value' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  node_ids: string[];
  usd_per_year: number;
  code_file?: string;
  code_line?: number;
  contract_file?: string;
  contract_line?: number;
  monthly_billed_usd?: number;
  monthly_correct_usd?: number;
}

export interface AgentStep {
  id: string;
  run_id: string;
  idx: number;
  stage: Stage;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  result_summary: string;
  status: 'running' | 'done' | 'error' | 'replanned' | 'awaiting_approval';
  replan_reason?: string;
  latency_ms: number;
  model: string;               // e.g. 'nvidia/nemotron-3-super-120b-a12b' or 'engine/cascade'
  created_at: string;
}

export type ActionTool =
  | 'create_work_order' | 'send_email' | 'schedule_maintenance' | 'place_call' | 'failover_to_backup';

export interface Action {
  id: string;
  run_id: string;
  tool: ActionTool;
  recipient_display: string;   // simulated tenant/vendor address shown to the user
  content: string;
  usd_impact: number;
  risk: 'normal' | 'high';
  requires_approval: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  decided_by: string | null;
  decided_at: string | null;
  result: string | null;
}

export interface TelemetryPoint {
  id: string;
  node_id: string;
  name: string;
  unit: string;
  expected_min: number;
  expected_max: number;
}

export interface TelemetryReading {
  point_id: string;
  ts: string;
  value: number;
  quality: 'ok' | 'stale' | 'suspect';
}

export interface Anomaly {
  id: string;
  point_id: string;
  ts: string;
  kind: 'threshold' | 'trend' | 'sensor_fault';
  severity: 'warning' | 'critical';
  message: string;
}

export interface ParityResult {
  case_id: string;
  description: string;
  input: Record<string, number>;
  expected: string;            // formatted PIC string from GnuCOBOL
  actual: string;              // formatted output from the TypeScript replacement
  pass: boolean;
}

export interface EvalReport {
  found: number;
  total: number;
  false_positives: number;
  precision: number;           // 0..1
  recall: number;              // 0..1
  f1: number;                  // 0..1
  items: { id: string; from: string; to: string; kind: string; is_decoy: boolean; matched: boolean }[];
}

export interface ModernizationStage {
  stage: Stage;
  status: 'pending' | 'running' | 'done' | 'failed';
  producer: string;            // model or engine name
  content: Record<string, unknown>;
}

export interface Assumptions {
  version: number;
  sla_credit_tiers: { max_minutes: number; pct_of_monthly_fee: number }[];
  emergency_response_usd: number;
  hardware_damage_usd: number;
  thermal_rise_c_per_min: number;
}
```

### 9.2 Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/overview` | `Overview` |
| GET | `/api/graph` | `{ nodes: GraphNode[]; edges: GraphEdge[] }` |
| GET | `/api/source?file=…&line=…` | `SourceSnippet` |
| GET | `/api/risk` | `RiskEntry[]` |
| POST | `/api/simulate` body `{ node_id }` | `Simulation` |
| GET | `/api/incidents` | `Incident[]` |
| GET | `/api/incidents/:id` | `{ incident: Incident; simulation: Simulation \| null; steps: AgentStep[]; actions: Action[] }` |
| POST | `/api/scenario/start?mode=live\|replay` | `{ ok: true }` |
| GET | `/api/findings` | `Finding[]` |
| GET | `/api/actions?status=…` | `Action[]` |
| POST | `/api/actions/:id/approve` body `{ content?: string }` | `Action` |
| POST | `/api/actions/:id/reject` | `Action` |
| POST | `/api/work-orders` body `{ node_id, note }` | `Action` (pending) |
| GET | `/api/modernization` | `ModernizationStage[]` |
| POST | `/api/parity/run` | `ParityResult[]` |
| GET | `/api/eval` | `EvalReport` |
| GET/PUT | `/api/assumptions` | `Assumptions` |
| GET | `/api/telemetry/points` | `TelemetryPoint[]` |
| POST | `/api/voice/web-call` | `{ access_token: string }` |

### 9.3 Server-sent event streams

`GET /api/telemetry/stream` — events:
- `reading` → `TelemetryReading`
- `anomaly` → `Anomaly`
- `node_status` → `{ node_id: string; status: NodeStatus }`

`GET /api/agent/stream` — events:
- `incident` → `Incident`
- `simulation` → `Simulation`
- `step` → `AgentStep` (same `id` may be re-sent with an updated status; replace in place)
- `action_pending` → `Action` (opens the approval dialog)
- `action_updated` → `Action`
- `run_complete` → `{ run_id: string; status: 'completed' | 'failed' }`

---

## 10. Fixture data (`src/lib/fixtures.ts`)

Use only these values. They come from the real seed files.

### Nodes
| id | label | type | category | k/n | monthly_fee_usd | sla % | risk |
|---|---|---|---|---|---|---|---|
| UPS-B | UPS panel B | utility | power | 1/1 | 0 | 99.999 | 0.90 |
| CH-1 | Chiller 1 | system | cooling | 1/1 | 0 | 99.99 | 0.85 |
| CH-2 | Chiller 2 | system | cooling | 1/1 | 0 | 99.99 | 0.70 |
| CH-3 | Chiller 3 | system | cooling | 1/1 | 0 | 99.99 | 0.70 |
| cooling_loop | Chilled water loop | system | cooling | 2/3 | 0 | 99.99 | 0.95 |
| CRAH-4 | CRAH unit 4 | system | cooling | 1/1 | 0 | 99.99 | 0.65 |
| hall_200 | Data hall 200 (Acme Cloud) | tenant | tenant | 1/1 | 45000 | 99.99 | 0.95 |
| acme_sla | Acme 99.99% cooling SLA | sla | tenant | 1/1 | 45000 | 99.99 | 0.90 |
| COOLFLAG.DAT | COOLFLAG.DAT | module | data | 1/1 | 0 | 99.0 | 0.85 |
| LEASEBIL | LEASEBIL.cbl | module | legacy | 1/1 | 0 | 99.9 | 0.92 |
| CAMCALC | CAMCALC.cbl | module | legacy | 1/1 | 0 | 99.9 | 0.65 |
| LEASECPY | LEASECPY.cpy | module | legacy | 1/1 | 0 | 99.9 | 0.50 |
| INVBATCH | INVBATCH.jcl | module | legacy | 1/1 | 0 | 99.0 | 0.80 |
| northwind_retail | Northwind Retail | tenant | tenant | 1/1 | 15200 | 99.0 | 0.75 |
| meridian_analytics | Meridian Analytics | tenant | tenant | 1/1 | 8900 | 99.0 | 0.40 |
| coastal_logistics | Coastal Logistics | tenant | tenant | 1/1 | 14000 | 99.0 | 0.35 |
| SW-03 | BMS network switch SW-03 | system | network | 1/1 | 0 | 99.95 | 0.75 |
| CTL-04 | Data hall door controller | system | network | 1/1 | 0 | 99.9 | 0.60 |
| work_orders | Work orders table | system | data | 1/1 | 0 | 99.5 | 0.70 |
| badge_access | Badge access table | system | network | 1/1 | 0 | 99.9 | 0.80 |

All statuses start `healthy`.

### Edges (source → target)
| id | source | target | kind | delay | conf | evidence | verified |
|---|---|---|---|---|---|---|---|
| E-D6 | UPS-B | CH-1 | powers | 0 | 1.0 | seed/bms/bms_config.json:35 | yes |
| E-D7 | UPS-B | CRAH-4 | powers | 0 | 1.0 | seed/bms/bms_config.json:320 | yes |
| E-C1 | CH-1 | cooling_loop | cools | 1 | 1.0 | seed/bms/bms_config.json:30 | yes |
| E-C2 | CH-2 | cooling_loop | cools | 1 | 1.0 | seed/bms/bms_config.json:40 | yes |
| E-C3 | CH-3 | cooling_loop | cools | 1 | 1.0 | seed/bms/bms_config.json:50 | yes |
| E-H1 | cooling_loop | hall_200 | cools | 3 | 1.0 | seed/leases/acme.txt:61 | yes |
| E-H2 | CRAH-4 | hall_200 | cools | 2 | 1.0 | seed/bms/bms_config.json:320 | yes |
| E-D9 | hall_200 | acme_sla | contractual | 0 | 1.0 | seed/leases/acme.txt:58 | yes |
| E-D2 | cooling_loop | COOLFLAG.DAT | writes | 0 | 1.0 | seed/bms/bms_config.json:12 | yes |
| E-D1 | COOLFLAG.DAT | LEASEBIL | reads | 0 | 1.0 | seed/cobol/LEASEBIL.cbl:278 | yes |
| E-D3a | LEASECPY | LEASEBIL | shares | 0 | 1.0 | seed/cobol/LEASEBIL.cbl:50 | yes |
| E-D3b | LEASECPY | CAMCALC | shares | 0 | 1.0 | seed/cobol/CAMCALC.cbl:39 | yes |
| E-D10 | INVBATCH | LEASEBIL | schedules | 0 | 1.0 | seed/jcl/INVBATCH.jcl:36 | yes |
| E-D4 | LEASEBIL | northwind_retail | bills | 0 | 0.95 | seed/cobol/LEASEBIL.cbl:91 | yes |
| E-B2 | LEASEBIL | meridian_analytics | bills | 0 | 0.9 | seed/leases/meridian.txt:29 | yes |
| E-U1 | LEASEBIL | coastal_logistics | bills | 0 | 0.45 | — | **no** |
| E-D5 | work_orders | badge_access | grants | 0 | 1.0 | seed/sql/schema.sql:279 | yes |
| E-D8 | SW-03 | CTL-04 | network | 0 | 1.0 | seed/access/access_export.csv:8 | yes |

### Findings
1. **Northwind base year billing discrepancy** — `billing_discrepancy`, high, `usd_per_year: 6970`. Code `seed/cobol/LEASEBIL.cbl:91` → `05  WS-BASE-YEAR            PIC 9(4)    VALUE 2019.` Contract `seed/leases/northwind.txt:51` → `2021 (the "Amended Base Year"). All references to "Base Year"`. `monthly_billed_usd: 1503.33`, `monthly_correct_usd: 922.50`. Description: "LEASEBIL hardcodes base year 2019 ($11.20/sf). The 2021 amendment sets the base to $12.05/sf. Northwind (8,200 sf) is overcharged $580.83/month."
2. **Chiller 1 and CRAH 4 share UPS panel B** — `hidden_dependency`, critical, `usd_per_year: 0`. One power event on UPS-B takes out a chiller and an air handler at once, defeating the 2-of-3 chiller redundancy.
3. **Billing reads physical cooling status** — `hidden_dependency`, high, `usd_per_year: 0`. LEASEBIL reads COOLFLAG.DAT written by the BMS export; a cooling outage changes invoices.
4. **Nightly batch reads stale cooling flags** — `hidden_dependency`, medium, `usd_per_year: 0`. INVBATCH runs LEASEBIL (step 010) before the BMS export (step 020).
5. **Work orders auto-grant badge access** — `security`, high, `usd_per_year: 0`. Trigger `trg_work_order_badge` at `seed/sql/schema.sql:279` grants physical access with no review.

### Parity (expected values only; leave `actual` equal to `expected` and `pass: true` in fixtures, labeled preview)
| case | description | area sf | base $/sf | current $/sf | expected |
|---|---|---|---|---|---|
| CASE-01 | Northwind, 2021 amended base | 8200 | 12.05 | 13.40 | `0000922.50` |
| CASE-02 | Northwind, hardcoded 2019 base (bug) | 8200 | 11.20 | 13.40 | `0001503.33` |
| CASE-03 | Meridian | 4800 | 12.80 | 13.40 | `0000240.00` |
| CASE-04 | Pinnacle | 6200 | 11.60 | 13.40 | `0000930.00` |
| CASE-05 | Truncation boundary | 1000 | 10.00 | 10.07 | `0000005.83` |
| CASE-06 | Exact cent boundary | 300 | 10.00 | 10.10 | `0000002.50` |
| CASE-07 | Zero increase | 5000 | 13.40 | 13.40 | `0000000.00` |
| CASE-08 | Expense decrease floors at zero | 4000 | 14.00 | 13.40 | `0000000.00` |

### Telemetry points
| id | name | unit | expected range | baseline |
|---|---|---|---|---|
| PT-CH1-TEMP | CH-1 supply temp | °C | 6–10 | 7.2 |
| PT-CH2-TEMP | CH-2 supply temp | °C | 6–10 | 7.4 |
| PT-CH3-TEMP | CH-3 supply temp | °C | 6–10 | 7.1 |
| PT-LOOP-FLOW | Loop flow | L/min | 250–400 | 350 |
| PT-HALL-TEMP | Hall 200 inlet temp | °C | 20–24 | 21.5 |
| PT-UPSB-LOAD | UPS-B load | % | 35–75 | 54 |

Fixture telemetry: emit each point every 2s at baseline ± small noise.

### Fixture agent run (emit one step every ~1.2s after "Run incident scenario")
1. `refine` · `detect_anomaly` · "CH-2 tripped. 2 of 3 chillers still running; loop is degraded, no cascade." · engine/anomaly
2. `refine` · `detect_anomaly` · "UPS-B power event tripped CH-1. 1 of 3 chillers running, 2 required. Incident opened." · engine/anomaly
3. `plan` · `plan_response` · "Plan: simulate cascade from UPS-B, price impact, propose notifications." · nvidia/nemotron-3-super-120b-a12b
4. `map` · `simulate_cascade` · "Hall 200 reaches its thermal limit in about 4 minutes. LEASEBIL will apply an SLA credit on the next billing run." · engine/cascade
5. `plan` · `price_impact` · "Acme Cloud SLA credit and response costs computed (illustrative)." · engine/cost
6. `assemble` · `send_email` · status `awaiting_approval` · nvidia/nemotron-3-super-120b-a12b → emits `action_pending` (send_email to `facilities@acme-cloud.example`)
7. `assemble` · `schedule_maintenance` · status `awaiting_approval` → emits `action_pending` (calendar invite to `chiller-vendor@example.com`)

In fixtures, leave dollar values on these actions as `0` and show "Computed by backend" — the real totals come from the cost engine.

### Fixture evaluation report (`EvalReport`)
- `found: 10`, `total: 10`, `false_positives: 0`, `precision: 1.0`, `recall: 1.0`, `f1: 1.0`
- `items`:
  - `D1`: `COOLFLAG.DAT → LEASEBIL` (`reads`, `is_decoy: false`, `matched: true`)
  - `D2`: `cooling_loop → COOLFLAG.DAT` (`writes`, `is_decoy: false`, `matched: true`)
  - `D3`: `LEASECPY → CAMCALC` (`shares`, `is_decoy: false`, `matched: true`)
  - `D4`: `LEASEBIL → northwind_retail` (`bills`, `is_decoy: false`, `matched: true`)
  - `D5`: `work_orders → badge_access` (`grants`, `is_decoy: false`, `matched: true`)
  - `D6`: `UPS-B → CH-1` (`powers`, `is_decoy: false`, `matched: true`)
  - `D7`: `UPS-B → CRAH-4` (`powers`, `is_decoy: false`, `matched: true`)
  - `D8`: `SW-03 → CTL-04` (`network`, `is_decoy: false`, `matched: true`)
  - `D9`: `hall_200 → acme_sla` (`contractual`, `is_decoy: false`, `matched: true`)
  - `D10`: `INVBATCH → LEASEBIL` (`schedules`, `is_decoy: false`, `matched: true`)
  - `X1`: `LEASEBIL → METERREAD` (`reads`, `is_decoy: true`, `matched: false`)
  - `X2`: `CTL-01 → SW-01` (`network`, `is_decoy: true`, `matched: false`)
  - `X3`: `coastal_logistics → bms_meters` (`reads`, `is_decoy: true`, `matched: false`)

### Fixture modernization stages (`ModernizationStage[]`)
1. `refine` · `done` · `nvidia/nemotron-3-super-120b-a12b` · `{ summary: "LEASEBIL.cbl calculates monthly base rent escalations, pro-rata CAM pass-throughs via CAMCALC, and cooling SLA credits from COOLFLAG.DAT.", rules: [{ paragraph: "3000-BASE-RENT-CALC", rule: "Applies annual percentage escalation to base rent" }, { paragraph: "4000-CAM-SHARE-CALC", rule: "Computes OpEx increase over WS-BASE-YEAR (hardcoded 2019) and calls CAMCALC" }, { paragraph: "5000-SLA-CREDIT-CALC", rule: "Reads COOLFLAG.DAT and deducts 5%–30% credit by outage duration" }] }`
2. `map` · `done` · `engine/ast-parser` · `{ edges_verified: 10, unverified: 1 }`
3. `plan` · `done` · `nvidia/nemotron-3-super-120b-a12b` · `{ steps: ["Parameterize base_year per tenant lease amendment", "Use integer cents (BigInt) for COMP-3 decimal arithmetic", "Preserve COBOL truncation semantics on non-ROUNDED COMPUTE statements", "Verify 1:1 output against 8 GnuCOBOL golden cases"] }`
4. `assemble` · `done` · `nvidia/nemotron-3-super-120b-a12b` · `{ typescript_code: "export interface LeaseInput {\n  areaSf: number;\n  baseOpexCents: number;\n  currentOpexCents: number;\n}\n\nexport function computeMonthlyCamPic(input: LeaseInput): string {\n  const deltaCents = Math.max(0, input.currentOpexCents - input.baseOpexCents);\n  const annualCents = BigInt(deltaCents) * BigInt(input.areaSf);\n  const monthlyCents = Number(annualCents / 12n);\n  const dollars = Math.floor(monthlyCents / 100);\n  const cents = monthlyCents % 100;\n  return `${String(dollars).padStart(7, '0')}.${String(cents).padStart(2, '0')}`;\n}", tests_code: "describe('computeMonthlyCamPic parity with GnuCOBOL', () => {\n  it('matches CASE-01 Northwind 2021 amendment ($922.50)', () => {\n    expect(computeMonthlyCamPic({ areaSf: 8200, baseOpexCents: 1205, currentOpexCents: 1340 })).toBe('0000922.50');\n  });\n  it('matches CASE-05 truncation boundary ($5.83)', () => {\n    expect(computeMonthlyCamPic({ areaSf: 1000, baseOpexCents: 1000, currentOpexCents: 1007 })).toBe('0000005.83');\n  });\n});" }`
5. `validate` · `done` · `engine/parity` · `{ passed: 8, total: 8 }`

### Fixture assumptions (`Assumptions`)
- `version: 1`
- `sla_credit_tiers`: `[{ max_minutes: 60, pct_of_monthly_fee: 0.05 }, { max_minutes: 240, pct_of_monthly_fee: 0.10 }, { max_minutes: 480, pct_of_monthly_fee: 0.20 }, { max_minutes: 10080, pct_of_monthly_fee: 0.30 }]`
- `emergency_response_usd: 2500`
- `hardware_damage_usd: 0`
- `thermal_rise_c_per_min: 2.6`

---

## 11. How to paste this into Lovable (recommended 3-prompt sequence)

Lovable works best when you attach or paste the full spec on the first prompt and then build in 2–3 focused steps so it doesn't time out.

### Prompt 1 — Design system, data layer, app shell, Dashboard, and System Intelligence graph
> Paste the entire `LOVABLE_SPEC.md` above, then add at the bottom:
>
> **"Step 1: Implement `src/lib/types.ts`, `src/lib/fixtures.ts`, `src/lib/api.ts` (with fixture fallback), the light enterprise design tokens from Section 3 (`#FAFAFA` background, `#FFFFFF` cards, `#111111` text, `#FF5900` Cascade Orange accents, `#E5E7EB` 1px borders), the App Shell (240px left sidebar, 64px top header with Run Incident Scenario button, Live/Replay toggle, pending approvals bell, and Demo mode banner), the global Approval Dialog, the Agent Trace drawer, Screen 5.1 (`/` Dashboard), and Screen 5.2 (`/intelligence` System Intelligence with React Flow rectangular node cards, dagre left-to-right layout, filter chips, cascade timeline playback scrubber, and collapsible Evidence & Analysis panel)."**

