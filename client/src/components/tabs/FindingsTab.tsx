import React from 'react';
import { DollarSign, FileCode, ArrowRight, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Finding } from '../../types';

interface Props {
  findings: Finding[];
  onRemediate: (findingId: string) => void;
}

export const FindingsTab: React.FC<Props> = ({ findings, onRemediate }) => {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
            CROSS-SYSTEM AUDIT FINDINGS (CODE VS. CONTRACT)
          </h3>
          <p style={{ fontSize: '11px', color: '#94a3b8' }}>
            Discrepancies identified between legacy COBOL software implementations, physical building systems, and legal lease amendments.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {findings.map((f) => (
          <div
            key={f.id}
            style={{
              backgroundColor: '#090d16',
              border: `1px solid ${f.dollar_impact_usd > 0 ? '#b91c1c' : '#1e293b'}`,
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  backgroundColor: f.severity === 'critical' ? '#ef444422' : '#f59e0b22',
                  padding: '6px',
                  borderRadius: '6px'
                }}>
                  <AlertTriangle size={18} color={f.severity === 'critical' ? '#ef4444' : '#f59e0b'} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                    {f.title}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'JetBrains Mono' }}>
                    ID: {f.id} · Type: {f.type} · Severity: {f.severity.toUpperCase()}
                  </div>
                </div>
              </div>

              {f.dollar_impact_usd > 0 && (
                <div style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  padding: '4px 12px',
                  textAlign: 'right'
                }}>
                  <span style={{ fontSize: '10px', color: '#fca5a5', textTransform: 'uppercase' }}>Annual Impact</span>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#f87171', fontFamily: 'JetBrains Mono' }}>
                    ${f.dollar_impact_usd.toLocaleString()}/yr
                  </div>
                </div>
              )}
            </div>

            <p style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.5' }}>
              {f.description}
            </p>

            {/* Side-by-side Code vs Contract for Northwind */}
            {f.id === 'FIND-01' && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                backgroundColor: '#05070a',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #1e293b'
              }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#f87171', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileCode size={12} />
                    LEGACY COBOL CODE (LEASEBIL.cbl:91)
                  </div>
                  <pre style={{
                    backgroundColor: '#111827',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#fca5a5',
                    fontFamily: 'JetBrains Mono',
                    overflowX: 'auto'
                  }}>
{`01 WS-BILLING-FIELDS.
   05 WS-BASE-YEAR PIC 9(4) VALUE 2019.
   * Calculates OpEx over $11.20/SF
   * Result: $1,503.33 / month`}
                  </pre>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#34d399', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={12} />
                    EXECUTED LEASE AMENDMENT (northwind.txt:51)
                  </div>
                  <pre style={{
                    backgroundColor: '#111827',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#6ee7b7',
                    fontFamily: 'JetBrains Mono',
                    overflowX: 'auto'
                  }}>
{`Section 4.1 First Amendment (2021):
   "Base Year amended to calendar year 2021"
   * Amended Base OpEx: $12.05/SF
   * Correct: $922.50 / month (Diff: +$580.83/mo)`}
                  </pre>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                onClick={() => onRemediate(f.id)}
                style={{
                  backgroundColor: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                Assemble Verified Modernization Fix <ArrowRight size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

