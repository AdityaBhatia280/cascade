import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import { config } from '../config.js';
import type { AgentRun, AgentStep, Incident, Simulation, Stage } from '../db/schema.js';
import { runSimulation } from '../engines/cascade.js';
import { createAction } from './actions.js';
import { broadcastTelemetryEvent, emitNodeStatus, setPointOverride } from './telemetry.js';

const agentSseClients: Set<Response> = new Set();

/**
 * SSE endpoint: GET /api/agent/stream
 * Streams `incident`, `simulation`, `step`, `action_pending`, `action_updated`, and `run_complete` events.
 */
export function streamAgent(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  agentSseClients.add(res);

  req.on('close', () => {
    agentSseClients.delete(res);
  });
}

export function broadcastAgentEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of agentSseClients) {
    client.write(payload);
  }
}

interface NemotronPlanResult {
  planSummary: string;
  acmeEmailBody: string;
  vendorInviteBody: string;
  modelUsed: string;
  latencyMs: number;
}

/**
 * Call NVIDIA Nemotron via the OpenAI-compatible integrate.api.nvidia.com endpoint.
 * Includes automatic fallback to MODEL_FAST on 429/timeout and deterministic fallback if key is unset.
 */
async function callNemotronPlanner(sim: Simulation): Promise<NemotronPlanResult> {
  const fallback: NemotronPlanResult = {
    planSummary:
      'Plan: simulate cascade from UPS-B (with CH-2 already offline), price Acme Cloud 99.99% SLA exposure, and stage tenant & vendor notifications behind human approval.',
    acmeEmailBody:
      'Cooling capacity for Data hall 200 is reduced after a UPS-B power event tripped Chiller 1 and CRAH-4 (with Chiller 2 already offline). Hall 200 reaches its 32°C thermal SLA limit in ~4 minutes. Our engineering team is executing emergency mitigation and will brief you shortly.',
    vendorInviteBody:
      'Calendar invite: Emergency dispatch for Chiller 1 (UPS-B control feed trip) and Chiller 2 at Cascade Tower — Basement 2 Mech Room, Chicago, IL.',
    modelUsed: config.nvidia.modelPlanner,
    latencyMs: 380,
  };

  if (!config.nvidia.apiKey) {
    return fallback;
  }

  const modelsToTry = [config.nvidia.modelPlanner, config.nvidia.modelFast];
  const systemPrompt = [
    'You are Cascade, an autonomous operations agent for Cascade Tower (Chicago, IL).',
    'Return ONLY valid JSON with keys: "planSummary", "acmeEmailBody", "vendorInviteBody".',
    'Keep each field concise (1-2 sentences), factual, and grounded in the simulation data.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    event: 'UPS-B power quality event tripped CH-1 and CRAH-4 while CH-2 was already offline.',
    redundancy: 'cooling_loop requires 2 of 3 chillers; only CH-3 remains healthy.',
    simulation_id: sim.id,
    impacts: sim.impacts,
    total_usd_at_risk: sim.total_usd,
  });

  for (const model of modelsToTry) {
    const startMs = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);

      const res = await fetch(`${config.nvidia.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.nvidia.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 450,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startMs;

      if (res.status === 429) {
        continue; // Backoff to MODEL_FAST
      }
      if (!res.ok) {
        continue;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content ?? '';
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<NemotronPlanResult>;
        return {
          planSummary:
            typeof parsed.planSummary === 'string' && parsed.planSummary.length > 10
              ? parsed.planSummary
              : fallback.planSummary,
          acmeEmailBody:
            typeof parsed.acmeEmailBody === 'string' && parsed.acmeEmailBody.length > 10
              ? parsed.acmeEmailBody
              : fallback.acmeEmailBody,
          vendorInviteBody:
            typeof parsed.vendorInviteBody === 'string' && parsed.vendorInviteBody.length > 10
              ? parsed.vendorInviteBody
              : fallback.vendorInviteBody,
          modelUsed: model,
          latencyMs,
        };
      }
    } catch {
      // Try next model or fall back cleanly
    }
  }

  return fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let scenarioActive = false;

/**
 * Executes the full incident scenario and Nemotron agent loop:
 * 1. Step 1 (refine / detect_anomaly): CH-2 trips -> 2 of 3 chillers running -> cooling_loop degraded, no cascade.
 * 2. Step 2 (refine / detect_anomaly): UPS-B power event trips CH-1 & CRAH-4 -> 1 of 3 chillers running (< 2 required) -> Incident opened!
 * 3. Step 3 (plan / plan_response): Nemotron plans the response.
 * 4. Step 4 (map / simulate_cascade): Deterministic cascade simulation runs from UPS-B (with CH-2 pre-failed).
 * 5. Step 5 (plan / price_impact): SLA credit & emergency response costs computed.
 * 6. Step 6 (assemble / send_email): Proposes Acme Cloud notification (awaiting human approval).
 * 7. Step 7 (assemble / schedule_maintenance): Proposes chiller vendor calendar invite (awaiting human approval).
 */
export async function startScenarioAgentRun(mode: 'live' | 'replay'): Promise<void> {
  if (scenarioActive) return;
  scenarioActive = true;

  const runId = `RUN-${uuid().slice(0, 8)}`;
  const incId = `INC-${uuid().slice(0, 8)}`;

  const run: AgentRun = {
    id: runId,
    incident_id: incId,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'running',
    total_llm_calls: 0,
    total_tokens: 0,
  };
  store.addAgentRun(run);

  const emitStep = async (
    idx: number,
    stage: Stage,
    tool: string,
    summary: string,
    args: Record<string, unknown>,
    model: string,
    workFn: () => Promise<{
      resultSummary: string;
      finalStatus?: AgentStep['status'];
      latencyMs?: number;
      modelOverride?: string;
    }>,
  ) => {
    const step: AgentStep = {
      id: `${runId}-S${idx + 1}`,
      run_id: runId,
      idx,
      stage,
      tool,
      summary,
      args,
      result_summary: '',
      status: 'running',
      latency_ms: 0,
      model,
      created_at: new Date().toISOString(),
    };
    store.upsertAgentStep(step);
    broadcastAgentEvent('step', step);

    const t0 = Date.now();
    const res = await workFn();
    step.status = res.finalStatus ?? 'done';
    step.result_summary = res.resultSummary;
    step.latency_ms = res.latencyMs ?? Math.max(120, Date.now() - t0);
    if (res.modelOverride) step.model = res.modelOverride;

    store.upsertAgentStep(step);
    broadcastAgentEvent('step', step);
  };

  try {
    await sleep(400);

    // Step 0: CH-2 trips -> 2-of-3 chillers remain healthy -> cooling_loop is degraded, NO cascade
    await emitStep(
      0,
      'refine',
      'detect_anomaly',
      'CH-2 tripped. 2 of 3 chillers still running; loop is degraded, no cascade.',
      { point_id: 'PT-CH2-TEMP', value_c: 14.8, k_required: 2, healthy_chillers: 2 },
      'engine/anomaly',
      async () => {
        setPointOverride('PT-CH2-TEMP', 14.8);
        setPointOverride('PT-LOOP-FLOW', 265);
        emitNodeStatus('CH-2', 'failed');
        emitNodeStatus('cooling_loop', 'degraded');
        await sleep(500);
        return {
          resultSummary: '2 of 3 chillers active (k_required = 2). Redundancy holding.',
          latencyMs: 180,
        };
      },
    );

    await sleep(700);

    // Step 1: UPS-B power event trips CH-1 (and CRAH-4) -> only 1 of 3 chillers running -> Incident opens!
    let incident: Incident | null = null;
    await emitStep(
      1,
      'refine',
      'detect_anomaly',
      'UPS-B power event tripped CH-1. 1 of 3 chillers running, 2 required. Incident opened.',
      {
        point_id: 'PT-CH1-TEMP',
        value_c: 15.6,
        hall_temp_c: 28.4,
        ups_b_load_pct: 0,
        healthy_chillers: 1,
        k_required: 2,
      },
      'engine/anomaly',
      async () => {
        setPointOverride('PT-UPSB-LOAD', 0);
        setPointOverride('PT-CH1-TEMP', 15.6);
        setPointOverride('PT-LOOP-FLOW', 110);
        setPointOverride('PT-HALL-TEMP', 28.4);

        emitNodeStatus('UPS-B', 'failed');
        emitNodeStatus('CH-1', 'failed');
        emitNodeStatus('CRAH-4', 'failed');
        emitNodeStatus('cooling_loop', 'failed');
        emitNodeStatus('hall_200', 'failed');
        emitNodeStatus('acme_sla', 'failed');

        const anomaly = {
          id: `ANOM-${uuid().slice(0, 8)}`,
          point_id: 'PT-HALL-TEMP',
          ts: new Date().toISOString(),
          kind: 'threshold' as const,
          severity: 'critical' as const,
          message:
            'Hall 200 inlet temp critical excursion (28.4 °C, expected 20–24 °C) after UPS-B & CH-1 trip',
        };
        store.addAnomaly(anomaly);
        broadcastTelemetryEvent('anomaly', anomaly);

        incident = {
          id: incId,
          title: 'Chiller failures — Data hall 200 cooling at risk',
          root_node: 'UPS-B',
          status: 'open',
          opened_at: new Date().toISOString(),
          simulation_id: null,
          agent_run_id: runId,
        };
        store.addIncident(incident);
        broadcastAgentEvent('incident', incident);

        await sleep(450);
        return {
          resultSummary: `Opened incident ${incId} (root: UPS-B)`,
          latencyMs: 240,
        };
      },
    );

    await sleep(500);

    // Pre-compute deterministic simulation so Nemotron planner has exact figures
    const sim = runSimulation('UPS-B', ['CH-2']);

    // Step 2: Nemotron Plan
    let planResult: NemotronPlanResult = {
      planSummary: 'Plan: simulate cascade from UPS-B, price impact, propose notifications.',
      acmeEmailBody:
        'Cooling capacity for Data hall 200 is reduced after a UPS-B power event tripped Chiller 1 (Chiller 2 already offline). Our team is responding and will brief you shortly.',
      vendorInviteBody:
        'Calendar invite: emergency service for Chiller 1 and Chiller 2 at Cascade Tower — Chicago, IL.',
      modelUsed: config.nvidia.modelPlanner,
      latencyMs: 320,
    };

    await emitStep(
      2,
      'plan',
      'plan_response',
      'Plan: simulate cascade from UPS-B, price impact, propose notifications.',
      { incident_id: incId, root_node: 'UPS-B', prefailed: ['CH-2'], mode },
      config.nvidia.modelPlanner,
      async () => {
        if (mode === 'live') {
          planResult = await callNemotronPlanner(sim);
          run.total_llm_calls += 1;
        } else {
          await sleep(350);
        }
        return {
          resultSummary: planResult.planSummary,
          latencyMs: planResult.latencyMs,
          modelOverride: planResult.modelUsed,
        };
      },
    );

    await sleep(500);

    // Step 3: Map / Simulate Cascade
    await emitStep(
      3,
      'map',
      'simulate_cascade',
      'Hall 200 reaches its thermal limit in about 4 minutes. LEASEBIL will apply an SLA credit on the next billing run.',
      { root_node: 'UPS-B', prefailed: ['CH-2'] },
      'engine/cascade',
      async () => {
        if (incident) {
          incident.simulation_id = sim.id;
          broadcastAgentEvent('simulation', sim);
          broadcastAgentEvent('incident', incident);
        }
        await sleep(400);
        return {
          resultSummary: `${sim.timeline.length} nodes affected across physical & COBOL billing layers`,
          latencyMs: 210,
        };
      },
    );

    await sleep(500);

    // Step 4: Plan / Price Impact
    const acmeImpact = sim.impacts.find((i) => i.tenant_id === 'hall_200');
    const acmeCredit = acmeImpact?.sla_credit_usd ?? 13500;
    await emitStep(
      4,
      'plan',
      'price_impact',
      'Acme Cloud SLA credit and response costs computed (illustrative).',
      { simulation_id: sim.id, assumptions_version: store.assumptions.version },
      'engine/cost',
      async () => {
        await sleep(350);
        return {
          resultSummary: `Total exposure $${sim.total_usd.toLocaleString()} (Acme SLA credit $${acmeCredit.toLocaleString()})`,
          latencyMs: 190,
        };
      },
    );

    await sleep(500);

    // Step 5: Assemble / send_email (Human-in-the-loop approval gate)
    await emitStep(
      5,
      'assemble',
      'send_email',
      'Notify Acme Cloud facilities of predicted cooling impact.',
      { recipient: 'facilities@acme-cloud.example', sla_credit_usd: acmeCredit },
      planResult.modelUsed,
      async () => {
        await sleep(300);
        createAction({
          run_id: runId,
          tool: 'send_email',
          recipient_display: 'facilities@acme-cloud.example',
          content: planResult.acmeEmailBody,
          usd_impact: acmeCredit,
          risk: 'normal',
          requires_approval: true,
        });
        return {
          resultSummary: 'Awaiting human approval',
          finalStatus: 'awaiting_approval',
          latencyMs: 260,
        };
      },
    );

    await sleep(500);

    // Step 6: Assemble / schedule_maintenance (Human-in-the-loop approval gate)
    await emitStep(
      6,
      'assemble',
      'schedule_maintenance',
      'Send calendar invite to chiller vendor for emergency service.',
      {
        recipient: 'chiller-vendor@example.com',
        equipment: ['CH-1', 'CH-2', 'UPS-B'],
        emergency_response_usd: store.assumptions.emergency_response_usd,
      },
      planResult.modelUsed,
      async () => {
        await sleep(300);
        createAction({
          run_id: runId,
          tool: 'schedule_maintenance',
          recipient_display: 'chiller-vendor@example.com',
          content: planResult.vendorInviteBody,
          usd_impact: store.assumptions.emergency_response_usd,
          risk: 'normal',
          requires_approval: true,
        });
        return {
          resultSummary: 'Awaiting human approval',
          finalStatus: 'awaiting_approval',
          latencyMs: 250,
        };
      },
    );

    if (incident) {
      (incident as Incident).status = 'mitigating';
      broadcastAgentEvent('incident', incident);
    }

    run.status = 'completed';
    run.completed_at = new Date().toISOString();
    broadcastAgentEvent('run_complete', { run_id: runId, status: 'completed' });
  } finally {
    scenarioActive = false;
  }
}
