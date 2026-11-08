import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import type {
  NodeStatus,
  Simulation,
  TenantImpact,
  TimelineEntry,
  WhatIfResult,
} from '../db/schema.js';
import { computeTenantSlaCredit } from './cost.js';

/** Edges that carry physical supply (power, cooling, network) or contractual obligations. */
const PHYSICAL_EDGES = new Set(['powers', 'cools', 'network', 'contractual', 'feeds']);
/** Node categories whose degraded state means "bad data" and therefore propagates downstream. */
const DATA_CATEGORIES = new Set(['legacy', 'data']);

const rank: Record<NodeStatus, number> = { healthy: 0, degraded: 1, failed: 2 };

interface Evaluation {
  statuses: Map<string, NodeStatus>;
  reasons: Map<string, string>;
  times: Map<string, number>;
}

/**
 * Deterministic steady-state evaluation of the dependency graph for a set of injected faults.
 * Uses verified edges only (unverified AI hypotheses never move dollars or states).
 *
 * Rules (upstream -> downstream):
 * - Physical supply (powers / cools / network / feeds / contractual): a node needs at least
 *   k_required healthy providers (capped at the number of providers it has). Fewer -> failed.
 *   Enough but some lost -> degraded (redundancy consumed). A degraded node still delivers service,
 *   so physical degradation does not propagate, except to SLA nodes via contractual edges (at risk).
 * - Data coupling (reads / writes / bills / shares / schedules / grants): if the source is failed,
 *   or is a degraded software/data node, the target is degraded (data integrity at risk).
 * - Restoring a fault simply re-evaluates: anything that no longer has a failed path recovers.
 */
function evaluate(faults: string[]): Evaluation {
  const nodes = store.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = store.edges.filter(
    (e) => e.verified && byId.has(e.source) && byId.has(e.target),
  );
  const faultSet = new Set(faults.filter((f) => byId.has(f)));
  const label = (id: string) => byId.get(id)?.label ?? id;

  const statuses = new Map<string, NodeStatus>();
  const reasons = new Map<string, string>();
  for (const n of nodes) statuses.set(n.id, 'healthy');
  for (const f of faultSet) {
    statuses.set(f, 'failed');
    reasons.set(f, 'Fault injected');
  }

  for (let iter = 0; iter < nodes.length + 2; iter++) {
    let changed = false;

    for (const n of nodes) {
      if (faultSet.has(n.id)) continue;

      const incoming = edges.filter((e) => e.target === n.id);
      const phys = incoming.filter((e) => PHYSICAL_EDGES.has(e.kind));
      const soft = incoming.filter((e) => !PHYSICAL_EDGES.has(e.kind));

      let next: NodeStatus = 'healthy';
      let reason = '';

      if (phys.length > 0) {
        const failedUp = phys.filter((e) => statuses.get(e.source) === 'failed');
        const healthyCount = phys.length - failedUp.length;
        const requiredK = n.id === 'hall_200' ? 2 : n.k_required;
        const need = Math.min(Math.max(1, requiredK), phys.length);
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
          const atRisk = phys.find(
            (e) => e.kind === 'contractual' && statuses.get(e.source) === 'degraded',
          );
          if (atRisk) {
            next = 'degraded';
            reason = `At risk: ${label(atRisk.source)} is running with reduced redundancy`;
          }
        }
      }

      if (next === 'healthy' && soft.length > 0) {
        const impaired = soft.filter((e) => {
          const s = statuses.get(e.source);
          const src = byId.get(e.source)!;
          return s === 'failed' || (s === 'degraded' && DATA_CATEGORIES.has(src.category));
        });
        if (impaired.length > 0) {
          next = 'degraded';
          reason = `Data dependency impaired: ${impaired
            .map((e) => `${label(e.source)} (${e.kind})`)
            .join(', ')}`;
        }
      }

      if (statuses.get(n.id) !== next) {
        statuses.set(n.id, next);
        changed = true;
      }
      if (next === 'healthy') reasons.delete(n.id);
      else reasons.set(n.id, reason);
    }

    if (!changed) break;
  }

  // Earliest arrival time (minutes) through affected nodes, honoring edge.delay_min (minimum 1 min per hop for visible cascade progression).
  const times = new Map<string, number>();
  for (const f of faultSet) times.set(f, 0);
  for (let iter = 0; iter < nodes.length + 2; iter++) {
    let changed = false;
    for (const e of edges) {
      const ts = times.get(e.source);
      if (ts === undefined) continue;
      if (statuses.get(e.target) === 'healthy') continue;
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

  return { statuses, reasons, times };
}

function thermalMinutes(nodeId: string, fallbackMin: number): number {
  const node = store.getNode(nodeId);
  if (!node) return fallbackMin;
  const riseRate = Math.max(0.1, store.assumptions.thermal_rise_c_per_min);
  const normalTemp = Number(node.metadata?.['normal_temp_c'] ?? 21.5);
  const maxTemp = Number(node.metadata?.['max_temp_c'] ?? 32.0);
  return Math.max(fallbackMin, Math.round((maxTemp - normalTemp) / riseRate));
}

function buildImpacts(ev: Evaluation): TenantImpact[] {
  const impacts: TenantImpact[] = [];
  for (const node of store.nodes) {
    if (node.type !== 'tenant') continue;
    const state = ev.statuses.get(node.id) ?? 'healthy';
    if (state === 'healthy') continue;
    const t = ev.times.get(node.id) ?? 0;
    const isThermal = state === 'failed' && node.metadata?.['max_temp_c'] !== undefined;
    impacts.push({
      tenant_id: node.id,
      tenant_label: node.label,
      minutes_to_impact: isThermal ? thermalMinutes(node.id, t) : t,
      // Only a real service failure triggers an SLA credit; data-integrity risk does not.
      sla_credit_usd: state === 'failed' ? computeTenantSlaCredit(node, state) : 0,
    });
  }
  return impacts.sort((a, b) => a.minutes_to_impact - b.minutes_to_impact);
}

function totalUsd(ev: Evaluation, impacts: TenantImpact[]): number {
  const credits = impacts.reduce((s, i) => s + i.sla_credit_usd, 0);
  const physicalFailure = store.nodes.some(
    (n) => ev.statuses.get(n.id) === 'failed' && n.type !== 'module',
  );
  const emergency = physicalFailure
    ? store.assumptions.emergency_response_usd + store.assumptions.hardware_damage_usd
    : 0;
  return Math.round((credits + emergency) * 100) / 100;
}

/**
 * What-if sandbox: evaluate an arbitrary set of injected faults without touching live state.
 */
export function evaluateFaults(faults: string[]): WhatIfResult {
  const ev = evaluate(faults);
  const timeline: TimelineEntry[] = store.nodes
    .filter((n) => ev.statuses.get(n.id) !== 'healthy')
    .map((n) => ({
      t_min: ev.times.get(n.id) ?? 0,
      node_id: n.id,
      state: ev.statuses.get(n.id)!,
      reason: ev.reasons.get(n.id) ?? '',
    }))
    .sort((a, b) => a.t_min - b.t_min || rank[b.state] - rank[a.state]);

  const impacts = buildImpacts(ev);
  const statuses: Record<string, NodeStatus> = {};
  const reasons: Record<string, string> = {};
  for (const [k, v] of ev.statuses) statuses[k] = v;
  for (const [k, v] of ev.reasons) reasons[k] = v;

  return {
    faults: faults.filter((f) => store.getNode(f)),
    statuses,
    reasons,
    timeline,
    impacts,
    total_usd: totalUsd(ev, impacts),
    failed_count: timeline.filter((t) => t.state === 'failed').length,
    degraded_count: timeline.filter((t) => t.state === 'degraded').length,
    assumptions_version: store.assumptions.version,
  };
}

/**
 * Failure simulation used by "Simulate failure" and the incident agent.
 * Built on the same evaluator as the what-if sandbox so both always agree.
 */
export function runSimulation(rootNodeId: string, prefailedNodeIds: string[] = []): Simulation {
  const ev = evaluate([rootNodeId, ...prefailedNodeIds]);
  const prefailed = new Set(prefailedNodeIds);
  const rootLabel = store.getNode(rootNodeId)?.label ?? rootNodeId;

  const timeline: TimelineEntry[] = store.nodes
    .filter((n) => ev.statuses.get(n.id) !== 'healthy')
    .map((n) => {
      let reason = ev.reasons.get(n.id) ?? '';
      if (n.id === rootNodeId) reason = `Initiating failure on ${rootLabel}`;
      else if (prefailed.has(n.id)) reason = 'Already offline before this event';
      return {
        t_min: ev.times.get(n.id) ?? 0,
        node_id: n.id,
        state: ev.statuses.get(n.id)!,
        reason,
      };
    })
    .sort(
      (a, b) =>
        a.t_min - b.t_min ||
        (a.node_id === rootNodeId ? -1 : b.node_id === rootNodeId ? 1 : 0) ||
        rank[b.state] - rank[a.state],
    );

  const impacts = buildImpacts(ev);
  const sim: Simulation = {
    id: `SIM-${uuid().slice(0, 8)}`,
    root_node: rootNodeId,
    timeline,
    impacts,
    total_usd: totalUsd(ev, impacts),
    assumptions_version: store.assumptions.version,
  };

  store.addSimulation(sim);
  return sim;
}
