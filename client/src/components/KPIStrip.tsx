import React from 'react';
import { DollarSign, Network, AlertTriangle, Activity, Zap } from 'lucide-react';

interface Props {
  dollarsAtRisk: number;
  depsFound: number;
  criticalModules: number;
  incidentStatus: 'NOMINAL' | 'DEGRADED' | 'CRITICAL CASCADE';
}

export const KPIStrip: React.FC<Props> = ({
  dollarsAtRisk,
  depsFound,
  criticalModules,
  incidentStatus,
}) => {
  const getStatusColor = () => {
    switch (incidentStatus) {
      case 'NOMINAL': return '#10b981';
      case 'DEGRADED': return '#f59e0b';
      case 'CRITICAL CASCADE': return '#ef4444';
      default: return '#10b981';
    }
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '10px',
      padding: '8px 16px',
      backgroundColor: '#0a0e17',
      borderBottom: '1px solid #1e293b',
      flexShrink: 0,
    }}>
      {/* Dollars at Risk */}
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dollars at Risk
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginTop: '2px', fontFamily: 'JetBrains Mono' }}>
            ${dollarsAtRisk.toLocaleString()}
          </div>
        </div>
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', padding: '8px', borderRadius: '6px' }}>
          <DollarSign size={20} color="#ef4444" />
        </div>
      </div>

      {/* Hidden Dependencies Found */}
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Hidden Deps Discovered
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginTop: '2px', fontFamily: 'JetBrains Mono' }}>
            {depsFound} <span style={{ fontSize: '13px', color: '#64748b' }}>/ 10 Planted</span>
          </div>
        </div>
        <div style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '6px' }}>
          <Network size={20} color="#38bdf8" />
        </div>
      </div>

      {/* Fragile & Critical Modules */}
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Critical SPOFs
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24', marginTop: '2px', fontFamily: 'JetBrains Mono' }}>
            {criticalModules} <span style={{ fontSize: '13px', color: '#64748b' }}>Units Affected</span>
          </div>
        </div>
        <div style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)', padding: '8px', borderRadius: '6px' }}>
          <AlertTriangle size={20} color="#fbbf24" />
        </div>
      </div>

      {/* Incident Status */}
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Incident Status
          </div>
          <div style={{
            fontSize: '16px',
            fontWeight: 700,
            color: getStatusColor(),
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: getStatusColor(),
              boxShadow: `0 0 8px ${getStatusColor()}`
            }} />
            {incidentStatus}
          </div>
        </div>
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', padding: '8px', borderRadius: '6px' }}>
          <Activity size={20} color={getStatusColor()} />
        </div>
      </div>
    </div>
  );
};

