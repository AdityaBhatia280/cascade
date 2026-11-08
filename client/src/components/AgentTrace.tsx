import React, { useRef, useEffect } from 'react';
import { Bot, CheckCircle2, Clock, AlertTriangle, RefreshCw, Cpu, ChevronRight } from 'lucide-react';
import type { AgentStep } from '../types';

interface Props {
  steps: AgentStep[];
  isRunning: boolean;
}

export const AgentTrace: React.FC<Props> = ({ steps, isRunning }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps]);

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'refine': return '#38bdf8'; // Sky blue
      case 'map': return '#818cf8'; // Indigo
      case 'plan': return '#fbbf24'; // Amber
      case 'assemble': return '#34d399'; // Emerald
      case 'validate': return '#c084fc'; // Purple
      default: return '#94a3b8';
    }
  };

  return (
    <div style={{
      width: 'clamp(260px, 25vw, 320px)',
      height: '100%',
      backgroundColor: '#0a0e17',
      borderLeft: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      color: '#e2e8f0',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#0d121d',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} color="#38bdf8" />
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.04em' }}>
            NEMOTRON AGENT TRACE
          </span>
        </div>
        {isRunning && (
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: '#38bdf8',
            fontFamily: 'JetBrains Mono',
          }}>
            <RefreshCw size={12} className="animate-spin" />
            REASONING...
          </span>
        )}
      </div>

      {/* Model Spec Badge */}
      <div style={{
        padding: '6px 14px',
        backgroundColor: '#07090e',
        borderBottom: '1px solid #1e293b',
        fontSize: '10px',
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: 'JetBrains Mono',
      }}>
        <Cpu size={12} color="#10b981" />
        <span>MODEL: Nemotron-3 Super 120B / Nano 30B</span>
      </div>

      {/* Step Cards List */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {steps.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#475569',
            textAlign: 'center',
            padding: '20px',
          }}>
            <Bot size={36} color="#334155" style={{ marginBottom: '10px' }} />
            <div style={{ fontSize: '12px', fontWeight: 600 }}>Planner Standby</div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              Waiting for anomaly trigger or incident simulation to begin Refine-Map-Plan loop.
            </div>
          </div>
        ) : (
          steps.map((step) => {
            const isReplanned = step.status === 'replanned';
            return (
              <div
                key={step.id}
                style={{
                  backgroundColor: isReplanned ? '#291804' : '#0f172a',
                  border: `1px solid ${isReplanned ? '#d97706' : '#1e293b'}`,
                  borderRadius: '6px',
                  padding: '10px 12px',
                  fontSize: '11px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.2s',
                }}
              >
                {/* Stage + Tool Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: '9px',
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: `${getStageColor(step.stage)}22`,
                    color: getStageColor(step.stage),
                    border: `1px solid ${getStageColor(step.stage)}55`,
                  }}>
                    {step.stage}
                  </span>

                  <span style={{
                    fontSize: '10px',
                    color: '#64748b',
                    fontFamily: 'JetBrains Mono',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <Clock size={10} />
                    {step.latency_ms}ms
                  </span>
                </div>

                {/* Tool Name */}
                <div style={{
                  fontWeight: 600,
                  color: isReplanned ? '#f59e0b' : '#38bdf8',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {isReplanned && <AlertTriangle size={12} color="#f59e0b" />}
                  {step.tool_name}
                </div>

                {/* Result Summary */}
                <div style={{ color: '#cbd5e1', lineHeight: '1.4' }}>
                  {step.result_summary}
                </div>

                {/* Model and Status footer */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                  fontSize: '9px',
                  color: '#64748b',
                  fontFamily: 'JetBrains Mono',
                  borderTop: '1px solid #1e293b',
                  paddingTop: '4px',
                }}>
                  <span>{step.model_used.replace('nvidia/', '')}</span>
                  <span style={{
                    color: step.status === 'done' ? '#10b981' : step.status === 'error' ? '#ef4444' : '#f59e0b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}>
                    {step.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

