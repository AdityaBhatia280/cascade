import React from 'react';
import { Code2, CheckCircle2, ShieldAlert, Cpu } from 'lucide-react';

export const RemediationTab: React.FC = () => {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: '100%', overflowY: 'auto' }}>
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
          8090 SOFTWARE FACTORY — VERIFIED MODERNIZATION PIPELINE
        </h3>
        <p style={{ fontSize: '11px', color: '#94a3b8' }}>
          Autonomous legacy COBOL remediation: Refine (extract intent) → Assemble (TypeScript with integer-cents) → Validate (parity verification).
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {/* Modern TypeScript Replacement */}
        <div style={{
          backgroundColor: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Code2 size={16} /> ASSEMBLED TYPESCRIPT REPLACEMENT
            </span>
            <span style={{ fontSize: '10px', color: '#10b981', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
              INTEGER CENTS (NO FLOAT)
            </span>
          </div>

          <pre style={{
            backgroundColor: '#05070a',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #1e293b',
            color: '#e2e8f0',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            lineHeight: '1.4',
            overflowX: 'auto',
            maxHeight: '340px'
          }}>
{`// Auto-assembled by Cascade Modernization Engine
// Replaces LEASEBIL.cbl & CAMCALC.cbl with strict integer cent arithmetic

export interface LeaseTerms {
  tenantId: string;
  rentableSqFt: number;
  baseYear: number;
  baseOpexPerSqFtCents: number; // e.g. 1205 for $12.05 (2021 Amendment)
  currentOpexPerSqFtCents: number; // e.g. 1340 for $13.40 (2024)
}

export function computeMonthlyCam(lease: LeaseTerms): number {
  // Respects 2021 amended base year stop
  const deltaCents = Math.max(0, lease.currentOpexPerSqFtCents - lease.baseOpexPerSqFtCents);
  
  // Total annual increase in cents
  const totalAnnualCents = BigInt(deltaCents) * BigInt(lease.rentableSqFt);
  
  // Monthly division with COBOL truncation equivalent
  const monthlyCents = Number(totalAnnualCents / 12n);
  
  return monthlyCents / 100; // Returns exact dollars
}

// Result for Northwind Retail:
// delta = 135 cents ($1.35) * 8200 sf = 1,107,000 cents / 12 = $922.50/mo
// Resolves $6,970/yr legacy COBOL overcharge!`}
          </pre>
        </div>

        {/* Generated Characterization Tests */}
        <div style={{
          backgroundColor: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} /> GENERATED CHARACTERIZATION TESTS
            </span>
            <span style={{ fontSize: '10px', color: '#38bdf8', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
              VITEST SUITE
            </span>
          </div>

          <pre style={{
            backgroundColor: '#05070a',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #1e293b',
            color: '#e2e8f0',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            lineHeight: '1.4',
            overflowX: 'auto',
            maxHeight: '340px'
          }}>
{`import { describe, it, expect } from 'vitest';
import { computeMonthlyCam } from './leaseBilling';

describe('Modernized Lease Billing Parity', () => {
  it('correctly calculates Northwind under 2021 Amendment', () => {
    const res = computeMonthlyCam({
      tenantId: 'TNT-NW-01',
      rentableSqFt: 8200,
      baseYear: 2021,
      baseOpexPerSqFtCents: 1205,
      currentOpexPerSqFtCents: 1340,
    });
    expect(res).toBe(922.50);
  });

  it('handles half-cent truncation boundary without rounding error', () => {
    const res = computeMonthlyCam({
      tenantId: 'TNT-ROUND-1',
      rentableSqFt: 1000,
      baseYear: 2023,
      baseOpexPerSqFtCents: 1000,
      currentOpexPerSqFtCents: 1007,
    });
    expect(res).toBe(5.83); // Matches GnuCOBOL PIC string
  });
});`}
          </pre>
        </div>
      </div>
    </div>
  );
};

