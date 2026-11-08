// The ONLY module that talks to the Cascade backend. Falls back to fixtures in preview or on network errors.
import * as fx from './fixtures';
import { openSSE, type SSEHandle } from './sse';
import type {
  Action, AgentStep, Anomaly, Assumptions, EvalReport, Finding, GraphEdge, GraphNode, Incident,
  ModernizationStage, NodeStatus, Overview, ParityResult, RealBenchmarks, RiskEntry, Simulation, SourceSnippet,
  TelemetryPoint, TelemetryReading, TimelineEntry, VoiceCallView, WhatIfResult,
} from './types';

const env = import.meta.env as Record<string, string | undefined>;
export const API_BASE = env['VITE_API_BASE'] ?? 'http://127.0.0.1:5001/api';
const USE_FIXTURES = env['VITE_USE_FIXTURES'] === 'true';

// ---- usingFixtures flag ----
let usingFixtures = USE_FIXTURES;
const flagListeners = new Set<() => void>();
export const isUsingFixtures = () => usingFixtures;
export function subscribeFixtureFlag(fn: () => void) {
  flagListeners.add(fn);
  return () => flagListeners.delete(fn);
}
function setUsingFixtures() {
  if (usingFixtures) return;
  usingFixtures = true;
  flagListeners.forEach((f) => f());
}

async function request<T>(path: string, init: RequestInit | undefined, fallback: () => T): Promise<T> {
  if (usingFixtures) return structuredClone(fallback());
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    setUsingFixtures();
    return structuredClone(fallback());
  }
  if (!res.ok) {
    // Fall back gracefully for this call without permanently killing live backend mode on 404/500
    return structuredClone(fallback());
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    return structuredClone(fallback());
  }
  return res.json() as Promise<T>;
}

// ---- Fixture runtime state ----
const fxState = {
  nodeStatus: {} as Record<string, NodeStatus>,
  incidents: [] as Incident[],
  simulations: {} as Record<string, Simulation>,
  steps: {} as Record<string, AgentStep[]>,
  actions: [] as Action[],
  assumptions: structuredClone(fx.fxAssumptions),
  incidentStatus: 'nominal' as Overview['incident_status'],
  faults: [] as string[],
  seq: 0,
};
const nid = (p: string) => `${p}-${Date.now().toString(36)}${(fxState.seq++).toString(36)}`;

const PHYSICAL = new Set(['powers', 'cools', 'network', 'contractual', 'feeds']);
const DATA_CATS = new Set(['legacy', 'data']);

function evaluateClientGraph(faults: string[]) {
  const edges = fx.fxEdges.filter((e) => e.verified);
  const nodes = fx.fxNodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const faultSet = new Set(faults.filter((f) => byId.has(f)));
  const label = (id: string) => byId.get(id)?.label ?? id;

  const statuses: Record<string, NodeStatus> = {};
  const reasons: Record<string, string> = {};
  for (const n of nodes) {
    if (faultSet.has(n.id)) {
      statuses[n.id] = 'failed';
      reasons[n.id] = 'Manually injected fault';
    } else {
      statuses[n.id] = 'healthy';
      reasons[n.id] = 'All upstream dependencies nominal';
    }
  }

  for (let iter = 0; iter < nodes.length + 2; iter++) {
    let changed = false;
    for (const n of nodes) {
      if (faultSet.has(n.id)) continue;
      const incoming = edges.filter((e) => e.target === n.id);
      const phys = incoming.filter((e) => PHYSICAL.has(e.kind));
      const soft = incoming.filter((e) => !PHYSICAL.has(e.kind));
      let next: NodeStatus = 'healthy';
      let reason = 'All upstream dependencies nominal';

      if (phys.length > 0) {
        const failedUp = phys.filter((e) => statuses[e.source] === 'failed');
        const healthyCount = phys.length - failedUp.length;
        const need = Math.min(Math.max(1, n.k_required), phys.length);
        const downList = failedUp.map((e) => label(e.source)).join(', ');

        if (healthyCount < need) {
          next = 'failed';
          reason =
            phys.length > 1
              ? `Only ${healthyCount} of ${phys.length} providers healthy (${need} required). Down: ${downList}`
              : `Lost supply: ${downList} (${failedUp[0]!.kind})`;
        } else if (failedUp.length > 0) {
          next = 'degraded';
          reason = `Redundancy consumed: ${healthyCount} of ${phys.length} providers healthy (${need} required). Down: ${downList}`;
        } else {
          const atRisk = phys.find((e) => e.kind === 'contractual' && statuses[e.source] === 'degraded');
          if (atRisk) {
            next = 'degraded';
            reason = `At risk: ${label(atRisk.source)} is running with reduced redundancy`;
          }
        }
      }

      if (next === 'healthy' && soft.length > 0) {
        const impaired = soft.filter((e) => {
          const s = statuses[e.source];
          const src = byId.get(e.source);
          return s === 'failed' || (s === 'degraded' && src && DATA_CATS.has(src.category));
        });
        if (impaired.length > 0) {
          next = 'degraded';
          reason = `Data dependency impaired: ${impaired.map((e) => `${label(e.source)} (${e.kind})`).join(', ')}`;
        }
      }

      if (statuses[n.id] !== next) {
        statuses[n.id] = next;
        reasons[n.id] = reason;
        changed = true;
      } else if (next !== 'healthy') {
        reasons[n.id] = reason;
      }
    }
    if (!changed) break;
  }

  const times = new Map<string, number>();
  for (const f of faultSet) times.set(f, 0);
  for (let iter = 0; iter < nodes.length + 2; iter++) {
    let changed = false;
    for (const e of edges) {
      const ts = times.get(e.source);
      if (ts === undefined) continue;
      if (statuses[e.target] === 'healthy') continue;
      const stepDelay = Math.max(1, e.delay_min ?? 1);
      const cand = ts + stepDelay;
      const cur = times.get(e.target);
      if (cur === undefined || cand < cur) {
        times.set(e.target, cand);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { faultSet, statuses, reasons, times, byId };
}

export function fixtureWhatIf(faults: string[]): WhatIfResult {
  const { faultSet, statuses, reasons, times, byId } = evaluateClientGraph(faults);
  fxState.faults = [...faultSet];
  fxState.nodeStatus = { ...statuses };
  for (const [node_id, status] of Object.entries(statuses)) {
    telemetryEmitter.emit('node_status', { node_id, status });
  }
  const impacts = fx.fxNodes
    .filter((n) => n.type === 'tenant' && statuses[n.id] !== 'healthy')
    .map((n) => ({
      tenant_id: n.id,
      tenant_label: n.label,
      minutes_to_impact: times.get(n.id) ?? 4,
      sla_credit_usd: statuses[n.id] === 'failed' ? Math.round(n.monthly_fee_usd * 0.3) : 0,
    }));
  const total_usd = impacts.reduce((s, i) => s + i.sla_credit_usd, 0) + (Object.values(statuses).includes('failed') ? 2500 : 0);
  const res: WhatIfResult = { faults: [...faultSet], statuses, reasons, impacts, total_usd };
  telemetryEmitter.emit('what_if', res);
  return res;
}

/** Preview-only cascade propagation over verified edges (backend owns the real engine). */
export function fixtureSimulate(rootId: string, prefailed: string[] = []): Simulation {
  const otherFaults = prefailed.length ? prefailed : fxState.faults.filter((f) => f !== rootId);
  const { statuses, reasons, times, byId } = evaluateClientGraph([rootId, ...otherFaults]);
  const rank: Record<NodeStatus, number> = { healthy: 0, degraded: 1, failed: 2 };
  const rootLabel = byId.get(rootId)?.label ?? rootId;
  const timeline: TimelineEntry[] = fx.fxNodes
    .filter((n) => statuses[n.id] !== 'healthy')
    .map((n) => ({
      t_min: times.get(n.id) ?? 0,
      node_id: n.id,
      state: statuses[n.id]!,
      reason: n.id === rootId ? `Initiating failure on ${rootLabel}` : reasons[n.id] ?? '',
    }))
    .sort((a, b) => a.t_min - b.t_min || (a.node_id === rootId ? -1 : b.node_id === rootId ? 1 : 0) || rank[b.state] - rank[a.state]);
  const impacts = timeline
    .filter((t) => byId.get(t.node_id)?.type === 'tenant')
    .map((t) => ({
      tenant_id: t.node_id,
      tenant_label: byId.get(t.node_id)!.label,
      minutes_to_impact: t.t_min,
      sla_credit_usd: t.state === 'failed' ? Math.round((byId.get(t.node_id)?.monthly_fee_usd ?? 0) * 0.3) : 0,
    }));
  const total_usd = impacts.reduce((s, i) => s + i.sla_credit_usd, 0) + (timeline.some((t) => t.state === 'failed') ? 2500 : 0);
  const sim: Simulation = { id: nid('SIM'), root_node: rootId, timeline, impacts, total_usd, assumptions_version: fxState.assumptions.version };
  fxState.simulations[sim.id] = sim;
  return sim;
}

// ---- REST ----
export const api = {
  overview: () =>
    request<Overview>('/overview', undefined, () => ({
      dollars_at_risk_usd: fx.fxFindings.reduce((s, f) => s + f.usd_per_year, 0),
      dependencies_found: fx.fxEval.found,
      dependencies_total: fx.fxEval.total,
      critical_spofs: fx.fxFindings.filter((f) => f.severity === 'critical').length,
      incident_status: fxState.incidentStatus,
      active_incident_id: fxState.incidents.find((i) => i.status !== 'resolved')?.id ?? null,
      updated_at: new Date().toISOString(),
    })),
  graph: () =>
    request<{ nodes: GraphNode[]; edges: GraphEdge[] }>('/graph', undefined, () => ({
      nodes: fx.fxNodes.map((n) => ({ ...n, status: fxState.nodeStatus[n.id] ?? n.status })),
      edges: fx.fxEdges,
    })),
  source: (file: string, line: number) =>
    request<SourceSnippet | null>(`/source?file=${encodeURIComponent(file)}&line=${line}`, undefined, () =>
      fx.fxSources.find((s) => s.file === file && s.line === line) ?? null,
    ),
  risk: () =>
    request<RiskEntry[]>('/risk', undefined, () =>
      [...fx.fxNodes]
        .sort((a, b) => b.risk_score - a.risk_score)
        .map((n) => ({ node_id: n.id, label: n.label, risk_score: n.risk_score, factors: { blast_radius: 0, dollars_at_risk: 0, fragility: 0 } })),
    ),
  simulate: (node_id: string) =>
    request<Simulation>('/simulate', { method: 'POST', body: JSON.stringify({ node_id }) }, () => fixtureSimulate(node_id)),
  whatIf: () =>
    request<WhatIfResult>('/what-if', undefined, () => fixtureWhatIf(fxState.faults)),
  setWhatIf: (faults: string[]) =>
    request<WhatIfResult>('/what-if', { method: 'POST', body: JSON.stringify({ faults }) }, () => fixtureWhatIf(faults)),
  incidents: () =>
    request<Incident[]>('/incidents', undefined, () => [...fxState.incidents].sort((a, b) => b.opened_at.localeCompare(a.opened_at))),
  clearIncidents: (onlyResolved = false) =>
    request<Incident[]>(`/incidents/clear?resolved=${onlyResolved}`, { method: 'POST' }, () => {
      fxState.incidents = onlyResolved ? fxState.incidents.filter((i) => i.status !== 'resolved') : [];
      return fxState.incidents;
    }),
  incident: (id: string) =>
    request<{ incident: Incident; simulation: Simulation | null; steps: AgentStep[]; actions: Action[] } | null>(
      `/incidents/${id}`, undefined, () => {
        const incident = fxState.incidents.find((i) => i.id === id);
        if (!incident) return null;
        return {
          incident,
          simulation: incident.simulation_id ? fxState.simulations[incident.simulation_id] ?? null : null,
          steps: incident.agent_run_id ? fxState.steps[incident.agent_run_id] ?? [] : [],
          actions: fxState.actions.filter((a) => a.run_id === incident.agent_run_id),
        };
      }),
  startScenario: async (mode: 'live' | 'replay') => {
    const r = await request<{ ok: true }>(`/scenario/start?mode=${mode}`, { method: 'POST' }, () => ({ ok: true }));
    if (usingFixtures) runFixtureScenario();
    return r;
  },
  findings: () => request<Finding[]>('/findings', undefined, () => fx.fxFindings),
  actions: (status?: Action['status']) =>
    request<Action[]>(`/actions${status ? `?status=${status}` : ''}`, undefined, () =>
      fxState.actions.filter((a) => !status || a.status === status),
    ),
  clearActions: (onlyPending = false) =>
    request<Action[]>(`/actions/clear?pending=${onlyPending}`, { method: 'POST' }, () => {
      fxState.actions = onlyPending ? fxState.actions.filter((a) => a.status !== 'pending') : [];
      return fxState.actions;
    }),
  approve: (id: string, content?: string) =>
    request<Action>(`/actions/${id}/approve`, { method: 'POST', body: JSON.stringify({ content }) }, () =>
      decide(id, 'approved', content),
    ),
  reject: (id: string) =>
    request<Action>(`/actions/${id}/reject`, { method: 'POST' }, () => decide(id, 'rejected')),
  createWorkOrder: (node_id: string, note: string) =>
    request<Action>('/work-orders', { method: 'POST', body: JSON.stringify({ node_id, note }) }, () => {
      const a: Action = {
        id: nid('ACT'), run_id: 'manual', tool: 'create_work_order', recipient_display: 'facilities-ops@cascade-tower.example',
        content: `Work order for ${node_id}: ${note}`, usd_impact: 0, risk: 'normal', requires_approval: true,
        status: 'pending', decided_by: null, decided_at: null, result: null,
      };
      fxState.actions.push(a);
      agentEmitter.emit('action_pending', a);
      return a;
    }),
  modernization: () => request<ModernizationStage[]>('/modernization', undefined, () => fx.fxModernization),
  runParity: (mode: 'strict' | 'patched' = 'strict') =>
    request<ParityResult[]>(`/parity/run?mode=${mode}`, { method: 'POST' }, () => fx.fxParity),
  eval: () => request<EvalReport>('/eval', undefined, () => fx.fxEval),
  benchmarks: () => request<RealBenchmarks>('/benchmarks', undefined, () => ({ carddemo: null, bdg2: null })),
  assumptions: () => request<Assumptions>('/assumptions', undefined, () => fxState.assumptions),
  saveAssumptions: (a: Assumptions) =>
    request<Assumptions>('/assumptions', { method: 'PUT', body: JSON.stringify(a) }, () => {
      fxState.assumptions = { ...a, version: fxState.assumptions.version + 1 };
      return fxState.assumptions;
    }),
  telemetryPoints: () =>
    request<TelemetryPoint[]>('/telemetry/points', undefined, () => fx.fxTelemetryPoints.map(({ baseline: _b, ...p }) => p)),
  voiceWebCall: async (incidentId?: string): Promise<{ access_token: string }> => {
    if (usingFixtures) throw new Error('Voice backend not connected in preview');
    const res = await fetch(`${API_BASE}/voice/web-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incidentId ? { incident_id: incidentId } : {}),
    });
    if (!res.ok) throw new Error(`Voice call failed (${res.status})`);
    return res.json();
  },
  voicePhoneCall: async (
    toNumber: string,
    incidentId?: string,
  ): Promise<{ call_id: string; from_number: string; to_number: string }> => {
    if (usingFixtures) throw new Error('Voice backend not connected in preview');
    const res = await fetch(`${API_BASE}/voice/phone-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_number: toNumber, ...(incidentId ? { incident_id: incidentId } : {}) }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Outbound phone call failed (${res.status})`);
    }
    return res.json();
  },
  voiceCallStatus: async (callId: string): Promise<VoiceCallView> => {
    const res = await fetch(`${API_BASE}/voice/call/${encodeURIComponent(callId)}`);
    if (!res.ok) throw new Error(`Call status failed (${res.status})`);
    return res.json();
  },
  voiceLatestCall: async (): Promise<VoiceCallView | { call_id: null }> => {
    const res = await fetch(`${API_BASE}/voice/latest-call`);
    if (!res.ok) throw new Error(`Latest call failed (${res.status})`);
    return res.json();
  },
};

function decide(id: string, status: 'approved' | 'rejected', content?: string): Action {
  const a = fxState.actions.find((x) => x.id === id);
  if (!a) throw new Error('Action not found');
  a.status = status === 'approved' ? 'executed' : 'rejected';
  if (content) a.content = content;
  a.decided_by = 'Demo operator';
  a.decided_at = new Date().toISOString();
  a.result = status === 'approved' ? 'Delivered to demo inbox' : 'Rejected by operator';
  return structuredClone(a);
}

// ---- Streams ----
type Handler = (data: unknown) => void;
function emitter() {
  const subs = new Set<Record<string, Handler>>();
  return {
    on(h: Record<string, Handler>) {
      subs.add(h);
      return () => subs.delete(h);
    },
    emit(event: string, data: unknown) {
      subs.forEach((h) => h[event]?.(structuredClone(data)));
    },
  };
}
const agentEmitter = emitter();
const telemetryEmitter = emitter();

export interface StreamHandlers {
  onEvent: Record<string, Handler>;
  onConnection?: (connected: boolean) => void;
}

export function subscribeTelemetry({ onEvent, onConnection }: StreamHandlers): () => void {
  if (usingFixtures) {
    const off = telemetryEmitter.on(onEvent);
    const tick = () => {
      const ts = new Date().toISOString();
      for (const p of fx.fxTelemetryPoints) {
        const noise = (Math.random() - 0.5) * (p.unit === 'L/min' ? 6 : p.unit === '%' ? 2 : 0.2);
        const r: TelemetryReading = { point_id: p.id, ts, value: +(p.baseline + noise).toFixed(2), quality: 'ok' };
        onEvent['reading']?.(r);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      clearInterval(t);
      off();
    };
  }
  let h: SSEHandle | null = openSSE(`${API_BASE}/telemetry/stream`, onEvent, onConnection);
  return () => {
    h?.close();
    h = null;
  };
}

export function subscribeAgent({ onEvent, onConnection }: StreamHandlers): () => void {
  const off = agentEmitter.on(onEvent);
  if (usingFixtures) return () => off();
  const h = openSSE(`${API_BASE}/agent/stream`, onEvent, onConnection);
  return () => {
    off();
    h.close();
  };
}

let fixtureRunToken = 0;
function runFixtureScenario() {
  const token = ++fixtureRunToken;
  const run_id = nid('RUN');
  fxState.steps[run_id] = [];
  let incident: Incident | null = null;
  fixtureWhatIf([]);
  fx.fxAgentSteps.forEach(([stage, tool, summary, model, finalStatus], idx) => {
    const at = 700 * (idx + 1);
    setTimeout(() => {
      if (token !== fixtureRunToken) return;
      const step: AgentStep = {
        id: `${run_id}-S${idx + 1}`, run_id, idx, stage, tool, summary, args: {}, result_summary: '',
        status: 'running', latency_ms: 0, model, created_at: new Date().toISOString(),
      };
      fxState.steps[run_id]!.push(step);
      agentEmitter.emit('step', step);
      setTimeout(() => {
        if (token !== fixtureRunToken) return;
        step.status = finalStatus;
        step.latency_ms = 240;
        step.result_summary = finalStatus === 'awaiting_approval' ? 'Awaiting human approval' : 'Completed';
        agentEmitter.emit('step', step);
        if (idx === 0) {
          fixtureWhatIf(['CH-2']);
          fxState.incidentStatus = 'degraded';
        }
        if (idx === 1) {
          fixtureWhatIf(['CH-2', 'UPS-B']);
          fxState.incidentStatus = 'critical';
          incident = {
            id: nid('INC'), title: 'Chiller failures — Data hall 200 cooling at risk', root_node: 'UPS-B',
            status: 'open', opened_at: new Date().toISOString(), simulation_id: null, agent_run_id: run_id,
          };
          fxState.incidents.push(incident);
          agentEmitter.emit('incident', incident);
        }
        if (idx === 3 && incident) {
          const sim = fixtureSimulate('UPS-B', ['CH-2']);
          incident.simulation_id = sim.id;
          agentEmitter.emit('simulation', sim);
          agentEmitter.emit('incident', incident);
        }
        if (finalStatus === 'awaiting_approval') {
          const tmpl = fx.fxPendingActions[idx - 5];
          if (tmpl) {
            const a: Action = { ...structuredClone(tmpl), id: nid('ACT'), run_id };
            fxState.actions.push(a);
            agentEmitter.emit('action_pending', a);
          }
        }
        if (idx === fx.fxAgentSteps.length - 1) {
          if (incident) incident.status = 'mitigating';
          agentEmitter.emit('run_complete', { run_id, status: 'completed' });
        }
      }, 240);
    }, at);
  });
}

export type { Anomaly };
