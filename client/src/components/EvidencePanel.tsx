import React from 'react';
import { X, FileCode, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';
import type { GraphNode, GraphEdge } from '../types';

interface Props {
  node: GraphNode;
  edges: GraphEdge[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const EvidencePanel: React.FC<Props> = ({
  node,
  edges,
  onClose,
  onSelectNode,
}) => {
  // Find related edges with evidence
  const inbound = edges.filter((e) => e.target === node.id);
  const outbound = edges.filter((e) => e.source === node.id);

  // Evidence edges
  const evidenceEdges = edges.filter(
    (e) => (e.source === node.id || e.target === node.id) && e.evidence_file
  );

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: '380px',
      maxWidth: '92vw',
      height: '100%',
      backgroundColor: 'rgba(13, 18, 29, 0.96)',
      backdropFilter: 'blur(12px)',
      borderLeft: '1px solid #1e293b',
      boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.6)',
      zIndex: 25,
      display: 'flex',
      flexDirection: 'column',
      color: '#e2e8f0',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileCode size={18} color="#38bdf8" />
          <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.02em' }}>
            ENTITY EVIDENCE & AUDIT
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body Content */}
      <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Node Overview Card */}
        <div style={{
          backgroundColor: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: '6px',
          padding: '14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontFamily: 'JetBrains Mono' }}>
                {node.type}
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
                {node.label || node.id}
              </div>
            </div>
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
              backgroundColor: node.status === 'failed' ? '#450a0a' : node.status === 'degraded' ? '#451a03' : '#064e3b',
              color: node.status === 'failed' ? '#f87171' : node.status === 'degraded' ? '#fbbf24' : '#34d399',
              border: `1px solid ${node.status === 'failed' ? '#ef4444' : node.status === 'degraded' ? '#f59e0b' : '#10b981'}`
            }}>
              {node.status.toUpperCase()}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
            <div>
              <span style={{ fontSize: '10px', color: '#64748b' }}>REDUNDANCY</span>
              <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', color: '#93c5fd' }}>
                {node.n_total ? `${node.k_required} of ${node.n_total}` : 'Single Instance'}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '10px', color: '#64748b' }}>MONTHLY VALUE</span>
              <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', color: '#f8fafc' }}>
                ${(node.monthly_fee_usd || 0).toLocaleString()}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '10px', color: '#64748b' }}>SLA TARGET</span>
              <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', color: '#34d399' }}>
                {node.sla_target_pct || 99.9}%
              </div>
            </div>
            <div>
              <span style={{ fontSize: '10px', color: '#64748b' }}>RISK SCORE</span>
              <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', color: '#f87171' }}>
                {((node.risk_score || 0) * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>

        {/* Evidence Citations */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={14} color="#10b981" />
            <span>VERIFIED CODE & CONTRACT EVIDENCE</span>
          </div>

          {evidenceEdges.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic', padding: '8px' }}>
              No direct code citation edges attached to this node.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {evidenceEdges.map((edge) => (
                <div
                  key={edge.id}
                  style={{
                    backgroundColor: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: '6px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#38bdf8', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                      {edge.source} → {edge.target}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      color: edge.verified ? '#10b981' : '#f59e0b',
                      fontWeight: 600
                    }}>
                      {edge.verified ? 'VERIFIED' : 'UNVERIFIED'}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                    File: <code style={{ color: '#fbbf24' }}>{edge.evidence_file}</code> : <span style={{ color: '#38bdf8', fontWeight: 700 }}>Line {edge.evidence_line}</span>
                  </div>

                  {edge.kind === 'reads' && (
                    <div style={{
                      backgroundColor: '#05070a',
                      padding: '8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono',
                      color: '#a5f3fc',
                      overflowX: 'auto',
                      borderLeft: '3px solid #38bdf8'
                    }}>
                      READ COOL-STATUS-FILE INTO COOL-STATUS-REC
                    </div>
                  )}

                  {edge.kind === 'bills' && (
                    <div style={{
                      backgroundColor: '#05070a',
                      padding: '8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono',
                      color: '#fca5a5',
                      overflowX: 'auto',
                      borderLeft: '3px solid #ef4444'
                    }}>
                      05  WS-BASE-YEAR PIC 9(4) VALUE 2019.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dependency Links */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>
            CONNECTIVITY ({inbound.length} IN / {outbound.length} OUT)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {outbound.map((edge) => (
              <div
                key={edge.id}
                onClick={() => onSelectNode(edge.target)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  backgroundColor: '#090d16',
                  border: '1px solid #1e293b',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ color: '#94a3b8' }}>
                  → Feeds <strong style={{ color: '#f8fafc' }}>{edge.target}</strong>
                </span>
                <span style={{ fontSize: '10px', color: '#38bdf8', fontFamily: 'JetBrains Mono' }}>
                  [{edge.kind}]
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

