import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import type { Anomaly, NodeStatus, TelemetryReading } from '../db/schema.js';
import { startScenarioAgentRun } from './agent.js';

const sseClients: Set<Response> = new Set();

/**
 * SSE endpoint: GET /api/telemetry/stream
 * Streams `reading`, `anomaly`, and `node_status` events.
 */
export function streamTelemetry(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
}

export function broadcastTelemetryEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

export function emitNodeStatus(node_id: string, status: NodeStatus): void {
  store.updateNodeStatus(node_id, status);
  broadcastTelemetryEvent('node_status', { node_id, status });
}

// Overrides applied during a live scenario
const pointOverrides = new Map<string, number>();
const breachCounts = new Map<string, number>();

/**
 * EWMA anomaly detector:
 * Computes EWMA (alpha = 0.3) and rolling standard deviation over recent readings.
 * Also checks expected_min / expected_max bounds. Fires after 2+ consecutive samples with |z| > 3
 * or critical threshold excursion.
 */
export function checkTelemetryAnomaly(reading: TelemetryReading): Anomaly | null {
  const point = store.telemetryPoints.find((p) => p.id === reading.point_id);
  if (!point) return null;

  const history = store.getReadingsForPoint(reading.point_id, 30);
  if (history.length < 4) return null;

  const alpha = 0.3;
  let ewma = history[0]!.value;
  let variance = 0.05;

  for (let i = 0; i < history.length - 1; i++) {
    const val = history[i]!.value;
    const diff = val - ewma;
    ewma = alpha * val + (1 - alpha) * ewma;
    variance = alpha * diff * diff + (1 - alpha) * variance;
  }

  const stdDev = Math.max(0.05, Math.sqrt(variance));
  const zScore = Math.abs(reading.value - ewma) / stdDev;
  const outOfBounds =
    reading.value < point.expected_min || reading.value > point.expected_max;

  if (zScore > 3 && outOfBounds) {
    const count = (breachCounts.get(reading.point_id) ?? 0) + 1;
    breachCounts.set(reading.point_id, count);
    if (count >= 2) {
      breachCounts.set(reading.point_id, 0);
      const anomaly: Anomaly = {
        id: `ANOM-${uuid().slice(0, 8)}`,
        point_id: reading.point_id,
        ts: reading.ts,
        kind: 'threshold',
        severity: zScore > 5 ? 'critical' : 'warning',
        message: `${point.name} excursion: ${reading.value} ${point.unit} (expected ${point.expected_min}–${point.expected_max} ${point.unit}, z=${zScore.toFixed(1)})`,
      };
      store.addAnomaly(anomaly);
      broadcastTelemetryEvent('anomaly', anomaly);
      return anomaly;
    }
  } else {
    breachCounts.set(reading.point_id, 0);
  }

  return null;
}

let telemetryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the 2-second telemetry generation loop over all seeded telemetry points.
 */
export function startTelemetryLoop(): void {
  if (telemetryInterval) return;

  const tick = () => {
    const ts = new Date().toISOString();
    for (const p of store.telemetryPoints) {
      const base = pointOverrides.get(p.id) ?? p.baseline;
      const noiseScale = p.unit === 'L/min' ? 5 : p.unit === '%' ? 1.8 : 0.18;
      const noise = (Math.random() - 0.5) * noiseScale;
      const value = +(base + noise).toFixed(2);

      const reading: TelemetryReading = {
        point_id: p.id,
        ts,
        value,
        quality: 'ok',
      };

      store.addTelemetryReading(reading);
      broadcastTelemetryEvent('reading', reading);
      checkTelemetryAnomaly(reading);
    }
  };

  tick();
  telemetryInterval = setInterval(tick, 2000);
}

export function stopTelemetryLoop(): void {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
}

export function setPointOverride(pointId: string, value: number | null): void {
  if (value === null) pointOverrides.delete(pointId);
  else pointOverrides.set(pointId, value);
}

export function clearPointOverrides(): void {
  pointOverrides.clear();
  breachCounts.clear();
}

let activeScenarioTimer: ReturnType<typeof setTimeout>[] = [];

/**
 * Trigger the scripted incident scenario (`POST /api/scenario/start?mode=live|replay`).
 */
export function triggerScenario(mode: 'live' | 'replay'): void {
  for (const t of activeScenarioTimer) clearTimeout(t);
  activeScenarioTimer = [];

  // Reset node statuses and injected faults to healthy before starting
  clearPointOverrides();
  store.injectedFaults.clear();
  for (const n of store.nodes) {
    emitNodeStatus(n.id, 'healthy');
  }

  // Delegate the staged scenario + agent loop to agent service
  startScenarioAgentRun(mode);
}
