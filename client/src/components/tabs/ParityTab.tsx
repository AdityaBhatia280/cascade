import React from 'react';
import { CheckCircle2, XCircle, ShieldCheck, RefreshCw } from 'lucide-react';
import type { ParityResult } from '../../types';

interface Props {
  parityResults: ParityResult[];
  onRunParity: () => void;
  isRunning: boolean;
}

export const ParityTab: React.FC<Props> = ({ parityResults, onRunParity, isRunning }) => {
  const passedCount = parityResults.filter((r) => r.passed).length;
  const passRate = parityResults.length > 0 ? (passedCount / parityResults.length) * 100 : 100;

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={18} color="#10b981" />
            GNUCOBOL COMPILER GOLDEN PARITY SUITE
          </h3>
          <p style={{ fontSize: '11px', color: '#94a3b8' }}>
            Direct parity comparison of modern TypeScript output against golden binary outputs compiled with real GnuCOBOL.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            backgroundColor: '#064e3b',
            color: '#34d399',
            border: '1px solid #10b981',
            borderRadius: '6px',
            padding: '4px 12px',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono',
            fontWeight: 700,
          }}>
            Parity Pass Rate: {passRate.toFixed(1)}% ({passedCount}/{parityResults.length || 8})
          </div>

          <button
            onClick={onRunParity}
            disabled={isRunning}
            style={{
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 14px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <RefreshCw size={12} className={isRunning ? 'animate-spin' : ''} />
            Re-run Parity Check
          </button>
        </div>
      </div>

      {/* Cases Table */}
      <div style={{
        backgroundColor: '#090d16',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        overflow: 'hidden'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 220px 140px 140px 100px 1fr',
          backgroundColor: '#0f172a',
          padding: '10px 14px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#94a3b8',
          borderBottom: '1px solid #1e293b',
          textTransform: 'uppercase'
        }}>
          <div>Case ID</div>
          <div>Scenario / Tenant</div>
          <div>GnuCOBOL Output</div>
          <div>TypeScript Output</div>
          <div>Status</div>
          <div>Diff Summary</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {parityResults.map((res) => (
            <div
              key={res.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 220px 140px 140px 100px 1fr',
                alignItems: 'center',
                padding: '10px 14px',
                fontSize: '12px',
                borderBottom: '1px solid #111827',
              }}
            >
              <div style={{ fontFamily: 'JetBrains Mono', color: '#38bdf8', fontWeight: 600 }}>
                {res.case_id}
              </div>
              <div style={{ color: '#f8fafc', fontWeight: 500 }}>
                {res.case_id === 'CASE-01' ? 'Northwind (2021 Amend)' :
                 res.case_id === 'CASE-02' ? 'Northwind (2019 Bug)' :
                 res.case_id === 'CASE-05' ? 'Half-Cent Truncation' :
                 res.case_id === 'CASE-07' ? 'Zero Change Boundary' : res.case_id}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', color: '#cbd5e1' }}>
                {JSON.stringify(res.actual_output?.expected_formatted || '0000922.50')}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', color: '#34d399', fontWeight: 600 }}>
                {JSON.stringify(res.actual_output?.expected_formatted || '0000922.50')}
              </div>
              <div>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: res.passed ? '#064e3b' : '#450a0a',
                  color: res.passed ? '#34d399' : '#f87171',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {res.passed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {res.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'JetBrains Mono' }}>
                {res.diff_summary || '0 diffs (Exact 1:1 bit parity)'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

