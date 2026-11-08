export type NodeType = 'system' | 'module' | 'tenant' | 'lease' | 'utility' | 'sensor' | 'sla';
export type NodeStatus = 'healthy' | 'degraded' | 'failed';
export type EdgeKind = 'reads' | 'feeds' | 'powers' | 'cools' | 'bills' | 'grants' | 'shares' | 'schedules' | 'contractual' | 'network' | 'writes';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  k_required?: number;
  n_total?: number;
  capacity_kw?: number;
  monthly_fee_usd?: number;
  sla_target_pct?: number;
  risk_score?: number;
  metadata?: Record<string, any>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  delay_min?: number;
  weight?: number;
  confidence?: number;
  evidence_file?: string;
  evidence_line?: number;
  verified?: boolean;
}

export interface Finding {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  node_ids: string[];
  evidence_file: string;
  evidence_line: number;
  dollar_impact_usd: number;
  created_at: string;
}

export interface AgentStep {
  id: string;
  run_id: string;
  seq: number;
  stage: 'refine' | 'map' | 'plan' | 'assemble' | 'validate';
  tool_name: string;
  tool_args: Record<string, any>;
  result_summary: string;
  latency_ms: number;
  model_used: string;
  status: 'running' | 'done' | 'error' | 'replanned';
  created_at: string;
}

export interface Action {
  id: string;
  run_id: string;
  step_id: string;
  tool: 'send_email' | 'schedule_maintenance' | 'place_call';
  recipient: string;
  content: string;
  dollar_impact_usd: number;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  approved_by: string | null;
  executed_at: string | null;
}

export interface TelemetryReading {
  id: string;
  point_id: string;
  ts: string;
  value: number;
}

export interface CascadeStep {
  step: number;
  nodeId: string;
  oldStatus: NodeStatus;
  newStatus: NodeStatus;
  revenueAtRisk: number;
  slaCredit: number;
  reason: string;
}

export interface ParityCase {
  id: string;
  case_name: string;
  input: Record<string, any>;
  expected_output: Record<string, any>;
  source: string;
}

export interface ParityResult {
  id: string;
  case_id: string;
  run_id: string;
  actual_output: Record<string, any>;
  passed: boolean;
  diff_summary: string;
  executed_at: string;
}

export interface EvalReport {
  totalGroundTruth: number;
  totalExtracted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

