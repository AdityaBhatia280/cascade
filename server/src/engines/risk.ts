import { store } from '../db/store.js';
import type { RiskEntry } from '../db/schema.js';

/**
 * Compute normalized 0..1 risk scores and factor breakdowns for all nodes.
 * Factors:
 * - blast_radius (0..1): transitive verified downstream node count / total nodes
 * - dollars_at_risk (0..1): transitive downstream tenant monthly fees / total portfolio monthly fees
 * - fragility (0..1): inverse redundancy margin (k_required / n_total) weighted by SLA stringency
 */
export function computeRiskScores(): RiskEntry[] {
  const verifiedEdges = store.edges.filter((e) => e.verified);
  const totalNodes = Math.max(1, store.nodes.length - 1);
  const totalMonthlyFee = Math.max(
    1,
    store.nodes.filter((n) => n.type === 'tenant').reduce((s, n) => s + n.monthly_fee_usd, 0),
  );

  const entries: RiskEntry[] = [];

  for (const node of store.nodes) {
    // Find all transitive downstream nodes via verified edges
    const visited = new Set<string>();
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of verifiedEdges) {
        if (e.source === cur && !visited.has(e.target)) {
          visited.add(e.target);
          queue.push(e.target);
        }
      }
    }
    visited.delete(node.id);

    const blastRadius = Math.min(1, +(visited.size / Math.min(8, totalNodes)).toFixed(2));

    let downstreamFee = node.type === 'tenant' ? node.monthly_fee_usd : 0;
    for (const depId of visited) {
      const dep = store.getNode(depId);
      if (dep?.type === 'tenant') {
        downstreamFee += dep.monthly_fee_usd;
      }
    }
    const dollarsAtRisk = Math.min(1, +(downstreamFee / totalMonthlyFee).toFixed(2));

    const ratio = node.n_total > 0 ? node.k_required / node.n_total : 1;
    const slaFactor = node.sla_target_pct >= 99.99 ? 1.0 : node.sla_target_pct >= 99.9 ? 0.85 : 0.7;
    const fragility = Math.min(1, +(ratio * slaFactor).toFixed(2));

    // Preserve the seeded risk_score if already in 0..1, or compute weighted average
    const computedScore = +(
      0.35 * blastRadius +
      0.35 * dollarsAtRisk +
      0.30 * fragility
    ).toFixed(2);

    const riskScore =
      node.risk_score > 0 && node.risk_score <= 1 ? node.risk_score : computedScore;
    node.risk_score = riskScore;

    entries.push({
      node_id: node.id,
      label: node.label,
      risk_score: riskScore,
      factors: {
        blast_radius: blastRadius,
        dollars_at_risk: dollarsAtRisk,
        fragility,
      },
    });
  }

  return entries.sort((a, b) => b.risk_score - a.risk_score);
}
