import React from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { GraphNode } from '../../types';

interface Props {
  nodes: GraphNode[];
}

export const RiskTab: React.FC<Props> = ({ nodes }) => {
  // Sort nodes by risk score descending
  const sortedNodes = [...nodes].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
          SYSTEM RISK RANKING & FRAGILITY INDEX
        </h3>
        <p style={{ fontSize: '11px', color: '#94a3b8' }}>
          Normalized risk formula = Blast Radius (downstream tenants) × Dollars at Risk × Code/Hardware Fragility.
        </p>
      </div>

      <div style={{
        backgroundColor: '#090d16',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        overflow: 'hidden'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 100px 100px 120px 120px 1fr',
          backgroundColor: '#0f172a',
          padding: '10px 14px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#94a3b8',
          borderBottom: '1px solid #1e293b',
          textTransform: 'uppercase'
        }}>
          <div>Entity / Node</div>
          <div>Type</div>
          <div>Status</div>
          <div>Monthly Value</div>
          <div>Redundancy</div>
          <div>Risk Index</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {sortedNodes.map((n) => {
            const risk = n.risk_score || 0;
            const riskColor = risk > 0.8 ? '#ef4444' : risk > 0.5 ? '#f59e0b' : '#10b981';
            return (
              <div
                key={n.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 100px 100px 120px 120px 1fr',
                  alignItems: 'center',
                  padding: '10px 14px',
                  fontSize: '12px',
                  borderBottom: '1px solid #111827',
                  backgroundColor: risk > 0.85 ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                  {n.label || n.id}
                </div>
                <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'JetBrains Mono', textTransform: 'uppercase' }}>
                  {n.type}
                </div>
                <div>
                  <span style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: `${riskColor}22`,
                    color: riskColor,
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                    {n.status}
                  </span>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', color: '#cbd5e1' }}>
                  ${(n.monthly_fee_usd || 0).toLocaleString()}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', color: '#93c5fd', fontSize: '11px' }}>
                  {n.n_total ? `${n.k_required}-of-${n.n_total}` : 'N/A'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    flex: 1,
                    height: '6px',
                    backgroundColor: '#1e293b',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${risk * 100}%`,
                      height: '100%',
                      backgroundColor: riskColor,
                      borderRadius: '3px'
                    }} />
                  </div>
                  <span style={{
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 700,
                    fontSize: '11px',
                    color: riskColor,
                    width: '38px',
                    textAlign: 'right'
                  }}>
                    {(risk * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

