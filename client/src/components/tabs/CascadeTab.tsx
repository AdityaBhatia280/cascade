import React from 'react';
import { Clock, AlertOctagon, TrendingUp } from 'lucide-react';
import type { CascadeStep } from '../../types';

interface Props {
  cascadeSteps: CascadeStep[];
  totalCost: number;
}

export const CascadeTab: React.FC<Props> = ({ cascadeSteps, totalCost }) => {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
            DETERMINISTIC CASCADE SIMULATION TIMELINE
          </h3>
          <p style={{ fontSize: '11px', color: '#94a3b8' }}>
            Simulates minute-by-minute propagation across physical, electrical, network, and financial dependency edges.
          </p>
        </div>
        <div style={{
          backgroundColor: '#1e293b',
          padding: '6px 14px',
          borderRadius: '6px',
          border: '1px solid #334155',
          fontSize: '12px',
          fontFamily: 'JetBrains Mono',
          color: '#f87171',
          fontWeight: 700
        }}>
          Simulated SLA Impact: ${totalCost.toLocaleString()}
        </div>
      </div>

      {cascadeSteps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#64748b', fontSize: '12px' }}>
          No cascade active. Click "Trigger Incident Scenario" or select a node to simulate propagation.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cascadeSteps.map((step, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 140px 100px 120px 1fr',
                alignItems: 'center',
                backgroundColor: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: '6px',
                padding: '10px 14px',
                fontSize: '12px',
              }}
            >
              <div style={{ color: '#38bdf8', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
                +{step.step}m
              </div>
              <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                {step.nodeId}
              </div>
              <div>
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: step.newStatus === 'failed' ? '#ef444422' : '#f59e0b22',
                  color: step.newStatus === 'failed' ? '#ef4444' : '#f59e0b',
                  border: `1px solid ${step.newStatus === 'failed' ? '#ef444455' : '#f59e0b55'}`,
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                  {step.newStatus}
                </span>
              </div>
              <div style={{ color: '#fca5a5', fontFamily: 'JetBrains Mono' }}>
                +${step.slaCredit.toLocaleString()}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                {step.reason}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

