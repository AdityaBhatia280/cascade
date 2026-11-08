// The ONLY module that talks to the Cascade backend. Falls back to fixtures in preview or on network errors.
import * as fx from './fixtures';
import { openSSE, type SSEHandle } from './sse';
import type {
  Action, AgentStep, Anomaly, Assumptions, EvalReport, Finding, GraphEdge, GraphNode, Incident,
  ModernizationStage, NodeStatus, Overview, ParityResult, RiskEntry, Simulation, SourceSnippet,
  TelemetryPoint, TelemetryReading, TimelineEntry,
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
    if (res.status === 404 && (res.headers.get('content-type') ?? '').includes('text/html')) {
      setUsingFixtures();
      return structuredClone(fallback());
    }
    throw new Error(`Request failed (${res.status})`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    setUsingFixtures();
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
  seq: 0,
};
const nid = (p: string) => `${p}-${Date.now().toString(36)}${(fxState.seq++).toString(36)}`;

const PHYSICAL = new Set(['powers', 'cools', 'network', 'contractual', 'feeds']);

/** Preview-only cascade propagation over verified edges (backend owns the real engine). */
export function fixtureSimulate(rootId: string, prefailed: string[] = []): Simulation {
  const edges = fx.fxEdges.filter((e) => e.verified);
  const nodes = new Map(fx.fxNodes.map((n) => [n.id, n]));
  const state = new Map<string, NodeStatus>();
  prefailed.forEach((id) => state.set(id, 'failed'));
  const timeline: TimelineEntry[] = [];
  const failedAt = new Map<string, number>();
  failedAt.set(rootId, 0);
  state.set(rootId, 'failed');
  timeline.push({ t_min: 0, node_id: rootId, state: 'failed', reason: 'Initiating failure' });
  const queue: { id: string; t: number }[] = [{ id: rootId, t: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t);
    const { id, t } = queue.shift()!;
    for (const e of edges.filter((x) => x.source === id)) {
      const tgt = nodes.get(e.target);
      if (!tgt) continue;
      const tt = t + e.delay_min;
      let next: NodeStatus;
      if (PHYSICAL.has(e.kind)) {
        const ups = edges.filter((x) => x.target === e.target && PHYSICAL.has(x.kind));
        const healthy = ups.filter((u) => state.get(u.source) !== 'failed').length;
        next = healthy < tgt.k_required ? 'failed' : 'degraded';
      } else {
        next = 'degraded';
      }
      const cur = state.get(e.target) ?? 'healthy';
      const rank = { healthy: 0, degraded: 1, failed: 2 };
      if (rank[next] <= rank[cur]) continue;
      state.set(e.target, next);
      if (next === 'failed') failedAt.set(e.target, tt);
      const srcLabel = nodes.get(id)?.label ?? id;
      timeline.push({ t_min: tt, node_id: e.target, state: next, reason: `${srcLabel} ${e.kind} ${tgt.label}` });
      queue.push({ id: e.target, t: tt });
    }
  }
  timeline.sort((a, b) => a.t_min - b.t_min);
  const impacts = timeline
    .filter((t) => nodes.get(t.node_id)?.type === 'tenant')
    .map((t) => ({ tenant_id: t.node_id, tenant_label: nodes.get(t.node_id)!.label, minutes_to_impact: t.t_min, sla_credit_usd: 0 }));
  const sim: Simulation = { id: nid('SIM'), root_node: rootId, timeline, impacts, total_usd: 0, assumptions_version: fxState.assumptions.version };
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
  incidents: () =>
    request<Incident[]>('/incidents', undefined, () => [...fxState.incidents].sort((a, b) => b.opened_at.localeCompare(a.opened_at))),
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
  runParity: () => request<ParityResult[]>('/parity/run', { method: 'POST' }, () => fx.fxParity),
  eval: () => request<EvalReport>('/eval', undefined, () => fx.fxEval),
  assumptions: () => request<Assumptions>('/assumptions', undefined, () => fxState.assumptions),
  saveAssumptions: (a: Assumptions) =>
    request<Assumptions>('/assumptions', { method: 'PUT', body: JSON.stringify(a) }, () => {
      fxState.assumptions = { ...a, version: fxState.assumptions.version + 1 };
      return fxState.assumptions;
    }),
  telemetryPoints: () =>
    request<TelemetryPoint[]>('/telemetry/points', undefined, () => fx.fxTelemetryPoints.map(({ baseline: _b, ...p }) => p)),
  voiceWebCall: async (): Promise<{ access_token: string }> => {
    if (usingFixtures) throw new Error('Voice backend not connected in preview');
    const res = await fetch(`${API_BASE}/voice/web-call`, { method: 'POST' });
    if (!res.ok) throw new Error(`Voice call failed (${res.status})`);
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

let scenarioRunning = false;
function runFixtureScenario() {
  if (scenarioRunning) return;
  scenarioRunning = true;
  const run_id = nid('RUN');
  fxState.steps[run_id] = [];
  let incident: Incident | null = null;
  const setStatus = (node_id: string, status: NodeStatus) => {
    fxState.nodeStatus[node_id] = status;
    telemetryEmitter.emit('node_status', { node_id, status });
  };
  fx.fxAgentSteps.forEach(([stage, tool, summary, model, finalStatus], idx) => {
    const at = 1200 * (idx + 1);
    setTimeout(() => {
      const step: AgentStep = {
        id: `${run_id}-S${idx + 1}`, run_id, idx, stage, tool, summary, args: {}, result_summary: '',
        status: 'running', latency_ms: 0, model, created_at: new Date().toISOString(),
      };
      fxState.steps[run_id]!.push(step);
      agentEmitter.emit('step', step);
      setTimeout(() => {
        step.status = finalStatus;
        step.latency_ms = 300;
        step.result_summary = finalStatus === 'awaiting_approval' ? 'Awaiting human approval' : 'Completed';
        agentEmitter.emit('step', step);
        if (idx === 0) {
          setStatus('CH-2', 'failed');
          setStatus('cooling_loop', 'degraded');
          fxState.incidentStatus = 'degraded';
        }
        if (idx === 1) {
          setStatus('UPS-B', 'failed');
          setStatus('CH-1', 'failed');
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
          scenarioRunning = false;
        }
      }, 300);
    }, at);
  });
}

export type { Anomaly };
