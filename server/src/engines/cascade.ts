import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import type { NodeStatus, Simulation, TenantImpact, TimelineEntry } from '../db/schema.js';
import { computeTenantSlaCredit } from './cost.js';

const PHYSICAL_EDGES = new Set(['powers', 'cools', 'network', 'contractual', 'feeds']);

/**
 * Deterministic time-stepped cascade simulator over verified edges.
 * - Propagates failures upstream -> downstream respecting edge.delay_min.
 * - Enforces k-of-n redundancy: a target with k_required > 1 (e.g., cooling_loop 2-of-3)
 *   only enters 'failed' when fewer than k_required upstream physical providers are healthy;
 *   if >= k_required remain healthy, losing an upstream unit marks the target 'degraded'.
 * - Excludes unverified edges (verified === false) from propagation and dollar totals.
 */
export function runSimulation(rootNodeId: string, prefailedNodeIds: string[] = []): Simulation {
  const verifiedEdges = store.edges.filter((e) => e.verified);
  const nodesMap = new Map(store.nodes.map((n) => [n.id, n]));

  const state = new Map<string, NodeStatus>();
  for (const id of prefailedNodeIds) {
    state.set(id, 'failed');
  }

  const timeline: TimelineEntry[] = [];
  state.set(rootNodeId, 'failed');

  const rootLabel = nodesMap.get(rootNodeId)?.label ?? rootNodeId;
  const prefailedDesc =
    prefailedNodeIds.length > 0
      ? ` (with ${prefailedNodeIds.join(', ')} already offline)`
      : '';

  timeline.push({
    t_min: 0,
    node_id: rootNodeId,
    state: 'failed',
    reason: `Initiating failure on ${rootLabel}${prefailedDesc}`,
  });

  const queue: { id: string; t: number }[] = [{ id: rootNodeId, t: 0 }];
  const rank: Record<NodeStatus, number> = { healthy: 0, degraded: 1, failed: 2 };

  while (queue.length > 0) {
    queue.sort((a, b) => a.t - b.t);
    const { id, t } = queue.shift()!;
    const srcState = state.get(id) ?? 'healthy';
    if (srcState === 'healthy') continue;

    const outEdges = verifiedEdges.filter((e) => e.source === id);
    for (const edge of outEdges) {
      const tgt = nodesMap.get(edge.target);
      if (!tgt) continue;

      const arrivalMin = t + (edge.delay_min ?? 0);
      let nextState: NodeStatus;

      if (PHYSICAL_EDGES.has(edge.kind)) {
        // Check all physical upstream edges feeding this target
        const upEdges = verifiedEdges.filter(
          (x) => x.target === edge.target && PHYSICAL_EDGES.has(x.kind),
        );
        // For multi-source redundancy (like cooling_loop with 3 chillers), check how many are not failed
        if (tgt.n_total > 1) {
          const healthyCount = upEdges.filter((u) => state.get(u.source) !== 'failed').length;
          nextState = healthyCount < tgt.k_required ? 'failed' : 'degraded';
        } else {
          // Single-required target: if the upstream source failed, target fails; if degraded, target degrades
          nextState = srcState === 'failed' ? 'failed' : 'degraded';
        }
      } else {
        // Software / billing / data coupling (reads, writes, bills, grants, shares, schedules)
        nextState = 'degraded';
      }

      const currentState = state.get(edge.target) ?? 'healthy';
      if (rank[nextState] <= rank[currentState]) continue;

      state.set(edge.target, nextState);
      const srcLabel = nodesMap.get(id)?.label ?? id;
      const reason =
        tgt.n_total > 1 && nextState === 'failed'
          ? `${srcLabel} ${edge.kind} ${tgt.label} — redundancy breached (< ${tgt.k_required} of ${tgt.n_total} healthy)`
          : `${srcLabel} ${edge.kind} ${tgt.label}`;

      timeline.push({
        t_min: arrivalMin,
        node_id: edge.target,
        state: nextState,
        reason,
      });

      queue.push({ id: edge.target, t: arrivalMin });
    }
  }

  timeline.sort((a, b) => a.t_min - b.t_min);

  // Compute per-tenant impacts
  const impacts: TenantImpact[] = [];
  const seenTenants = new Set<string>();

  for (const entry of timeline) {
    const node = nodesMap.get(entry.node_id);
    if (!node || node.type !== 'tenant' || seenTenants.has(node.id)) continue;
    seenTenants.add(node.id);

    // Thermal model for hall_200 if cooling failed
    let minutesToImpact = entry.t_min;
    if (node.id === 'hall_200' && entry.state === 'failed') {
      const riseRate = Math.max(0.1, store.assumptions.thermal_rise_c_per_min);
      const normalTemp = Number(node.metadata?.['normal_temp_c'] ?? 21.5);
      const maxTemp = Number(node.metadata?.['max_temp_c'] ?? 32.0);
      const thermalMinutes = Math.round((maxTemp - normalTemp) / riseRate);
      minutesToImpact = Math.max(entry.t_min, thermalMinutes);
    }

    const creditUsd = computeTenantSlaCredit(node, entry.state);
    impacts.push({
      tenant_id: node.id,
      tenant_label: node.label,
      minutes_to_impact: minutesToImpact,
      sla_credit_usd: creditUsd,
    });
  }

  const totalSlaCredits = impacts.reduce((sum, i) => sum + i.sla_credit_usd, 0);
  const hasPhysicalFailure = timeline.some(
    (t) => t.state === 'failed' && nodesMap.get(t.node_id)?.type !== 'module',
  );
  const emergencyCost = hasPhysicalFailure
    ? store.assumptions.emergency_response_usd + store.assumptions.hardware_damage_usd
    : 0;

  const sim: Simulation = {
    id: `SIM-${uuid().slice(0, 8)}`,
    root_node: rootNodeId,
    timeline,
    impacts,
    total_usd: Math.round((totalSlaCredits + emergencyCost) * 100) / 100,
    assumptions_version: store.assumptions.version,
  };

  store.addSimulation(sim);
  return sim;
}
