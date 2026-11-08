import { Router } from 'express';
import {
  seedPortfolio,
  getOverview,
  getGraph,
  getFindings,
  getSourceSnippet,
} from '../services/portfolio.js';
import {
  streamTelemetry,
  startTelemetryLoop,
  triggerScenario,
} from '../services/telemetry.js';
import { simulateFailure, rankRisk } from '../services/simulation.js';
import { streamAgent } from '../services/agent.js';
import {
  getModernizationStages,
  runParity,
  getEvalReport,
} from '../services/modernization.js';
import {
  createAction,
  approveAndExecuteAction,
  rejectPendingAction,
  getActions,
  createRetellWebCall,
} from '../services/actions.js';
import { repriceSimulations } from '../engines/cost.js';
import { store } from '../db/store.js';
import type { Assumptions } from '../db/schema.js';

export const apiRouter = Router();

// ── Overview & Graph ──

apiRouter.get('/overview', (_req, res) => {
  res.json(getOverview());
});

apiRouter.get('/graph', (_req, res) => {
  res.json(getGraph());
});

apiRouter.get('/source', (req, res) => {
  const file = String(req.query['file'] ?? '');
  const line = Number(req.query['line'] ?? 0);
  const snippet = getSourceSnippet(file, line);
  res.json(snippet);
});

apiRouter.get('/risk', (_req, res) => {
  res.json(rankRisk());
});

apiRouter.post('/portfolio/seed', async (_req, res) => {
  try {
    const summary = await seedPortfolio();
    startTelemetryLoop();
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Simulation ──

apiRouter.post('/simulate', (req, res) => {
  const body = req.body as { node_id?: string; nodeId?: string };
  const nodeId = body.node_id || body.nodeId;
  if (!nodeId) {
    res.status(400).json({ error: 'node_id is required' });
    return;
  }
  const sim = simulateFailure(nodeId);
  res.json(sim);
});

// ── Incidents & Scenario ──

apiRouter.get('/incidents', (_req, res) => {
  const sorted = [...store.incidents].sort((a, b) =>
    b.opened_at.localeCompare(a.opened_at),
  );
  res.json(sorted);
});

apiRouter.get('/incidents/:id', (req, res) => {
  const incident = store.getIncident(req.params['id'] ?? '');
  if (!incident) {
    res.json(null);
    return;
  }
  const simulation = incident.simulation_id
    ? store.getSimulation(incident.simulation_id) ?? null
    : null;
  const steps = incident.agent_run_id
    ? store.getStepsForRun(incident.agent_run_id)
    : [];
  const actions = incident.agent_run_id
    ? store.actions.filter((a) => a.run_id === incident.agent_run_id)
    : [];

  res.json({ incident, simulation, steps, actions });
});

apiRouter.post('/scenario/start', (req, res) => {
  const mode = req.query['mode'] === 'replay' ? 'replay' : 'live';
  triggerScenario(mode);
  res.json({ ok: true });
});

// ── Findings ──

apiRouter.get('/findings', (_req, res) => {
  res.json(getFindings());
});

// ── Actions & Work Orders ──

apiRouter.get('/actions', (req, res) => {
  const status = req.query['status'] as string | undefined;
  res.json(getActions(status as any));
});

apiRouter.post('/actions/:id/approve', async (req, res) => {
  const { content } = (req.body ?? {}) as { content?: string };
  const updated = await approveAndExecuteAction(req.params['id'] ?? '', content);
  if (!updated) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  res.json(updated);
});

apiRouter.post('/actions/:id/reject', (req, res) => {
  const updated = rejectPendingAction(req.params['id'] ?? '');
  if (!updated) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  res.json(updated);
});

apiRouter.post('/work-orders', (req, res) => {
  const { node_id, note } = (req.body ?? {}) as { node_id?: string; note?: string };
  if (!node_id) {
    res.status(400).json({ error: 'node_id is required' });
    return;
  }
  const action = createAction({
    run_id: 'manual',
    tool: 'create_work_order',
    recipient_display: 'facilities-ops@cascade-tower.example',
    content: `Work order for ${node_id}: ${note || 'Inspect component'}`,
    usd_impact: 0,
    risk: 'normal',
    requires_approval: true,
  });
  res.json(action);
});

// ── Modernization, Parity & Eval ──

apiRouter.get('/modernization', (_req, res) => {
  res.json(getModernizationStages());
});

apiRouter.post('/parity/run', (_req, res) => {
  res.json(runParity());
});

apiRouter.get('/eval', (_req, res) => {
  res.json(getEvalReport());
});

// ── Assumptions ──

apiRouter.get('/assumptions', (_req, res) => {
  res.json(store.assumptions);
});

apiRouter.put('/assumptions', (req, res) => {
  const incoming = req.body as Partial<Assumptions>;
  store.assumptions = {
    version: store.assumptions.version + 1,
    sla_credit_tiers: Array.isArray(incoming.sla_credit_tiers)
      ? incoming.sla_credit_tiers
      : store.assumptions.sla_credit_tiers,
    emergency_response_usd:
      typeof incoming.emergency_response_usd === 'number'
        ? incoming.emergency_response_usd
        : store.assumptions.emergency_response_usd,
    hardware_damage_usd:
      typeof incoming.hardware_damage_usd === 'number'
        ? incoming.hardware_damage_usd
        : store.assumptions.hardware_damage_usd,
    thermal_rise_c_per_min:
      typeof incoming.thermal_rise_c_per_min === 'number'
        ? incoming.thermal_rise_c_per_min
        : store.assumptions.thermal_rise_c_per_min,
  };
  repriceSimulations();
  res.json(store.assumptions);
});

// ── Telemetry & Agent Streams ──

apiRouter.get('/telemetry/points', (_req, res) => {
  res.json(
    store.telemetryPoints.map(({ baseline: _b, ...pt }) => pt),
  );
});

apiRouter.get('/telemetry/stream', (req, res) => {
  streamTelemetry(req, res);
});

apiRouter.get('/agent/stream', (req, res) => {
  streamAgent(req, res);
});

// ── Voice Web Call (Retell AI) ──

apiRouter.post('/voice/web-call', async (_req, res) => {
  try {
    const token = await createRetellWebCall();
    res.json(token);
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

// ── Health ──

apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    nodes: store.nodes.length,
    edges: store.edges.length,
    uptime: process.uptime(),
  });
});
