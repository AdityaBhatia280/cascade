import React from 'react';
import { ShieldCheck, Mail, Calendar, Phone, Check, X, Clock } from 'lucide-react';
import type { Action } from '../../types';

interface Props {
  actions: Action[];
}

export const ActionsTab: React.FC<Props> = ({ actions }) => {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={18} color="#38bdf8" />
          IMMUTABLE COMPLIANCE AUDIT TRAIL
        </h3>
        <p style={{ fontSize: '11px', color: '#94a3b8' }}>
          Full log of autonomous agent proposed actions, human approval decisions, cryptographic timestamps, and execution payloads.
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
          gridTemplateColumns: '140px 180px 100px 120px 1fr 140px',
          backgroundColor: '#0f172a',
          padding: '10px 14px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#94a3b8',
          borderBottom: '1px solid #1e293b',
          textTransform: 'uppercase'
        }}>
          <div>Tool</div>
          <div>Recipient</div>
          <div>Status</div>
          <div>Approved By</div>
          <div>Payload / Content</div>
          <div>Timestamp</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {actions.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
              No actions triggered yet. Run the incident scenario to generate remediation actions.
            </div>
          ) : (
            actions.map((act) => (
              <div
                key={act.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 180px 100px 120px 1fr 140px',
                  alignItems: 'center',
                  padding: '10px 14px',
                  fontSize: '12px',
                  borderBottom: '1px solid #111827',
                }}
              >
                <div style={{ fontFamily: 'JetBrains Mono', color: '#38bdf8', fontWeight: 600 }}>
                  {act.tool}
                </div>
                <div style={{ color: '#f8fafc', fontWeight: 500, fontSize: '11px' }}>
                  {act.recipient}
                </div>
                <div>
                  <span style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: act.status === 'approved' || act.status === 'executed' ? '#064e3b' :
                                     act.status === 'rejected' ? '#450a0a' : '#451a03',
                    color: act.status === 'approved' || act.status === 'executed' ? '#34d399' :
                           act.status === 'rejected' ? '#f87171' : '#fbbf24',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>
                    {act.status}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                  {act.approved_by || 'Awaiting Gate'}
                </div>
                <div style={{
                  color: '#cbd5e1',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {act.content}
                </div>
                <div style={{ color: '#64748b', fontSize: '10px', fontFamily: 'JetBrains Mono' }}>
                  {act.executed_at ? new Date(act.executed_at).toLocaleTimeString() : 'Pending'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

