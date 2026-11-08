import React from 'react';
import { ShieldCheck, Mail, Calendar, Phone, AlertCircle, Check, X } from 'lucide-react';
import type { Action } from '../types';

interface Props {
  actions: Action[];
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
  onClose: () => void;
}

export const ApprovalModal: React.FC<Props> = ({
  actions,
  onApprove,
  onReject,
  onClose,
}) => {
  if (actions.length === 0) return null;

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'send_email': return <Mail size={16} color="#38bdf8" />;
      case 'schedule_maintenance': return <Calendar size={16} color="#fbbf24" />;
      case 'place_call': return <Phone size={16} color="#34d399" />;
      default: return <AlertCircle size={16} color="#f87171" />;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        width: '640px',
        maxHeight: '85vh',
        backgroundColor: '#0d121d',
        border: '1px solid #334155',
        borderRadius: '8px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#e2e8f0',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #1e293b',
          backgroundColor: '#111827',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', padding: '6px', borderRadius: '6px' }}>
              <ShieldCheck size={20} color="#38bdf8" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc' }}>
                HUMAN APPROVAL GATE
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                NVIDIA Nemotron proposed external actions — human oversight required before execution
              </div>
            </div>
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
            <X size={20} />
          </button>
        </div>

        {/* Content list */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {actions.map((act) => (
            <div
              key={act.id}
              style={{
                backgroundColor: '#07090e',
                border: '1px solid #1e293b',
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {/* Tool & Target */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {getToolIcon(act.tool)}
                  <span style={{ fontWeight: 700, fontSize: '13px', fontFamily: 'JetBrains Mono', color: '#f8fafc' }}>
                    {act.tool}
                  </span>
                </div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#ef4444',
                  fontFamily: 'JetBrains Mono',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                  Impact: ${act.dollar_impact_usd.toLocaleString()}
                </span>
              </div>

              {/* Recipient */}
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                Target Recipient: <strong style={{ color: '#cbd5e1' }}>{act.recipient}</strong>
              </div>

              {/* Message Payload */}
              <div style={{
                backgroundColor: '#0f172a',
                padding: '10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono',
                color: '#cbd5e1',
                lineHeight: '1.4',
                borderLeft: '3px solid #38bdf8'
              }}>
                {act.content}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                  onClick={() => onReject(act.id)}
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#f87171',
                    border: '1px solid #ef4444',
                    borderRadius: '4px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <X size={12} />
                  Reject
                </button>
                <button
                  onClick={() => onApprove(act.id)}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#022c22',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '6px 18px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Check size={14} />
                  Approve & Execute
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #1e293b',
          backgroundColor: '#090d16',
          fontSize: '11px',
          color: '#64748b',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>All approved actions are logged to the immutable audit trail.</span>
          <button
            onClick={onClose}
            style={{
              backgroundColor: '#1e293b',
              color: '#cbd5e1',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

