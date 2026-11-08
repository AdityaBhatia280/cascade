import { store } from '../db/store.js';
import type { RiskEntry, Simulation } from '../db/schema.js';
import { runSimulation } from '../engines/cascade.js';
import { computeRiskScores } from '../engines/risk.js';

export function simulateFailure(failedNodeId: string): Simulation {
  return runSimulation(failedNodeId);
}

export function rankRisk(): RiskEntry[] {
  return computeRiskScores();
}
