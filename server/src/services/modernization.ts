import { store } from '../db/store.js';
import type { EvalReport, ModernizationStage, ParityResult } from '../db/schema.js';
import { config } from '../config.js';

export interface LeaseInput {
  areaSf: number;
  baseOpexCents: number;
  currentOpexCents: number;
}

/**
 * Verified TypeScript replacement for LEASEBIL / CAMCALC monthly CAM pass-through.
 * Uses integer cents (BigInt) and preserves COBOL non-ROUNDED truncation semantics
 * on `COMPUTE WS-MONTHLY-CAM = WS-ANNUAL-CAM / 12` (PIC 9(7).99).
 */
export function computeMonthlyCamPic(input: LeaseInput): string {
  const deltaCents = Math.max(0, input.currentOpexCents - input.baseOpexCents);
  const annualCents = BigInt(deltaCents) * BigInt(input.areaSf);
  const monthlyCents = Number(annualCents / 12n);
  const dollars = Math.floor(monthlyCents / 100);
  const cents = monthlyCents % 100;
  return `${String(dollars).padStart(7, '0')}.${String(cents).padStart(2, '0')}`;
}

/**
 * Execute the real TypeScript replacement function against all 8 GnuCOBOL parity cases.
 */
export function runParity(): ParityResult[] {
  const results: ParityResult[] = [];

  for (const pc of store.parityCases) {
    const baseOpexCents = Math.round(pc.base_usd_per_sf * 100);
    const currentOpexCents = Math.round(pc.current_usd_per_sf * 100);

    const actual = computeMonthlyCamPic({
      areaSf: pc.area_sf,
      baseOpexCents,
      currentOpexCents,
    });

    const pass = actual === pc.expected_formatted;

    results.push({
      case_id: pc.id,
      description: pc.description,
      input: {
        area_sf: pc.area_sf,
        base_usd_per_sf: pc.base_usd_per_sf,
        current_usd_per_sf: pc.current_usd_per_sf,
      },
      expected: pc.expected_formatted,
      actual,
      pass,
    });
  }

  store.parityResults = results;
  return results;
}

/**
 * Return the 5-stage 8090 Software Factory modernization pipeline for LEASEBIL.cbl.
 */
export function getModernizationStages(): ModernizationStage[] {
  const parityResults = store.parityResults.length > 0 ? store.parityResults : runParity();
  const passedCount = parityResults.filter((r) => r.pass).length;
  const verifiedEdges = store.edges.filter((e) => e.verified).length;
  const unverifiedEdges = store.edges.filter((e) => !e.verified).length;
  const model = config.nvidia.modelPlanner;

  return [
    {
      stage: 'refine',
      status: 'done',
      producer: model,
      content: {
        summary:
          'LEASEBIL.cbl calculates monthly base rent escalations, pro-rata CAM pass-throughs via CAMCALC, and cooling SLA credits from COOLFLAG.DAT.',
        rules: [
          {
            paragraph: '3000-BASE-RENT-CALC',
            rule: 'Applies annual percentage escalation to base rent',
          },
          {
            paragraph: '4000-CAM-SHARE-CALC',
            rule: 'Computes OpEx increase over WS-BASE-YEAR (hardcoded 2019 at line 91) and calls CAMCALC',
          },
          {
            paragraph: '5000-SLA-CREDIT-CALC',
            rule: 'Reads COOLFLAG.DAT (line 278) and deducts 5%–30% credit by outage duration',
          },
        ],
      },
    },
    {
      stage: 'map',
      status: 'done',
      producer: 'engine/ast-parser',
      content: {
        edges_verified: verifiedEdges,
        unverified: unverifiedEdges,
      },
    },
    {
      stage: 'plan',
      status: 'done',
      producer: model,
      content: {
        steps: [
          'Parameterize base_year per tenant lease amendment (resolves $6,970/yr Northwind overcharge)',
          'Use integer cents (BigInt) for COMP-3 decimal arithmetic',
          'Preserve COBOL truncation semantics on non-ROUNDED COMPUTE statements',
          'Verify 1:1 output against 8 GnuCOBOL golden cases',
        ],
      },
    },
    {
      stage: 'assemble',
      status: 'done',
      producer: model,
      content: {
        typescript_code: [
          'export interface LeaseInput {',
          '  areaSf: number;',
          '  baseOpexCents: number;',
          '  currentOpexCents: number;',
          '}',
          '',
          'export function computeMonthlyCamPic(input: LeaseInput): string {',
          '  const deltaCents = Math.max(0, input.currentOpexCents - input.baseOpexCents);',
          '  const annualCents = BigInt(deltaCents) * BigInt(input.areaSf);',
          '  const monthlyCents = Number(annualCents / 12n);',
          '  const dollars = Math.floor(monthlyCents / 100);',
          '  const cents = monthlyCents % 100;',
          "  return `${String(dollars).padStart(7, '0')}.${String(cents).padStart(2, '0')}`;",
          '}',
        ].join('\n'),
        tests_code: [
          "describe('computeMonthlyCamPic parity with GnuCOBOL', () => {",
          "  it('matches CASE-01 Northwind 2021 amendment ($922.50)', () => {",
          "    expect(computeMonthlyCamPic({ areaSf: 8200, baseOpexCents: 1205, currentOpexCents: 1340 })).toBe('0000922.50');",
          '  });',
          "  it('matches CASE-02 Northwind 2019 hardcoded bug ($1,503.33)', () => {",
          "    expect(computeMonthlyCamPic({ areaSf: 8200, baseOpexCents: 1120, currentOpexCents: 1340 })).toBe('0001503.33');",
          '  });',
          "  it('matches CASE-05 truncation boundary ($5.83)', () => {",
          "    expect(computeMonthlyCamPic({ areaSf: 1000, baseOpexCents: 1000, currentOpexCents: 1007 })).toBe('0000005.83');",
          '  });',
          '});',
        ].join('\n'),
      },
    },
    {
      stage: 'validate',
      status: 'done',
      producer: 'engine/parity',
      content: {
        passed: passedCount,
        total: parityResults.length,
      },
    },
  ];
}

/**
 * Evaluate extracted verified edges against planted ground truth and decoys.
 */
export function getEvalReport(): EvalReport {
  const verifiedSet = new Set(
    store.edges.filter((e) => e.verified).map((e) => `${e.source}->${e.target}:${e.kind}`),
  );

  const items = store.groundTruthEdges.map((gt) => {
    const key = `${gt.source}->${gt.target}:${gt.kind}`;
    const matched = verifiedSet.has(key);
    return {
      id: gt.id,
      from: gt.source,
      to: gt.target,
      kind: gt.kind,
      is_decoy: gt.is_decoy,
      matched,
    };
  });

  const realItems = items.filter((i) => !i.is_decoy);
  const decoyItems = items.filter((i) => i.is_decoy);

  const found = realItems.filter((i) => i.matched).length;
  const total = realItems.length;
  const falsePositives = decoyItems.filter((i) => i.matched).length;

  const precision = found + falsePositives > 0 ? found / (found + falsePositives) : 1;
  const recall = total > 0 ? found / total : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1;

  return {
    found,
    total,
    false_positives: falsePositives,
    precision: +precision.toFixed(3),
    recall: +recall.toFixed(3),
    f1: +f1.toFixed(3),
    items,
  };
}
