import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import type {
  SourceFile,
  Node,
  Edge,
  LeaseTerm,
  Finding,
  NodeType,
  NodeCategory,
  EdgeKind,
  NodeStatus,
  GroundTruthEdge,
  ParityCase,
  TelemetryPoint,
  Overview,
  SourceSnippet,
} from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../../../seed');

export interface SeedSummary {
  sourceFiles: number;
  nodes: number;
  edges: number;
  leaseTerms: number;
  findings: number;
  groundTruthEdges: number;
  parityCases: number;
  telemetryPoints: number;
}

/**
 * Reads JSON seed files from the seed/ directory and populates the in-memory store.
 */
export async function seedPortfolio(): Promise<SeedSummary> {
  store.clear();

  const nodesData = loadJsonSeed<Array<Partial<Node> & { id: string; label: string }>>('nodes.json', []);
  const edgesData = loadJsonSeed<Array<Partial<Edge> & { source: string; target: string }>>('edges.json', []);
  const leaseData = loadJsonSeed<Array<Partial<LeaseTerm> & { tenant_node_id: string }>>('lease_terms.json', []);
  const findingsData = loadJsonSeed<Array<Partial<Finding> & { type?: string; dollar_impact_usd?: number }>>('findings.json', []);
  const sourceFilesData = loadJsonSeed<Array<Partial<SourceFile>>>('source_files.json', []);
  const groundTruthData = loadJsonSeed<{
    dependencies: Array<{
      id: string;
      from: string;
      to: string;
      kind: string;
      evidence_file: string;
      evidence_line: number;
      is_real: boolean;
    }>;
    decoys: Array<{
      id: string;
      from: string;
      to: string;
      kind: string;
      evidence_file: string;
      evidence_line: number;
      is_real: boolean;
    }>;
  }>('ground_truth.json', { dependencies: [], decoys: [] });
  const parityCasesData = loadJsonSeed<Array<Record<string, unknown>>>('parity_cases.json', []);
  const telemetryPointsData = loadJsonSeed<Array<Record<string, unknown>>>('telemetry/telemetry_points.json', []);

  for (const sf of sourceFilesData) {
    store.sourceFiles.push({
      id: sf.id || uuid(),
      filename: sf.filename || 'unknown',
      language: sf.language || 'unknown',
      line_count: sf.line_count || 0,
      ingested_at: sf.ingested_at || new Date().toISOString(),
    });
  }

  for (const n of nodesData) {
    store.addNode({
      id: n.id,
      label: n.label,
      type: (n.type || 'system') as NodeType,
      category: (n.category || 'legacy') as NodeCategory,
      status: (n.status || 'healthy') as NodeStatus,
      k_required: n.k_required ?? 1,
      n_total: n.n_total ?? 1,
      capacity_kw: n.capacity_kw ?? 0,
      monthly_fee_usd: n.monthly_fee_usd ?? 0,
      sla_target_pct: n.sla_target_pct ?? 99.9,
      risk_score: n.risk_score ?? 0.5,
      metadata: n.metadata ?? {},
    });
  }

  for (const e of edgesData) {
    store.addEdge({
      id: e.id || uuid(),
      source: e.source,
      target: e.target,
      kind: (e.kind || 'reads') as EdgeKind,
      delay_min: e.delay_min ?? 0,
      weight: e.weight ?? 1,
      confidence: e.confidence ?? 1,
      evidence_file: e.evidence_file || '',
      evidence_line: e.evidence_line ?? 0,
      verified: e.verified ?? false,
    });
  }

  for (const lt of leaseData) {
    store.addLeaseTerm({
      id: lt.id || uuid(),
      tenant_node_id: lt.tenant_node_id,
      clause_key: lt.clause_key || '',
      clause_text: lt.clause_text || '',
      monthly_amount_usd: lt.monthly_amount_usd ?? 0,
      sla_pct: lt.sla_pct ?? 99.9,
      penalty_pct: lt.penalty_pct ?? 0,
      source_file: lt.source_file || '',
      source_line: lt.source_line ?? 0,
    });
  }

  for (const f of findingsData) {
    const finding: Finding = {
      id: f.id || uuid(),
      kind: (f.kind || f.type || 'hidden_dependency') as Finding['kind'],
      severity: f.severity || 'medium',
      title: f.title || '',
      description: f.description || '',
      node_ids: f.node_ids || [],
      usd_per_year: f.usd_per_year ?? f.dollar_impact_usd ?? 0,
    };
    if (f.code_file) finding.code_file = f.code_file;
    if (f.code_line !== undefined) finding.code_line = f.code_line;
    if (f.contract_file) finding.contract_file = f.contract_file;
    if (f.contract_line !== undefined) finding.contract_line = f.contract_line;
    if (f.monthly_billed_usd !== undefined) finding.monthly_billed_usd = f.monthly_billed_usd;
    if (f.monthly_correct_usd !== undefined) finding.monthly_correct_usd = f.monthly_correct_usd;
    store.addFinding(finding);
  }

  const allGt = [
    ...(groundTruthData.dependencies || []).map((d) => ({ ...d, is_decoy: false })),
    ...(groundTruthData.decoys || []).map((d) => ({ ...d, is_decoy: true })),
  ];
  for (const gt of allGt) {
    store.addGroundTruthEdge({
      id: gt.id,
      source: gt.from,
      target: gt.to,
      kind: gt.kind as EdgeKind,
      is_decoy: gt.is_decoy,
      source_file: gt.evidence_file,
      source_line: gt.evidence_line,
    });
  }

  for (const pc of parityCasesData) {
    store.addParityCase({
      id: String(pc['id'] ?? ''),
      description: String(pc['tenant_name'] ?? pc['description'] ?? pc['id'] ?? ''),
      area_sf: Number(pc['area_sf'] ?? 0),
      base_usd_per_sf: Number(pc['base_expense_per_sf'] ?? pc['base_usd_per_sf'] ?? 0),
      current_usd_per_sf: Number(pc['current_expense_per_sf'] ?? pc['current_usd_per_sf'] ?? 0),
      expected_formatted: String(pc['expected_formatted'] ?? '0000000.00'),
    });
  }

  for (const tp of telemetryPointsData) {
    store.addTelemetryPoint({
      id: String(tp['id'] ?? ''),
      node_id: String(tp['node_id'] ?? ''),
      name: String(tp['name'] ?? ''),
      unit: String(tp['unit'] ?? ''),
      expected_min: Number(tp['expected_min'] ?? 0),
      expected_max: Number(tp['expected_max'] ?? 100),
      baseline: Number(tp['baseline'] ?? ((Number(tp['expected_min'] ?? 0) + Number(tp['expected_max'] ?? 100)) / 2)),
    });
  }

  return {
    sourceFiles: store.sourceFiles.length,
    nodes: store.nodes.length,
    edges: store.edges.length,
    leaseTerms: store.leaseTerms.length,
    findings: store.findings.length,
    groundTruthEdges: store.groundTruthEdges.length,
    parityCases: store.parityCases.length,
    telemetryPoints: store.telemetryPoints.length,
  };
}

/**
 * Compute executive overview metrics.
 */
export function getOverview(): Overview {
  // Annualized dollars at risk: findings usd_per_year + critical SLA exposure
  const findingsAnnual = store.findings.reduce((sum, f) => sum + f.usd_per_year, 0);
  const gtReal = store.groundTruthEdges.filter((g) => !g.is_decoy);
  const verifiedSet = new Set(
    store.edges.filter((e) => e.verified).map((e) => `${e.source}->${e.target}:${e.kind}`),
  );
  const found = gtReal.filter((g) => verifiedSet.has(`${g.source}->${g.target}:${g.kind}`)).length;

  const criticalSpofs = store.findings.filter((f) => f.severity === 'critical').length;
  const hasFailed = store.nodes.some((n) => n.status === 'failed');
  const hasDegraded = store.nodes.some((n) => n.status === 'degraded');
  const openInc = store.getOpenIncidents()[0] ?? null;

  return {
    dollars_at_risk_usd: findingsAnnual,
    dependencies_found: found,
    dependencies_total: gtReal.length || 10,
    critical_spofs: criticalSpofs,
    incident_status: hasFailed || openInc ? 'critical' : hasDegraded ? 'degraded' : 'nominal',
    active_incident_id: openInc?.id ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Returns the full dependency graph (nodes + edges with evidence).
 */
export function getGraph() {
  return {
    nodes: store.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      category: n.category,
      status: n.status,
      k_required: n.k_required,
      n_total: n.n_total,
      monthly_fee_usd: n.monthly_fee_usd,
      sla_target_pct: n.sla_target_pct,
      risk_score: n.risk_score,
    })),
    edges: store.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      delay_min: e.delay_min,
      confidence: e.confidence,
      evidence_file: e.evidence_file,
      evidence_line: e.evidence_line,
      verified: e.verified,
    })),
  };
}

/**
 * Returns all findings.
 */
export function getFindings(): Finding[] {
  return store.findings;
}

/**
 * Safely reads a source snippet from seed/ around the requested 1-based line number.
 */
export function getSourceSnippet(relFile: string, line: number): SourceSnippet | null {
  if (!relFile || line <= 0) return null;
  // Normalize path and ensure it points inside SEED_DIR
  const cleaned = relFile.replace(/^seed[\\/]/i, '');
  const fullPath = path.resolve(SEED_DIR, cleaned);
  if (!fullPath.startsWith(SEED_DIR) || !fs.existsSync(fullPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const allLines = raw.split(/\r?\n/);
    const startIdx = Math.max(0, line - 4);
    const endIdx = Math.min(allLines.length, line + 3);
    return {
      file: relFile,
      line,
      start_line: startIdx + 1,
      lines: allLines.slice(startIdx, endIdx),
    };
  } catch {
    return null;
  }
}

function loadJsonSeed<T>(filename: string, fallback: T): T {
  const filepath = path.join(SEED_DIR, filename);
  try {
    if (!fs.existsSync(filepath)) {
      console.warn(`[seed] ${filename} not found at ${filepath}, using empty fallback`);
      return fallback;
    }
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[seed] Failed to load ${filename}:`, err);
    return fallback;
  }
}
