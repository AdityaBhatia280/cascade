import React from 'react';
import { ShieldAlert, Radio } from 'lucide-react';

interface Props {
  mode: 'live' | 'replay';
  onToggleMode: () => void;
  onRunScenario: () => void;
  isRunningScenario: boolean;
}

export const DemoBanner: React.FC<Props> = ({
  mode,
  onToggleMode,
  onRunScenario,
  isRunningScenario,
}) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      backgroundColor: '#0c1322',
      borderBottom: '1px solid #1e293b',
      fontSize: '12px',
      color: '#94a3b8',
      flexShrink: 0,
      flexWrap: 'wrap',
      gap: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldAlert size={14} color="#f59e0b" />
        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
          DEMO MODE:
        </span>
        <span>Simulated environment — no real tenants or field hardware are contacted.</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button
          onClick={onRunScenario}
          disabled={isRunningScenario}
          style={{
            backgroundColor: isRunningScenario ? '#334155' : '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 12px',
            fontWeight: 600,
            cursor: isRunningScenario ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            transition: 'all 0.2s',
          }}
        >
          <Radio size={12} className={isRunningScenario ? 'animate-spin' : ''} />
          {isRunningScenario ? 'SCENARIO RUNNING...' : 'TRIGGER INCIDENT SCENARIO'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: mode === 'live' ? '#10b981' : '#64748b', fontWeight: 600 }}>LIVE</span>
          <button
            onClick={onToggleMode}
            style={{
              width: '36px',
              height: '18px',
              borderRadius: '9px',
              backgroundColor: mode === 'replay' ? '#3b82f6' : '#1e293b',
              border: '1px solid #334155',
              cursor: 'pointer',
              position: 'relative',
              padding: 0,
            }}
          >
            <div
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '7px',
                backgroundColor: '#fff',
                position: 'absolute',
                top: '1px',
                left: mode === 'replay' ? '19px' : '1px',
                transition: 'left 0.2s',
              }}
            />
          </button>
          <span style={{ color: mode === 'replay' ? '#3b82f6' : '#64748b', fontWeight: 600 }}>REPLAY</span>
        </div>
      </div>
    </div>
  );
};

