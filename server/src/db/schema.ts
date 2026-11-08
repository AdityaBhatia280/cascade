export type NodeType = 'system' | 'module' | 'tenant' | 'utility' | 'sla';
export type NodeStatus = 'healthy' | 'degraded' | 'failed';
export type NodeCategory = 'cooling' | 'power' | 'network' | 'legacy' | 'tenant' | 'data';
export type EdgeKind =
  | 'reads'
  | 'writes'
  | 'feeds'
  | 'powers'
  | 'cools'
  | 'bills'
  | 'grants'
  | 'shares'
  | 'schedules'
  | 'contractual'
  | 'network';
export type Stage = 'refine' | 'map' | 'plan' | 'assemble' | 'validate';

export interface SourceFile {
  id: string;
  filename: string;
  language: string;
  line_count: number;
  ingested_at: string;
}

export interface Node {
  id: string;
  label: string;
  type: NodeType;
  category: NodeCategory;
  status: NodeStatus;
  k_required: number;
  n_total: number;
  capacity_kw: number;
  monthly_fee_usd: number;
  sla_target_pct: number;
  risk_score: number;
  metadata: Record<string, unknown>;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  delay_min: number;
  weight: number;
  confidence: number;
  evidence_file: string;
  evidence_line: number;
  verified: boolean;
}

export interface SourceSnippet {
  file: string;
  line: number;
  start_line: number;
  lines: string[];
}

export interface Overview {
  dollars_at_risk_usd: number;
  dependencies_found: number;
  dependencies_total: number;
  critical_spofs: number;
  incident_status: 'nominal' | 'degraded' | 'critical';
  active_incident_id: string | null;
  updated_at: string;
}

export interface RiskEntry {
  node_id: string;
  label: string;
  risk_score: number;
  factors: {
    blast_radius: number;
    dollars_at_risk: number;
    fragility: number;
  };
}

export interface TimelineEntry {
  t_min: number;
  node_id: string;
  state: NodeStatus;
  reason: string;
}

export interface TenantImpact {
  tenant_id: string;
  tenant_label: string;
  minutes_to_impact: number;
  sla_credit_usd: number;
}

export interface Simulation {
  id: string;
  root_node: string;
  timeline: TimelineEntry[];
  impacts: TenantImpact[];
  total_usd: number;
  assumptions_version: number;
}

export interface WhatIfResult {
  faults: string[];
  statuses: Record<string, NodeStatus>;
  reasons: Record<string, string>;
  timeline: TimelineEntry[];
  impacts: TenantImpact[];
  total_usd: number;
  failed_count: number;
  degraded_count: number;
  assumptions_version: number;
}

export interface Incident {
  id: string;
  title: string;
  root_node: string;
  status: 'open' | 'mitigating' | 'resolved';
  opened_at: string;
  simulation_id: string | null;
  agent_run_id: string | null;
}

export interface Finding {
  id: string;
  kind: 'billing_discrepancy' | 'hidden_dependency' | 'hardcoded_value' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  node_ids: string[];
  usd_per_year: number;
  code_file?: string;
  code_line?: number;
  contract_file?: string;
  contract_line?: number;
  monthly_billed_usd?: number;
  monthly_correct_usd?: number;
}

export interface AgentRun {
  id: string;
  incident_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  total_llm_calls: number;
  total_tokens: number;
}

export interface AgentStep {
  id: string;
  run_id: string;
  idx: number;
  stage: Stage;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  result_summary: string;
  status: 'running' | 'done' | 'error' | 'replanned' | 'awaiting_approval';
  replan_reason?: string;
  latency_ms: number;
  model: string;
  created_at: string;
}

export type ActionTool =
  | 'create_work_order'
  | 'send_email'
  | 'schedule_maintenance'
  | 'place_call'
  | 'failover_to_backup';

export interface Action {
  id: string;
  run_id: string;
  tool: ActionTool;
  recipient_display: string;
  content: string;
  usd_impact: number;
  risk: 'normal' | 'high';
  requires_approval: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  decided_by: string | null;
  decided_at: string | null;
  result: string | null;
}

export interface VoiceCallTicket {
  incident_id: string;
  action_id: string;
  /** null when no unit could be identified from what the caller said. */
  node_id: string | null;
}

/** What Cascade did once a Retell call ended. Recorded once per call_id. */
export interface VoiceCallOutcome {
  call_id: string;
  processed_at: string;
  ticket: VoiceCallTicket | null;
  approved_action_ids: string[];
}

export interface TelemetryPoint {
  id: string;
  node_id: string;
  name: string;
  unit: string;
  expected_min: number;
  expected_max: number;
  baseline: number;
}

export interface TelemetryReading {
  point_id: string;
  ts: string;
  value: number;
  quality: 'ok' | 'stale' | 'suspect';
}

export interface Anomaly {
  id: string;
  point_id: string;
  ts: string;
  kind: 'threshold' | 'trend' | 'sensor_fault';
  severity: 'warning' | 'critical';
  message: string;
}

export interface ParityCase {
  id: string;
  description: string;
  area_sf: number;
  base_usd_per_sf: number;
  current_usd_per_sf: number;
  expected_formatted: string;
}

export interface ParityResult {
  case_id: string;
  description: string;
  input: Record<string, number>;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface EvalReport {
  found: number;
  total: number;
  false_positives: number;
  precision: number;
  recall: number;
  f1: number;
  items: {
    id: string;
    from: string;
    to: string;
    kind: string;
    is_decoy: boolean;
    matched: boolean;
  }[];
}

export interface ModernizationStage {
  stage: Stage;
  status: 'pending' | 'running' | 'done' | 'failed';
  producer: string;
  content: Record<string, unknown>;
}

export interface Assumptions {
  version: number;
  sla_credit_tiers: { max_minutes: number; pct_of_monthly_fee: number }[];
  emergency_response_usd: number;
  hardware_damage_usd: number;
  thermal_rise_c_per_min: number;
}

export interface LeaseTerm {
  id: string;
  tenant_node_id: string;
  clause_key: string;
  clause_text: string;
  monthly_amount_usd: number;
  sla_pct: number;
  penalty_pct: number;
  source_file: string;
  source_line: number;
}

export interface GroundTruthEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  is_decoy: boolean;
  source_file: string;
  source_line: number;
}
