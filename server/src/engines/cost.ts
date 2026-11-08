import { store } from '../db/store.js';
import type { Node, NodeStatus } from '../db/schema.js';

/**
 * Compute SLA credit in USD for an affected tenant using the active Assumptions tiers.
 * Note: pct_of_monthly_fee in store.assumptions is already a decimal (0.05 .. 0.30).
 */
export function computeTenantSlaCredit(tenant: Node, state: NodeStatus): number {
  if (state === 'healthy' || tenant.monthly_fee_usd <= 0) return 0;

  const tiers = [...store.assumptions.sla_credit_tiers].sort(
    (a, b) => a.max_minutes - b.max_minutes,
  );
  if (tiers.length === 0) return 0;

  // For a full cooling / critical SLA failure (e.g., hall_200), assume a 240-minute (Tier 2/3)
  // or highest applicable tier; for degraded software/billing, use the lowest tier.
  const assumedOutageMinutes =
    state === 'failed' ? (tenant.sla_target_pct >= 99.99 ? 500 : 180) : 45;

  const matchedTier =
    tiers.find((t) => assumedOutageMinutes <= t.max_minutes) ?? tiers[tiers.length - 1]!;

  return Math.round(tenant.monthly_fee_usd * matchedTier.pct_of_monthly_fee * 100) / 100;
}

/**
 * Re-price all existing simulations in the store when Assumptions are updated.
 */
export function repriceSimulations(): void {
  for (const sim of store.simulations) {
    let totalCredits = 0;
    for (const imp of sim.impacts) {
      const node = store.getNode(imp.tenant_id);
      const tlEntry = sim.timeline.find((t) => t.node_id === imp.tenant_id);
      if (node && tlEntry) {
        if (node.id === 'hall_200' && tlEntry.state === 'failed') {
          const riseRate = Math.max(0.1, store.assumptions.thermal_rise_c_per_min);
          const normalTemp = Number(node.metadata?.['normal_temp_c'] ?? 21.5);
          const maxTemp = Number(node.metadata?.['max_temp_c'] ?? 32.0);
          imp.minutes_to_impact = Math.max(
            tlEntry.t_min,
            Math.round((maxTemp - normalTemp) / riseRate),
          );
        }
        imp.sla_credit_usd = computeTenantSlaCredit(node, tlEntry.state);
        totalCredits += imp.sla_credit_usd;
      }
    }
    const hasPhysicalFailure = sim.timeline.some(
      (t) => t.state === 'failed' && store.getNode(t.node_id)?.type !== 'module',
    );
    const emergencyCost = hasPhysicalFailure
      ? store.assumptions.emergency_response_usd + store.assumptions.hardware_damage_usd
      : 0;
    sim.total_usd = Math.round((totalCredits + emergencyCost) * 100) / 100;
    sim.assumptions_version = store.assumptions.version;
  }
}
