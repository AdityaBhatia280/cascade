// Fixture data — only values from the Cascade spec (section 10). Used exclusively via api.ts fallback.
import type {
  Action, AgentStep, Assumptions, EvalReport, Finding, GraphEdge, GraphNode,
  ModernizationStage, ParityResult, SourceSnippet, TelemetryPoint,
} from './types';

type N = [string, string, GraphNode['type'], GraphNode['category'], number, number, number, number, number];
const nodeRows: N[] = [
  ['UPS-B', 'UPS panel B', 'utility', 'power', 1, 1, 0, 99.999, 0.9],
  ['CH-1', 'Chiller 1', 'system', 'cooling', 1, 1, 0, 99.99, 0.85],
  ['CH-2', 'Chiller 2', 'system', 'cooling', 1, 1, 0, 99.99, 0.7],
  ['CH-3', 'Chiller 3', 'system', 'cooling', 1, 1, 0, 99.99, 0.7],
  ['cooling_loop', 'Chilled water loop', 'system', 'cooling', 2, 3, 0, 99.99, 0.95],
  ['CRAH-4', 'CRAH unit 4', 'system', 'cooling', 1, 1, 0, 99.99, 0.65],
  ['hall_200', 'Data hall 200 (Acme Cloud)', 'tenant', 'tenant', 2, 2, 45000, 99.99, 0.95],
  ['acme_sla', 'Acme 99.99% cooling SLA', 'sla', 'tenant', 1, 1, 45000, 99.99, 0.9],
  ['COOLFLAG.DAT', 'COOLFLAG.DAT', 'module', 'data', 1, 1, 0, 99.0, 0.85],
  ['LEASEBIL', 'LEASEBIL.cbl', 'module', 'legacy', 1, 1, 0, 99.9, 0.92],
  ['CAMCALC', 'CAMCALC.cbl', 'module', 'legacy', 1, 1, 0, 99.9, 0.65],
  ['LEASECPY', 'LEASECPY.cpy', 'module', 'legacy', 1, 1, 0, 99.9, 0.5],
  ['INVBATCH', 'INVBATCH.jcl', 'module', 'legacy', 1, 1, 0, 99.0, 0.8],
  ['northwind_retail', 'Northwind Retail', 'tenant', 'tenant', 1, 1, 15200, 99.0, 0.75],
  ['meridian_analytics', 'Meridian Analytics', 'tenant', 'tenant', 1, 1, 8900, 99.0, 0.4],
  ['coastal_logistics', 'Coastal Logistics', 'tenant', 'tenant', 1, 1, 14000, 99.0, 0.35],
  ['SW-03', 'BMS network switch SW-03', 'system', 'network', 1, 1, 0, 99.95, 0.75],
  ['CTL-04', 'Data hall door controller', 'system', 'network', 1, 1, 0, 99.9, 0.6],
  ['work_orders', 'Work orders table', 'system', 'data', 1, 1, 0, 99.5, 0.7],
  ['badge_access', 'Badge access table', 'system', 'network', 1, 1, 0, 99.9, 0.8],
];
export const fxNodes: GraphNode[] = nodeRows.map(([id, label, type, category, k, n, fee, sla, risk]) => ({
  id, label, type, category, status: 'healthy', k_required: k, n_total: n,
  monthly_fee_usd: fee, sla_target_pct: sla, risk_score: risk,
}));

type E = [string, string, string, GraphEdge['kind'], number, number, string, boolean];
const edgeRows: E[] = [
  ['E-D6', 'UPS-B', 'CH-1', 'powers', 0, 1.0, 'seed/bms/bms_config.json:35', true],
  ['E-D7', 'UPS-B', 'CRAH-4', 'powers', 0, 1.0, 'seed/bms/bms_config.json:320', true],
  ['E-C1', 'CH-1', 'cooling_loop', 'cools', 1, 1.0, 'seed/bms/bms_config.json:30', true],
  ['E-C2', 'CH-2', 'cooling_loop', 'cools', 1, 1.0, 'seed/bms/bms_config.json:40', true],
  ['E-C3', 'CH-3', 'cooling_loop', 'cools', 1, 1.0, 'seed/bms/bms_config.json:50', true],
  ['E-H1', 'cooling_loop', 'hall_200', 'cools', 3, 1.0, 'seed/leases/acme.txt:61', true],
  ['E-H2', 'CRAH-4', 'hall_200', 'cools', 2, 1.0, 'seed/bms/bms_config.json:320', true],
  ['E-D9', 'hall_200', 'acme_sla', 'contractual', 0, 1.0, 'seed/leases/acme.txt:58', true],
  ['E-D2', 'cooling_loop', 'COOLFLAG.DAT', 'writes', 0, 1.0, 'seed/bms/bms_config.json:12', true],
  ['E-D1', 'COOLFLAG.DAT', 'LEASEBIL', 'reads', 0, 1.0, 'seed/cobol/LEASEBIL.cbl:278', true],
  ['E-D3a', 'LEASECPY', 'LEASEBIL', 'shares', 0, 1.0, 'seed/cobol/LEASEBIL.cbl:50', true],
  ['E-D3b', 'LEASECPY', 'CAMCALC', 'shares', 0, 1.0, 'seed/cobol/CAMCALC.cbl:39', true],
  ['E-D10', 'INVBATCH', 'LEASEBIL', 'schedules', 0, 1.0, 'seed/jcl/INVBATCH.jcl:36', true],
  ['E-D4', 'LEASEBIL', 'northwind_retail', 'bills', 0, 0.95, 'seed/cobol/LEASEBIL.cbl:91', true],
  ['E-B2', 'LEASEBIL', 'meridian_analytics', 'bills', 0, 0.9, 'seed/leases/meridian.txt:29', true],
  ['E-U1', 'LEASEBIL', 'coastal_logistics', 'bills', 0, 0.45, '', false],
  ['E-D5', 'work_orders', 'badge_access', 'grants', 0, 1.0, 'seed/sql/schema.sql:279', true],
  ['E-D8', 'SW-03', 'CTL-04', 'network', 0, 1.0, 'seed/access/access_export.csv:8', true],
];
export const fxEdges: GraphEdge[] = edgeRows.map(([id, source, target, kind, delay, conf, ev, verified]) => {
  const [file, line] = ev ? ev.split(':') : ['', '0'];
  return { id, source, target, kind, delay_min: delay, confidence: conf, evidence_file: file ?? '', evidence_line: Number(line), verified };
});

export const fxFindings: Finding[] = [
  {
    id: 'F-1', kind: 'billing_discrepancy', severity: 'high', title: 'Northwind base year billing discrepancy',
    description: 'LEASEBIL hardcodes base year 2019 ($11.20/sf). The 2021 amendment sets the base to $12.05/sf. Northwind (8,200 sf) is overcharged $580.83/month.',
    node_ids: ['LEASEBIL', 'northwind_retail'], usd_per_year: 6970,
    code_file: 'seed/cobol/LEASEBIL.cbl', code_line: 91,
    contract_file: 'seed/leases/northwind.txt', contract_line: 51,
    monthly_billed_usd: 1503.33, monthly_correct_usd: 922.5,
  },
  {
    id: 'F-2', kind: 'hidden_dependency', severity: 'critical', title: 'Chiller 1 and CRAH 4 share UPS panel B',
    description: 'One power event on UPS-B takes out a chiller and an air handler at once, defeating the 2-of-3 chiller redundancy.',
    node_ids: ['UPS-B', 'CH-1', 'CRAH-4'], usd_per_year: 0,
  },
  {
    id: 'F-3', kind: 'hidden_dependency', severity: 'high', title: 'Billing reads physical cooling status',
    description: 'LEASEBIL reads COOLFLAG.DAT written by the BMS export; a cooling outage changes invoices.',
    node_ids: ['cooling_loop', 'COOLFLAG.DAT', 'LEASEBIL'], usd_per_year: 0,
  },
  {
    id: 'F-4', kind: 'hidden_dependency', severity: 'medium', title: 'Nightly batch reads stale cooling flags',
    description: 'INVBATCH runs LEASEBIL (step 010) before the BMS export (step 020).',
    node_ids: ['INVBATCH', 'LEASEBIL'], usd_per_year: 0,
  },
  {
    id: 'F-5', kind: 'security', severity: 'high', title: 'Work orders auto-grant badge access',
    description: 'Trigger trg_work_order_badge at seed/sql/schema.sql:279 grants physical access with no review.',
    node_ids: ['work_orders', 'badge_access'], usd_per_year: 0,
  },
];

// Only the snippets quoted in the spec are known in preview mode.
export const fxSources: SourceSnippet[] = [
  { file: 'seed/cobol/LEASEBIL.cbl', line: 91, start_line: 91, lines: ['       05  WS-BASE-YEAR            PIC 9(4)    VALUE 2019.'] },
  { file: 'seed/leases/northwind.txt', line: 51, start_line: 51, lines: ['2021 (the "Amended Base Year"). All references to "Base Year"'] },
];

type P = [string, string, number, number, number, string];
const parityRows: P[] = [
  ['CASE-01', 'Northwind, 2021 amended base', 8200, 12.05, 13.4, '0000922.50'],
  ['CASE-02', 'Northwind, hardcoded 2019 base (bug)', 8200, 11.2, 13.4, '0001503.33'],
  ['CASE-03', 'Meridian', 4800, 12.8, 13.4, '0000240.00'],
  ['CASE-04', 'Pinnacle', 6200, 11.6, 13.4, '0000930.00'],
  ['CASE-05', 'Truncation boundary', 1000, 10.0, 10.07, '0000005.83'],
  ['CASE-06', 'Exact cent boundary', 300, 10.0, 10.1, '0000002.50'],
  ['CASE-07', 'Zero increase', 5000, 13.4, 13.4, '0000000.00'],
  ['CASE-08', 'Expense decrease floors at zero', 4000, 14.0, 13.4, '0000000.00'],
];
export const fxParity: ParityResult[] = parityRows.map(([case_id, description, area, base, cur, expected]) => ({
  case_id, description, input: { area_sf: area, base_usd_per_sf: base, current_usd_per_sf: cur },
  expected, actual: expected, pass: true,
}));

export const fxTelemetryPoints: (TelemetryPoint & { baseline: number })[] = [
  { id: 'PT-CH1-TEMP', node_id: 'CH-1', name: 'CH-1 supply temp', unit: '°C', expected_min: 6, expected_max: 10, baseline: 7.2 },
  { id: 'PT-CH2-TEMP', node_id: 'CH-2', name: 'CH-2 supply temp', unit: '°C', expected_min: 6, expected_max: 10, baseline: 7.4 },
  { id: 'PT-CH3-TEMP', node_id: 'CH-3', name: 'CH-3 supply temp', unit: '°C', expected_min: 6, expected_max: 10, baseline: 7.1 },
  { id: 'PT-LOOP-FLOW', node_id: 'cooling_loop', name: 'Loop flow', unit: 'L/min', expected_min: 250, expected_max: 400, baseline: 350 },
  { id: 'PT-HALL-TEMP', node_id: 'hall_200', name: 'Hall 200 inlet temp', unit: '°C', expected_min: 20, expected_max: 24, baseline: 21.5 },
  { id: 'PT-UPSB-LOAD', node_id: 'UPS-B', name: 'UPS-B load', unit: '%', expected_min: 35, expected_max: 75, baseline: 54 },
];

const NEMO = 'nvidia/nemotron-3-super-120b-a12b';
type S = [AgentStep['stage'], string, string, string, AgentStep['status']];
export const fxAgentSteps: S[] = [
  ['refine', 'detect_anomaly', 'CH-2 tripped. 2 of 3 chillers still running; loop is degraded, no cascade.', 'engine/anomaly', 'done'],
  ['refine', 'detect_anomaly', 'UPS-B power event tripped CH-1. 1 of 3 chillers running, 2 required. Incident opened.', 'engine/anomaly', 'done'],
  ['plan', 'plan_response', 'Plan: simulate cascade from UPS-B, price impact, propose notifications.', NEMO, 'done'],
  ['map', 'simulate_cascade', 'Hall 200 reaches its thermal limit in about 4 minutes. LEASEBIL will apply an SLA credit on the next billing run.', 'engine/cascade', 'done'],
  ['plan', 'price_impact', 'Acme Cloud SLA credit and response costs computed (illustrative).', 'engine/cost', 'done'],
  ['assemble', 'send_email', 'Notify Acme Cloud facilities of predicted cooling impact.', NEMO, 'awaiting_approval'],
  ['assemble', 'schedule_maintenance', 'Send calendar invite to chiller vendor for emergency service.', NEMO, 'awaiting_approval'],
];

export const fxPendingActions: Omit<Action, 'id' | 'run_id'>[] = [
  {
    tool: 'send_email', recipient_display: 'facilities@acme-cloud.example',
    content: 'Cooling capacity for Data hall 200 is reduced after a UPS-B power event tripped Chiller 1 (Chiller 2 already offline). Our team is responding and will brief you shortly.',
    usd_impact: 0, risk: 'normal', requires_approval: true, status: 'pending', decided_by: null, decided_at: null, result: null,
  },
  {
    tool: 'schedule_maintenance', recipient_display: 'chiller-vendor@example.com',
    content: 'Calendar invite: emergency service for Chiller 1 and Chiller 2 at Cascade Tower — Chicago, IL.',
    usd_impact: 0, risk: 'normal', requires_approval: true, status: 'pending', decided_by: null, decided_at: null, result: null,
  },
];

export const fxEval: EvalReport = {
  found: 10, total: 10, false_positives: 0, precision: 1.0, recall: 1.0, f1: 1.0,
  items: [
    { id: 'D1', from: 'COOLFLAG.DAT', to: 'LEASEBIL', kind: 'reads', is_decoy: false, matched: true },
    { id: 'D2', from: 'cooling_loop', to: 'COOLFLAG.DAT', kind: 'writes', is_decoy: false, matched: true },
    { id: 'D3', from: 'LEASECPY', to: 'CAMCALC', kind: 'shares', is_decoy: false, matched: true },
    { id: 'D4', from: 'LEASEBIL', to: 'northwind_retail', kind: 'bills', is_decoy: false, matched: true },
    { id: 'D5', from: 'work_orders', to: 'badge_access', kind: 'grants', is_decoy: false, matched: true },
    { id: 'D6', from: 'UPS-B', to: 'CH-1', kind: 'powers', is_decoy: false, matched: true },
    { id: 'D7', from: 'UPS-B', to: 'CRAH-4', kind: 'powers', is_decoy: false, matched: true },
    { id: 'D8', from: 'SW-03', to: 'CTL-04', kind: 'network', is_decoy: false, matched: true },
    { id: 'D9', from: 'hall_200', to: 'acme_sla', kind: 'contractual', is_decoy: false, matched: true },
    { id: 'D10', from: 'INVBATCH', to: 'LEASEBIL', kind: 'schedules', is_decoy: false, matched: true },
    { id: 'X1', from: 'LEASEBIL', to: 'METERREAD', kind: 'reads', is_decoy: true, matched: false },
    { id: 'X2', from: 'CTL-01', to: 'SW-01', kind: 'network', is_decoy: true, matched: false },
    { id: 'X3', from: 'coastal_logistics', to: 'bms_meters', kind: 'reads', is_decoy: true, matched: false },
  ],
};

export const fxModernization: ModernizationStage[] = [
  {
    stage: 'refine', status: 'done', producer: NEMO,
    content: {
      summary: 'LEASEBIL.cbl calculates monthly base rent escalations, pro-rata CAM pass-throughs via CAMCALC, and cooling SLA credits from COOLFLAG.DAT.',
      rules: [
        { paragraph: '3000-BASE-RENT-CALC', rule: 'Applies annual percentage escalation to base rent' },
        { paragraph: '4000-CAM-SHARE-CALC', rule: 'Computes OpEx increase over WS-BASE-YEAR (hardcoded 2019) and calls CAMCALC' },
        { paragraph: '5000-SLA-CREDIT-CALC', rule: 'Reads COOLFLAG.DAT and deducts 5%–30% credit by outage duration' },
      ],
    },
  },
  { stage: 'map', status: 'done', producer: 'engine/ast-parser', content: { edges_verified: 10, unverified: 1 } },
  {
    stage: 'plan', status: 'done', producer: NEMO,
    content: {
      steps: [
        'Parameterize base_year per tenant lease amendment',
        'Use integer cents (BigInt) for COMP-3 decimal arithmetic',
        'Preserve COBOL truncation semantics on non-ROUNDED COMPUTE statements',
        'Verify 1:1 output against 8 GnuCOBOL golden cases',
      ],
    },
  },
  {
    stage: 'assemble', status: 'done', producer: NEMO,
    content: {
      typescript_code: "export interface LeaseInput {\n  areaSf: number;\n  baseOpexCents: number;\n  currentOpexCents: number;\n}\n\nexport function computeMonthlyCamPic(input: LeaseInput): string {\n  const deltaCents = Math.max(0, input.currentOpexCents - input.baseOpexCents);\n  const annualCents = BigInt(deltaCents) * BigInt(input.areaSf);\n  const monthlyCents = Number(annualCents / 12n);\n  const dollars = Math.floor(monthlyCents / 100);\n  const cents = monthlyCents % 100;\n  return `${String(dollars).padStart(7, '0')}.${String(cents).padStart(2, '0')}`;\n}",
      tests_code: "describe('computeMonthlyCamPic parity with GnuCOBOL', () => {\n  it('matches CASE-01 Northwind 2021 amendment ($922.50)', () => {\n    expect(computeMonthlyCamPic({ areaSf: 8200, baseOpexCents: 1205, currentOpexCents: 1340 })).toBe('0000922.50');\n  });\n  it('matches CASE-05 truncation boundary ($5.83)', () => {\n    expect(computeMonthlyCamPic({ areaSf: 1000, baseOpexCents: 1000, currentOpexCents: 1007 })).toBe('0000005.83');\n  });\n});",
    },
  },
  { stage: 'validate', status: 'done', producer: 'engine/parity', content: { passed: 8, total: 8 } },
];

export const fxAssumptions: Assumptions = {
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
