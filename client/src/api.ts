import type {
  GraphNode,
  GraphEdge,
  Finding,
  AgentStep,
  Action,
  CascadeStep,
  ParityResult,
  EvalReport,
} from './types';

const BASE = '/api';

export async function fetchGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const res = await fetch(`${BASE}/graph`);
  if (!res.ok) throw new Error('Failed to fetch graph');
  return res.json();
}

export async function fetchFindings(): Promise<Finding[]> {
  const res = await fetch(`${BASE}/findings`);
  if (!res.ok) throw new Error('Failed to fetch findings');
  return res.json();
}

export async function simulateFailure(nodeId: string): Promise<{ steps: CascadeStep[]; totalCost: number }> {
  const res = await fetch(`${BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) throw new Error('Simulation failed');
  return res.json();
}

export async function runAgent(incidentId: string): Promise<any> {
  const res = await fetch(`${BASE}/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId }),
  });
  if (!res.ok) throw new Error('Agent run failed');
  return res.json();
}

export async function fetchLatestRun(): Promise<{ run: any; steps: AgentStep[] }> {
  const res = await fetch(`${BASE}/agent/latest`);
  if (!res.ok) throw new Error('Failed to fetch latest agent run');
  return res.json();
}

export async function fetchActions(status?: string): Promise<Action[]> {
  const url = status ? `${BASE}/actions?status=${status}` : `${BASE}/actions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch actions');
  return res.json();
}

export async function approveAction(actionId: string): Promise<Action> {
  const res = await fetch(`${BASE}/actions/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId }),
  });
  if (!res.ok) throw new Error('Failed to approve action');
  return res.json();
}

export async function rejectAction(actionId: string): Promise<Action> {
  const res = await fetch(`${BASE}/actions/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId }),
  });
  if (!res.ok) throw new Error('Failed to reject action');
  return res.json();
}

export async function runParity(runId: string): Promise<ParityResult[]> {
  const res = await fetch(`${BASE}/parity/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) throw new Error('Failed to run parity tests');
  return res.json();
}

export async function fetchEvalReport(): Promise<EvalReport> {
  const res = await fetch(`${BASE}/eval`);
  if (!res.ok) throw new Error('Failed to fetch eval report');
  return res.json();
}

export async function fetchRemediation(findingId: string): Promise<{
  explanation: string;
  typescript_fix: string;
  tests: string;
}> {
  const res = await fetch(`${BASE}/remediation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingId }),
  });
  if (!res.ok) throw new Error('Failed to fetch remediation');
  return res.json();
}

