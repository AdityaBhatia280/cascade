import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SourceFile,
  Node,
  Edge,
  LeaseTerm,
  TelemetryPoint,
  TelemetryReading,
  Anomaly,
  Incident,
  Simulation,
  Finding,
  AgentRun,
  AgentStep,
  Action,
  ParityCase,
  ParityResult,
  GroundTruthEdge,
  Assumptions,
} from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE_PATH = path.resolve(__dirname, '../../data/cascade-db.json');

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  version: 1,
  sla_credit_tiers: [
    { max_minutes: 60, pct_of_monthly_fee: 0.05 },
    { max_minutes: 240, pct_of_monthly_fee: 0.1 },
    { max_minutes: 480, pct_of_monthly_fee: 0.2 },
    { max_minutes: 10080, pct_of_monthly_fee: 0.3 },
  ],
  emergency_response_usd: 2500,
  hardware_damage_usd: 0,
  thermal_rise_c_per_min: 2.6,
};

class Store {
  sourceFiles: SourceFile[] = [];
  nodes: Node[] = [];
  edges: Edge[] = [];
  leaseTerms: LeaseTerm[] = [];
  telemetryPoints: TelemetryPoint[] = [];
  telemetryReadings: TelemetryReading[] = [];
  anomalies: Anomaly[] = [];
  incidents: Incident[] = [];
  simulations: Simulation[] = [];
  findings: Finding[] = [];
  agentRuns: AgentRun[] = [];
  agentSteps: AgentStep[] = [];
  actions: Action[] = [];
  parityCases: ParityCase[] = [];
  parityResults: ParityResult[] = [];
  groundTruthEdges: GroundTruthEdge[] = [];
  assumptions: Assumptions = structuredClone(DEFAULT_ASSUMPTIONS);
  injectedFaults: Set<string> = new Set();

  // ── Node helpers ──

  addNode(node: Node): void {
    this.nodes.push(node);
  }

  getNode(id: string): Node | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  getNodesByType(type: Node['type']): Node[] {
    return this.nodes.filter((n) => n.type === type);
  }

  updateNodeStatus(id: string, status: Node['status']): void {
    const node = this.getNode(id);
    if (node) node.status = status;
  }

  // ── Edge helpers ──

  addEdge(edge: Edge): void {
    this.edges.push(edge);
  }

  getEdge(id: string): Edge | undefined {
    return this.edges.find((e) => e.id === id);
  }

  getEdgesFrom(nodeId: string): Edge[] {
    return this.edges.filter((e) => e.source === nodeId);
  }

  getEdgesTo(nodeId: string): Edge[] {
    return this.edges.filter((e) => e.target === nodeId);
  }

  // ── Lease helpers ──

  addLeaseTerm(term: LeaseTerm): void {
    this.leaseTerms.push(term);
  }

  getLeaseTermsByTenant(tenantNodeId: string): LeaseTerm[] {
    return this.leaseTerms.filter((t) => t.tenant_node_id === tenantNodeId);
  }

  // ── Telemetry helpers ──

  addTelemetryPoint(point: TelemetryPoint): void {
    this.telemetryPoints.push(point);
  }

  addTelemetryReading(reading: TelemetryReading): void {
    this.telemetryReadings.push(reading);
    if (this.telemetryReadings.length > 2000) {
      this.telemetryReadings.splice(0, this.telemetryReadings.length - 2000);
    }
  }

  getReadingsForPoint(pointId: string, limit = 100): TelemetryReading[] {
    return this.telemetryReadings
      .filter((r) => r.point_id === pointId)
      .slice(-limit);
  }

  // ── Anomaly helpers ──

  addAnomaly(anomaly: Anomaly): void {
    this.anomalies.push(anomaly);
  }

  // ── Incident helpers ──

  addIncident(incident: Incident): void {
    this.incidents.push(incident);
    this.saveToDisk();
  }

  getIncident(id: string): Incident | undefined {
    return this.incidents.find((i) => i.id === id);
  }

  getOpenIncidents(): Incident[] {
    return this.incidents.filter((i) => i.status !== 'resolved');
  }

  // ── Simulation helpers ──

  addSimulation(sim: Simulation): void {
    const idx = this.simulations.findIndex((s) => s.id === sim.id);
    if (idx >= 0) this.simulations[idx] = sim;
    else this.simulations.push(sim);
    this.saveToDisk();
  }

  getSimulation(id: string): Simulation | undefined {
    return this.simulations.find((s) => s.id === id);
  }

  // ── Finding helpers ──

  addFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  // ── Agent helpers ──

  addAgentRun(run: AgentRun): void {
    this.agentRuns.push(run);
    this.saveToDisk();
  }

  getAgentRun(id: string): AgentRun | undefined {
    return this.agentRuns.find((r) => r.id === id);
  }

  upsertAgentStep(step: AgentStep): void {
    const idx = this.agentSteps.findIndex((s) => s.id === step.id);
    if (idx >= 0) this.agentSteps[idx] = step;
    else this.agentSteps.push(step);
  }

  getStepsForRun(runId: string): AgentStep[] {
    return this.agentSteps
      .filter((s) => s.run_id === runId)
      .sort((a, b) => a.idx - b.idx);
  }

  // ── Action helpers ──

  addAction(action: Action): void {
    this.actions.push(action);
    this.saveToDisk();
  }

  getAction(id: string): Action | undefined {
    return this.actions.find((a) => a.id === id);
  }

  getPendingActions(): Action[] {
    return this.actions.filter((a) => a.status === 'pending');
  }

  // ── Disk Persistence (server/data/cascade-db.json) ──

  saveToDisk(): void {
    try {
      const dir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        updated_at: new Date().toISOString(),
        incidents: this.incidents,
        actions: this.actions,
        simulations: this.simulations,
        assumptions: this.assumptions,
        injectedFaults: Array.from(this.injectedFaults),
        nodeStatuses: Object.fromEntries(this.nodes.map((n) => [n.id, n.status])),
      };
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Ignore disk write errors in read-only environments
    }
  }

  loadFromDisk(): void {
    try {
      if (!fs.existsSync(DB_FILE_PATH)) return;
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw) as {
        incidents?: Incident[];
        actions?: Action[];
        simulations?: Simulation[];
        assumptions?: Assumptions;
      };
      if (Array.isArray(data.incidents) && data.incidents.length > 0) {
        for (const inc of data.incidents) {
          if (!this.incidents.some((x) => x.id === inc.id)) {
            this.incidents.push(inc);
          }
        }
      }
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        for (const act of data.actions) {
          if (!this.actions.some((x) => x.id === act.id)) {
            this.actions.push(act);
          }
        }
      }
      if (Array.isArray(data.simulations) && data.simulations.length > 0) {
        for (const sim of data.simulations) {
          if (!this.simulations.some((x) => x.id === sim.id)) {
            this.simulations.push(sim);
          }
        }
      }
      if (data.assumptions) {
        this.assumptions = data.assumptions;
      }
    } catch {
      // Ignore corrupt or missing disk db
    }
  }

  // ── Parity helpers ──

  addParityCase(pc: ParityCase): void {
    this.parityCases.push(pc);
  }

  // ── Ground truth helpers ──

  addGroundTruthEdge(edge: GroundTruthEdge): void {
    this.groundTruthEdges.push(edge);
  }

  // ── Reset ──

  clear(): void {
    this.sourceFiles = [];
    this.nodes = [];
    this.edges = [];
    this.leaseTerms = [];
    this.telemetryPoints = [];
    this.telemetryReadings = [];
    this.anomalies = [];
    this.incidents = [];
    this.simulations = [];
    this.findings = [];
    this.agentRuns = [];
    this.agentSteps = [];
    this.actions = [];
    this.parityCases = [];
    this.parityResults = [];
    this.groundTruthEdges = [];
    this.assumptions = structuredClone(DEFAULT_ASSUMPTIONS);
    this.injectedFaults.clear();
  }
}

export const store = new Store();
