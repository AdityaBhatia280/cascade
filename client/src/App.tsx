import React, { useState, useEffect } from 'react';
import { DemoBanner } from './components/DemoBanner';
import { KPIStrip } from './components/KPIStrip';
import { DependencyGraph } from './components/DependencyGraph';
import { EvidencePanel } from './components/EvidencePanel';
import { AgentTrace } from './components/AgentTrace';
import { TabPanel } from './components/TabPanel';
import { ApprovalModal } from './components/ApprovalModal';
import {
  fetchGraph,
  fetchFindings,
  fetchLatestRun,
  fetchActions,
  approveAction,
  rejectAction,
  runParity,
  fetchEvalReport,
  simulateFailure,
} from './api';
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

export const App: React.FC = () => {
  // App state
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [parityResults, setParityResults] = useState<ParityResult[]>([]);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [activeTab, setActiveTab] = useState<string>('findings');
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [showTrace, setShowTrace] = useState<boolean>(true);
  const [showTabs, setShowTabs] = useState<boolean>(true);

  // Scenario & Incident State
  const [incidentStatus, setIncidentStatus] = useState<'NOMINAL' | 'DEGRADED' | 'CRITICAL CASCADE'>('NOMINAL');
  const [dollarsAtRisk, setDollarsAtRisk] = useState<number>(6970);
  const [cascadeSteps, setCascadeSteps] = useState<CascadeStep[]>([]);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
  const [isRunningScenario, setIsRunningScenario] = useState<boolean>(false);
  const [scenarioStep, setScenarioStep] = useState<number>(0);
  const [pendingModalActions, setPendingModalActions] = useState<Action[]>([]);
  const [readings, setReadings] = useState<Record<string, number>>({
    'PT-HALL-TEMP': 21.5,
    'PT-LOOP-FLOW': 350.0,
    'PT-CH1-TEMP': 7.2,
    'PT-CH2-TEMP': 7.4,
    'PT-CH3-TEMP': 7.1,
    'PT-UPSB-LOAD': 54.0,
  });

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const graphData = await fetchGraph();
      if (graphData && graphData.nodes && graphData.nodes.length > 0) {
        setNodes(graphData.nodes);
        setEdges(graphData.edges);
      }

      const findingsData = await fetchFindings();
      setFindings(findingsData);

      const evalData = await fetchEvalReport();
      setEvalReport(evalData);

      const actionsData = await fetchActions();
      setActions(actionsData);

      // Initial parity run
      const parityData = await runParity('init');
      setParityResults(parityData);
    } catch (err) {
      console.warn('Initial load retry scheduled:', err);
      // Automatically retry in 1.5 seconds if server was still starting
      setTimeout(loadInitialData, 1500);
    }
  };

  // Human Approval Modal Handler
  const handleApproveAction = async (actionId: string) => {
    try {
      await approveAction(actionId);
      setPendingModalActions((prev) => prev.filter((a) => a.id !== actionId));
      const updatedActions = await fetchActions();
      setActions(updatedActions);

      // Add audit step in agent trace
      setAgentSteps((prev) => [
        ...prev,
        {
          id: `step-${Date.now()}`,
          run_id: 'active',
          seq: prev.length + 1,
          stage: 'validate',
          tool_name: 'human_gate_approved',
          tool_args: { actionId },
          result_summary: 'Operator approved remediation action. Resend email & calendar invite delivered to team inbox.',
          latency_ms: 120,
          model_used: 'operator/human-in-the-loop',
          status: 'done',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRejectAction = async (actionId: string) => {
    try {
      await rejectAction(actionId);
      setPendingModalActions((prev) => prev.filter((a) => a.id !== actionId));
      const updatedActions = await fetchActions();
      setActions(updatedActions);

      // Agent replanning event on rejection!
      setAgentSteps((prev) => [
        ...prev,
        {
          id: `step-replan-${Date.now()}`,
          run_id: 'active',
          seq: prev.length + 1,
          stage: 'plan',
          tool_name: 'replan_mitigation',
          tool_args: { reason: 'Operator rejected outbound call. Fallback to automated Jira work order.' },
          result_summary: 'Replanned: Action rejected by operator. Falling back to internal escalation channel.',
          latency_ms: 450,
          model_used: 'nvidia/nemotron-3-nano-30b-a3b',
          status: 'replanned',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  // 3-Minute Live Incident Scenario Execution
  const handleRunScenario = () => {
    setIsRunningScenario(true);
    setScenarioStep(1);

    // Stage 1: CH-2 Trips (Absorbed by K-of-N redundancy)
    setTimeout(() => {
      setIncidentStatus('DEGRADED');
      setNodes((prev) =>
        prev.map((n) => (n.id === 'CH-2' ? { ...n, status: 'failed' } : n))
      );
      setReadings((prev) => ({
        ...prev,
        'PT-CH2-TEMP': 28.5,
        'PT-LOOP-FLOW': 310.0,
      }));
      setAgentSteps([
        {
          id: 'step-1',
          run_id: 'scen-1',
          seq: 1,
          stage: 'refine',
          tool_name: 'detect_anomaly',
          tool_args: { node: 'CH-2' },
          result_summary: 'Chiller CH-2 trip detected. Redundancy evaluation: CH-1 and CH-3 remain operational (k=2 of n=3). System state: DEGRADED. No cascade triggered.',
          latency_ms: 320,
          model_used: 'nvidia/nemotron-3-nano-30b-a3b',
          status: 'done',
          created_at: new Date().toISOString(),
        },
      ]);
    }, 2000);

    // Stage 2: Power Transient on UPS Panel B trips CH-1 (BREACHES K-OF-N!)
    setTimeout(() => {
      setScenarioStep(2);
      setIncidentStatus('CRITICAL CASCADE');
      setDollarsAtRisk(51970); // $45,000 Acme SLA + $6,970 billing overcharge
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === 'CH-1' || n.id === 'UPS-B') return { ...n, status: 'failed' };
          if (n.id === 'cooling_loop' || n.id === 'hall_200') return { ...n, status: 'degraded' };
          return n;
        })
      );
      setReadings((prev) => ({
        ...prev,
        'PT-UPSB-LOAD': 98.4,
        'PT-CH1-TEMP': 27.0,
        'PT-LOOP-FLOW': 140.0,
        'PT-HALL-TEMP': 29.4,
      }));

      // Agent starts unprompted!
      setIsAgentRunning(true);
      setActiveTab('cascade');

      // Populate deterministic cascade timeline
      setCascadeSteps([
        { step: 0, nodeId: 'UPS-B', oldStatus: 'healthy', newStatus: 'failed', revenueAtRisk: 0, slaCredit: 0, reason: 'Power transient trip' },
        { step: 1, nodeId: 'CH-1', oldStatus: 'healthy', newStatus: 'failed', revenueAtRisk: 0, slaCredit: 0, reason: 'Lost power feed from UPS-B (Hidden dependency D6)' },
        { step: 2, nodeId: 'cooling_loop', oldStatus: 'healthy', newStatus: 'failed', revenueAtRisk: 0, slaCredit: 0, reason: 'Only 1 of 2 required chillers operational (k=2 violated)' },
        { step: 3, nodeId: 'hall_200', oldStatus: 'healthy', newStatus: 'degraded', revenueAtRisk: 45000, slaCredit: 4500, reason: 'Inlet air temperature approaching 32°C critical threshold' },
        { step: 4, nodeId: 'LEASEBIL', oldStatus: 'healthy', newStatus: 'degraded', revenueAtRisk: 0, slaCredit: 9000, reason: 'Reads COOLFLAG.DAT (D1) and initiates Acme SLA penalty deduction' },
      ]);
      setTotalCost(13500);

      // Stream planner steps
      setAgentSteps((prev) => [
        ...prev,
        {
          id: 'step-2',
          run_id: 'scen-1',
          seq: 2,
          stage: 'map',
          tool_name: 'simulate_cascade',
          tool_args: { rootNode: 'UPS-B', depth: 4 },
          result_summary: 'Cascade simulation computed: UPS-B failure drops CH-1 and CRAH-4. Cooling capacity drops to 33%. 3.2 minutes to Acme Hall 200 thermal shutdown.',
          latency_ms: 640,
          model_used: 'deterministic/cascade_engine',
          status: 'done',
          created_at: new Date().toISOString(),
        },
        {
          id: 'step-3',
          run_id: 'scen-1',
          seq: 3,
          stage: 'plan',
          tool_name: 'price_impact',
          tool_args: { tenant: 'Acme Cloud Services', sla: '99.99%' },
          result_summary: 'SLA penalty computed: Tier 2 (10% credit = $4,500) within 15 min, escalating to Tier 3 ($9,000) at 60 min. Annual improper payments risk: $51,970.',
          latency_ms: 410,
          model_used: 'deterministic/cost_engine',
          status: 'done',
          created_at: new Date().toISOString(),
        },
        {
          id: 'step-4',
          run_id: 'scen-1',
          seq: 4,
          stage: 'assemble',
          tool_name: 'propose_remediation',
          tool_args: { actions: ['send_email', 'schedule_maintenance'] },
          result_summary: 'Nemotron assembled emergency dispatch plan: Resend alert to facility manager + auto-generated .ics calendar invite + work order.',
          latency_ms: 1150,
          model_used: 'nvidia/nemotron-3-super-120b-a12b',
          status: 'done',
          created_at: new Date().toISOString(),
        },
      ]);

      // Pop the Human Approval Modal!
      setTimeout(() => {
        setPendingModalActions([
          {
            id: 'act-demo-1',
            run_id: 'scen-1',
            step_id: 'step-4',
            tool: 'send_email',
            recipient: 'facility-lead@cascade.demo',
            content: 'URGENT: Acme Hall 200 Cooling Cascade in Progress. Secondary chiller loss due to UPS-B transient. $13,500 SLA exposure. Immediate chiller failover required.',
            dollar_impact_usd: 13500,
            status: 'pending',
            approved_by: null,
            executed_at: null,
          },
          {
            id: 'act-demo-2',
            run_id: 'scen-1',
            step_id: 'step-4',
            tool: 'schedule_maintenance',
            recipient: 'cooling-vendor@stulz.demo',
            content: 'Emergency Dispatch Calendar Invite (.ics attached) for Stulz Chiller technician at Basement 2 Mech Room.',
            dollar_impact_usd: 1200,
            status: 'pending',
            approved_by: null,
            executed_at: null,
          },
        ]);
        setIsAgentRunning(false);
        setIsRunningScenario(false);
      }, 2500);
    }, 5000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Top Demo Banner */}
      <DemoBanner
        mode={mode}
        onToggleMode={() => setMode((m) => (m === 'live' ? 'replay' : 'live'))}
        onRunScenario={handleRunScenario}
        isRunningScenario={isRunningScenario}
      />

      {/* KPI Strip */}
      <KPIStrip
        dollarsAtRisk={dollarsAtRisk}
        depsFound={10}
        criticalModules={nodes.filter((n) => n.status !== 'healthy').length}
        incidentStatus={incidentStatus}
      />

      {/* Main Center Area: Graph Center + Trace Right */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', height: '100%', overflow: 'hidden' }}>
          <DependencyGraph
            nodes={nodes}
            edges={edges}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            cascadeTimelineStep={scenarioStep}
          />

          {/* Toggle Agent Trace Button */}
          <button
            onClick={() => setShowTrace(!showTrace)}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#38bdf8',
              padding: '6px 12px',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono',
              fontWeight: 600,
              cursor: 'pointer',
              zIndex: 15,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span>{showTrace ? 'Hide Trace ▶' : '◀ Show Agent Trace'}</span>
          </button>

          {/* Evidence Panel Slide-out when Node Selected */}
          {selectedNode && (
            <EvidencePanel
              node={selectedNode}
              edges={edges}
              onClose={() => setSelectedNode(null)}
              onSelectNode={(id) => {
                const target = nodes.find((n) => n.id === id);
                if (target) setSelectedNode(target);
              }}
            />
          )}
        </div>

        {/* Right Sidebar Agent Trace (Collapsible) */}
        {showTrace && (
          <div style={{ flexShrink: 0, height: '100%', zIndex: 10 }}>
            <AgentTrace steps={agentSteps} isRunning={isAgentRunning} />
          </div>
        )}
      </div>

      {/* Bottom Tabs Panel (Collapsible) */}
      <TabPanel
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setShowTabs(true);
        }}
        isCollapsed={!showTabs}
        onToggleCollapse={() => setShowTabs(!showTabs)}
        nodes={nodes}
        findings={findings}
        cascadeSteps={cascadeSteps}
        totalCost={totalCost}
        parityResults={parityResults}
        actions={actions}
        evalReport={evalReport}
        readings={readings}
        scenarioStep={scenarioStep}
        onRunParity={async () => {
          const res = await runParity('manual');
          setParityResults(res);
        }}
        isRunningParity={false}
        onRemediate={() => {
          setActiveTab('remediation');
          setShowTabs(true);
        }}
      />

      {/* Human Approval Gate Modal */}
      {pendingModalActions.length > 0 && (
        <ApprovalModal
          actions={pendingModalActions}
          onApprove={handleApproveAction}
          onReject={handleRejectAction}
          onClose={() => setPendingModalActions([])}
        />
      )}
    </div>
  );
};

