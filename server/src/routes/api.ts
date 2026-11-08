import { Router } from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  simulateFailure,
  rankRisk,
  applyCustomFaults,
  getCurrentWhatIf,
} from '../services/simulation.js';
import { streamAgent } from '../services/agent.js';
import {
  getModernizationStages,
  runParity,
  getEvalReport,
  getRealWorldBenchmarks,
} from '../services/modernization.js';
import {
  createAction,
  approveAndExecuteAction,
  rejectPendingAction,
  getActions,
  createRetellWebCall,
  createRetellPhoneCall,
  getRetellCallStatus,
  syncLatestRetellCalls,
  handleRetellWebhook,
  buildIcsAttachment,
  clearActions,
  deduplicateStoreHistory,
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

apiRouter.get('/what-if', (_req, res) => {
  res.json(getCurrentWhatIf());
});

apiRouter.post('/what-if', (req, res) => {
  const body = (req.body ?? {}) as { faults?: string[] };
  const faults = Array.isArray(body.faults) ? body.faults : [];
  res.json(applyCustomFaults(faults));
});

// ── Incidents & Scenario ──

apiRouter.get('/incidents', (_req, res) => {
  deduplicateStoreHistory();
  const sorted = [...store.incidents].sort((a, b) =>
    b.opened_at.localeCompare(a.opened_at),
  );
  res.json(sorted);
});

apiRouter.post('/incidents/clear', (req, res) => {
  const onlyResolved = req.query['resolved'] === 'true';
  if (onlyResolved) {
    store.incidents = store.incidents.filter((i) => i.status !== 'resolved');
  } else {
    store.incidents = [];
  }
  res.json(store.incidents);
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
  deduplicateStoreHistory();
  const status = req.query['status'] as string | undefined;
  res.json(getActions(status as any));
});

apiRouter.post('/actions/clear', (req, res) => {
  const onlyPending = req.query['pending'] === 'true';
  res.json(clearActions(onlyPending));
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

apiRouter.get('/actions/:id/ics', (req, res) => {
  const action = store.getAction(req.params['id'] ?? '');
  if (!action) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  const ics = buildIcsAttachment(
    `Cascade Maintenance — ${action.recipient_display}`,
    action.content,
  );
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cascade-${action.id}.ics"`);
  res.send(ics);
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

apiRouter.post('/parity/run', (req, res) => {
  const mode = req.query['mode'] === 'patched' ? 'patched' : 'strict';
  res.json(runParity(mode));
});

apiRouter.get('/eval', (_req, res) => {
  res.json(getEvalReport());
});

apiRouter.get('/benchmarks', (_req, res) => {
  res.json(getRealWorldBenchmarks());
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

// ── Voice Web Call & Outbound Phone Call (Retell AI) ──

apiRouter.post('/voice/web-call', async (req, res) => {
  try {
    const incidentId =
      typeof (req.body as { incident_id?: unknown })?.incident_id === 'string'
        ? (req.body as { incident_id: string }).incident_id
        : undefined;
    const token = await createRetellWebCall(incidentId);
    res.json(token);
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

apiRouter.post('/voice/phone-call', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { to_number?: unknown; incident_id?: unknown };
    const toNumber = typeof body.to_number === 'string' ? body.to_number : undefined;
    const incidentId = typeof body.incident_id === 'string' ? body.incident_id : undefined;
    const result = await createRetellPhoneCall(toNumber, incidentId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.get('/voice/call/:callId', async (req, res) => {
  try {
    const status = await getRetellCallStatus(req.params.callId);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.get('/voice/latest-call', async (_req, res) => {
  try {
    const latest = await syncLatestRetellCalls();
    res.json(latest ?? { call_id: null, call_status: 'idle', transcript: [] });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post('/retell/webhook', async (req, res) => {
  try {
    const result = await handleRetellWebhook((req.body ?? {}) as Record<string, unknown>);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Dynamic View (cascade-main 3D Floor Sub-App) ──

let dynamicProc: ChildProcess | null = null;
let dynamicState: 'stopped' | 'installing' | 'starting' | 'running' | 'error' = 'stopped';
let dynamicError: string | null = null;

async function probeDynamicUrl(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:5174', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

apiRouter.get('/dynamic-view/status', async (_req, res) => {
  const live = await probeDynamicUrl();
  if (live) dynamicState = 'running';
  res.json({
    state: dynamicState,
    url: 'http://127.0.0.1:5174/site?cam=3d',
    api_url: 'http://127.0.0.1:5002/api',
    error: dynamicError,
  });
});

apiRouter.post('/dynamic-view/start', async (_req, res) => {
  if (await probeDynamicUrl()) {
    dynamicState = 'running';
    res.json({ state: 'running', url: 'http://127.0.0.1:5174/site?cam=3d' });
    return;
  }

  if (dynamicState === 'installing' || dynamicState === 'starting') {
    res.json({ state: dynamicState, url: 'http://127.0.0.1:5174/site?cam=3d' });
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cascadeMainDir = path.resolve(__dirname, '../../../cascade-main/cascade-main');
  if (!fs.existsSync(cascadeMainDir)) {
    res.status(404).json({ error: 'cascade-main/cascade-main directory not found' });
    return;
  }

  dynamicError = null;
  const hasNodeModules = fs.existsSync(path.join(cascadeMainDir, 'node_modules'));

  const launchDev = () => {
    dynamicState = 'starting';
    dynamicProc = spawn('npm', ['run', 'dev'], {
      cwd: cascadeMainDir,
      shell: true,
      env: { ...process.env, DYNAMIC_PORT: '5002' },
      stdio: 'ignore',
    });
    dynamicProc.on('error', (err) => {
      dynamicState = 'error';
      dynamicError = err.message;
    });
  };

  if (!hasNodeModules) {
    dynamicState = 'installing';
    const installProc = spawn('npm', ['install'], {
      cwd: cascadeMainDir,
      shell: true,
      stdio: 'ignore',
    });
    installProc.on('close', (code) => {
      if (code === 0) {
        launchDev();
      } else {
        dynamicState = 'error';
        dynamicError = `npm install exited with code ${code}`;
      }
    });
  } else {
    launchDev();
  }

  res.json({ state: dynamicState, url: 'http://127.0.0.1:5174/site?cam=3d' });
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
