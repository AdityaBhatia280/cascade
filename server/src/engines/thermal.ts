import { store } from '../db/store.js';

export interface ThermalState {
  nodeId: string;
  currentTempC: number;
  maxTempC: number;
  coolingCapacityKw: number;
  heatLoadKw: number;
  timeToOverheatMin: number | null;
}

/**
 * Compute thermal model for utility nodes (cooling systems).
 * Stub: uses capacity_kw as cooling capacity and computes a simple thermal budget.
 */
export function computeThermalModel(): ThermalState[] {
  const utilities = store.getNodesByType('utility');
  const results: ThermalState[] = [];

  for (const node of utilities) {
    const coolingKw = node.capacity_kw || 100;
    // Sum heat load from all nodes this utility cools
    const cooledEdges = store.getEdgesFrom(node.id).filter((e) => e.kind === 'cools');
    let totalHeatKw = 0;

    for (const edge of cooledEdges) {
      const target = store.getNode(edge.target);
      if (target) {
        totalHeatKw += (target.capacity_kw || 10) * 0.3; // 30% of capacity as heat
      }
    }

    const surplus = coolingKw - totalHeatKw;
    const currentTemp = surplus > 0 ? 22 + (totalHeatKw / coolingKw) * 8 : 35 + Math.abs(surplus) * 0.5;
    const timeToOverheat = surplus <= 0 ? Math.max(5, 60 / (Math.abs(surplus) + 1)) : null;

    results.push({
      nodeId: node.id,
      currentTempC: Math.round(currentTemp * 10) / 10,
      maxTempC: 40,
      coolingCapacityKw: coolingKw,
      heatLoadKw: Math.round(totalHeatKw * 10) / 10,
      timeToOverheatMin: timeToOverheat ? Math.round(timeToOverheat) : null,
    });
  }

  return results;
}
