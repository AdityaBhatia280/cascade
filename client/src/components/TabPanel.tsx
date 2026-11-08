import React from 'react';
import { Network, Activity, AlertTriangle, ShieldCheck, Code2, CheckCircle2, History, Target } from 'lucide-react';
import { CascadeTab } from './tabs/CascadeTab';
import { RiskTab } from './tabs/RiskTab';
import { FindingsTab } from './tabs/FindingsTab';
import { TelemetryTab } from './tabs/TelemetryTab';
import { RemediationTab } from './tabs/RemediationTab';
import { ParityTab } from './tabs/ParityTab';
import { ActionsTab } from './tabs/ActionsTab';
import { EvalTab } from './tabs/EvalTab';
import type { GraphNode, Finding, CascadeStep, ParityResult, Action, EvalReport } from '../types';

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  nodes: GraphNode[];
  findings: Finding[];
  cascadeSteps: CascadeStep[];
  totalCost: number;
  parityResults: ParityResult[];
  actions: Action[];
  evalReport: EvalReport | null;
  readings: Record<string, number>;
  scenarioStep: number;
  onRunParity: () => void;
  isRunningParity: boolean;
  onRemediate: (findingId: string) => void;
}

export const TabPanel: React.FC<Props> = ({
  activeTab,
  onTabChange,
  isCollapsed = false,
  onToggleCollapse,
  nodes,
  findings,
  cascadeSteps,
  totalCost,
  parityResults,
  actions,
  evalReport,
  readings,
  scenarioStep,
  onRunParity,
  isRunningParity,
  onRemediate,
}) => {
  const tabs = [
    { id: 'cascade', label: 'Cascade Timeline', icon: <Network size={14} />, badge: cascadeSteps.length > 0 ? `${cascadeSteps.length}` : null },
    { id: 'findings', label: 'Audit Findings', icon: <AlertTriangle size={14} />, badge: `${findings.length}` },
    { id: 'risk', label: 'Risk Ranking', icon: <ShieldCheck size={14} /> },
    { id: 'telemetry', label: 'Live Telemetry', icon: <Activity size={14} /> },
    { id: 'remediation', label: 'Modernization', icon: <Code2 size={14} /> },
    { id: 'parity', label: 'COBOL Parity', icon: <CheckCircle2 size={14} />, badge: '100%' },
    { id: 'actions', label: 'Action Audit Log', icon: <History size={14} />, badge: actions.length > 0 ? `${actions.length}` : null },
    { id: 'eval', label: 'Accuracy Benchmark', icon: <Target size={14} />, badge: '10/10' },
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: isCollapsed ? '36px' : 'clamp(210px, 30vh, 320px)',
      minHeight: isCollapsed ? '36px' : '180px',
      backgroundColor: '#0a0e17',
      borderTop: '1px solid #1e293b',
      flexShrink: 0,
      transition: 'height 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      overflow: 'hidden',
    }}>
      {/* Tab Navigation Strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px 0 12px',
        backgroundColor: '#07090e',
        borderBottom: isCollapsed ? 'none' : '1px solid #1e293b',
        overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 12px',
                  background: isActive ? '#0a0e17' : 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? '#38bdf8' : 'transparent'}`,
                  color: isActive ? '#f8fafc' : '#64748b',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span style={{
                    fontSize: '9px',
                    fontFamily: 'JetBrains Mono',
                    padding: '1px 5px',
                    borderRadius: '10px',
                    backgroundColor: isActive ? '#0284c7' : '#1e293b',
                    color: '#fff',
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              padding: '6px 10px',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{isCollapsed ? '▲ Expand' : '▼ Minimize'}</span>
          </button>
        )}
      </div>

      {/* Active Tab View */}
      {!isCollapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'cascade' && <CascadeTab cascadeSteps={cascadeSteps} totalCost={totalCost} />}
          {activeTab === 'findings' && <FindingsTab findings={findings} onRemediate={onRemediate} />}
          {activeTab === 'risk' && <RiskTab nodes={nodes} />}
          {activeTab === 'telemetry' && <TelemetryTab readings={readings} scenarioStep={scenarioStep} />}
          {activeTab === 'remediation' && <RemediationTab />}
          {activeTab === 'parity' && (
            <ParityTab
              parityResults={parityResults}
              onRunParity={onRunParity}
              isRunning={isRunningParity}
            />
          )}
          {activeTab === 'actions' && <ActionsTab actions={actions} />}
          {activeTab === 'eval' && <EvalTab report={evalReport} />}
        </div>
      )}
    </div>
  );
};

