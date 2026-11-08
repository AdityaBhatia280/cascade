import { store } from '../db/store.js';
import type { Incident, RiskEntry, Simulation, WhatIfResult } from '../db/schema.js';
import { evaluateFaults, runSimulation } from '../engines/cascade.js';
import { computeRiskScores } from '../engines/risk.js';
import { emitNodeStatus, clearPointOverrides, broadcastTelemetryEvent } from './telemetry.js';
import { broadcastAgentEvent } from './agent.js';

export function nextIncidentId(): string {
  return store.nextId('INC', 1001);
}

const INCIDENT_TITLES: Record<string, string> = {
  'UPS-B': 'UPS Panel B power feed loss — Chiller 1 & CRAH-4 offline',
  'CH-1': 'Chiller 1 mechanical trip — Primary cooling loop capacity reduced',
  'CH-2': 'Chiller 2 compressor fault — Cooling loop redundancy degraded (2 of 3)',
  'CH-3': 'Chiller 3 condenser fault — Cooling loop redundancy degraded',
  'CRAH-4': 'CRAH Unit 4 air handler fault — Data Hall 200 airflow loss',
  'cooling_loop': 'Primary chilled water loop failure — Data Hall 200 thermal breach risk',
  'SW-03': 'BMS network switch SW-03 offline — Door controller CTL-04 unreachable',
  'work_orders': 'Work orders table trigger anomaly — Unreviewed badge access grant risk',
};

export function simulateFailure(failedNodeId: string): Simulation {
  const otherFaults = [...store.injectedFaults].filter((id) => id !== failedNodeId);
  return runSimulation(failedNodeId, otherFaults);
}

export function rankRisk(): RiskEntry[] {
  return computeRiskScores();
}

/**
 * Apply a custom set of injected faults to the live building graph, recomputing
 * all downstream node statuses (failed / degraded / healthy) via the deterministic
 * k-of-n cascade evaluator, syncing distinct Incident tickets per root fault, and broadcasting over SSE.
 */
export function applyCustomFaults(faults: string[], skipAutoIncident = false): WhatIfResult {
  store.injectedFaults = new Set(faults.filter((f) => store.getNode(f)));
  const result = evaluateFaults([...store.injectedFaults]);

  if (store.injectedFaults.size === 0) {
    clearPointOverrides();
    for (const inc of store.getOpenIncidents()) {
      inc.status = 'resolved';
      broadcastAgentEvent('incident', inc);
    }
  } else {
    // Resolve any open incidents whose root_node is no longer faulted
    for (const inc of store.getOpenIncidents()) {
      if (!store.injectedFaults.has(inc.root_node)) {
        inc.status = 'resolved';
        broadcastAgentEvent('incident', inc);
      }
    }

    // Ensure each active root fault has its own uniquely tagged Incident ticket (unless managed by scenario runner)
    if (!skipAutoIncident) {
      for (const rootId of store.injectedFaults) {
        const existingOpen = store.incidents.find(
          (i) => i.root_node === rootId && i.status !== 'resolved',
        );
        if (!existingOpen) {
          const nodeLabel = store.getNode(rootId)?.label ?? rootId;
          const otherFaults = [...store.injectedFaults].filter((f) => f !== rootId);
          const sim = runSimulation(rootId, otherFaults);
          const inc: Incident = {
            id: nextIncidentId(),
            title: INCIDENT_TITLES[rootId] ?? `${nodeLabel} failure — Downstream cascade risk`,
            root_node: rootId,
            status: 'open',
            opened_at: new Date().toISOString(),
            simulation_id: sim.id,
            agent_run_id: null,
          };
          store.addIncident(inc);
          broadcastAgentEvent('incident', inc);
        }
      }
    }
  }

  for (const node of store.nodes) {
    const nextStatus = result.statuses[node.id] ?? 'healthy';
    if (node.status !== nextStatus) {
      emitNodeStatus(node.id, nextStatus);
    } else {
      broadcastTelemetryEvent('node_status', { node_id: node.id, status: nextStatus });
    }
  }

  broadcastTelemetryEvent('what_if', result);
  return result;
}

export function getCurrentWhatIf(): WhatIfResult {
  return evaluateFaults([...store.injectedFaults]);
}
