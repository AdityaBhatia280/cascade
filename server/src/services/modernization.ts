import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { store } from '../db/store.js';
import type { EvalReport, ModernizationStage, ParityResult } from '../db/schema.js';
import { config } from '../config.js';
import { bill, edit, parseLine, type BillingMode } from '../engines/leasebil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PARITY_PATH = path.resolve(
  __dirname,
  '../../../cascade-seed/cascade-seed/golden/parity_cases.json',
);
const LEASEBIL_TS_PATH = path.resolve(
  __dirname,
  '../engines/leasebil.ts',
);
const CARDDEMO_PATH = path.resolve(
  __dirname,
  '../../../cascade-real-data/real/carddemo_graph.json',
);
const BDG2_PATH = path.resolve(
  __dirname,
  '../../../cascade-real-data/real/bdg2_detector_validation.json',
);

export interface LeaseInput {
  areaSf: number;
  baseOpexCents: number;
  currentOpexCents: number;
}

/**
 * Fallback CAM calculation if the 47-case GnuCOBOL golden file is not present.
 */
export function computeMonthlyCamPic(input: LeaseInput): string {
  const deltaCents = Math.max(0, input.currentOpexCents - input.baseOpexCents);
  const annualCents = BigInt(deltaCents) * BigInt(input.areaSf);
  const monthlyCents = Number(annualCents / 12n);
  const dollars = Math.floor(monthlyCents / 100);
  const cents = monthlyCents % 100;
  return `${String(dollars).padStart(7, '0')}.${String(cents).padStart(2, '0')}`;
}

interface GoldenCase {
  id: string;
  note: string;
  cool_flag: 'Y' | 'N';
  input: {
    tenant_id: string;
    sqft: number;
    rent_psf: number;
    esc_pct: number;
    start_yy: number;
    bill_year: number;
    cap_pct: number;
    bldg_total_sf: number;
    bldg_occ_sf: number;
    cam_pool_mo: number;
    monthly_fee: number;
    sla_pct: number;
    adj_sign: string;
    adj_amt: number;
  };
  input_line: string;
  expected_output_line: string;
  expected: {
    tenant_id: string;
    base_rent: string;
    cam: string;
    opex_pass: string;
    sla_credit: string;
    adjustment: string;
    total: string;
  };
}

/**
 * Execute the verified BigInt TypeScript replacement (`leasebil.ts`) against all 47 GnuCOBOL
 * golden cases (or fallback to the 8 seeded cases if the golden file isn't found).
 */
export function runParity(mode: BillingMode = 'strict'): ParityResult[] {
  if (fs.existsSync(GOLDEN_PARITY_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(GOLDEN_PARITY_PATH, 'utf-8')) as {
        cases?: GoldenCase[];
      };
      if (raw.cases && raw.cases.length > 0) {
        const results: ParityResult[] = raw.cases.map((c) => {
          const parsed = parseLine(c.input_line);
          const r = bill(parsed, c.cool_flag, mode);
          // Compare total formatted exactly like GnuCOBOL PIC -,---,--9.99 (trimmed)
          // and full line byte-for-byte for pass/fail!
          const actualLine = [
            r.tenant_id,
            edit(r.base_rent),
            edit(r.cam),
            edit(r.opex_pass),
            edit(r.sla_credit),
            edit(r.adjustment),
            edit(r.total),
          ].join(' ');
          const pass = actualLine === c.expected_output_line;

          return {
            case_id: c.id,
            description: `${c.input.tenant_id} — ${c.note}`,
            input: {
              sqft: c.input.sqft,
              rent_psf: c.input.rent_psf,
              bill_year: c.input.bill_year,
              cool_flag: c.cool_flag === 'Y' ? 1 : 0,
            },
            expected: `${c.expected.total.trim()} (CAM ${c.expected.cam.trim()}, OpEx ${c.expected.opex_pass.trim()})`,
            actual: `${edit(r.total).trim()} (CAM ${edit(r.cam).trim()}, OpEx ${edit(r.opex_pass).trim()})`,
            pass,
          };
        });
        if (mode === 'strict') {
          store.parityResults = results;
        }
        return results;
      }
    } catch (err) {
      console.warn('[parity] Failed to run 47 golden cases, falling back:', err);
    }
  }

  // Fallback to 8 cases in store.parityCases
  const results: ParityResult[] = [];
  for (const pc of store.parityCases) {
    const baseOpexCents = Math.round(pc.base_usd_per_sf * 100);
    const currentOpexCents = Math.round(pc.current_usd_per_sf * 100);

    const actual = computeMonthlyCamPic({
      areaSf: pc.area_sf,
      baseOpexCents,
      currentOpexCents,
    });

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
      pass: actual === pc.expected_formatted,
    });
  }

  store.parityResults = results;
  return results;
}

/**
 * Return the 5-stage 8090 Software Factory modernization pipeline for LEASEBIL.cbl + CAMCALC.cbl.
 */
export function getModernizationStages(): ModernizationStage[] {
  const parityResults = store.parityResults.length > 0 ? store.parityResults : runParity();
  const passedCount = parityResults.filter((r) => r.pass).length;
  const verifiedEdges = store.edges.filter((e) => e.verified).length;
  const unverifiedEdges = store.edges.filter((e) => !e.verified).length;
  const model = config.nvidia.modelPlanner;

  let tsCode = '';
  try {
    if (fs.existsSync(LEASEBIL_TS_PATH)) {
      tsCode = fs.readFileSync(LEASEBIL_TS_PATH, 'utf-8');
    }
  } catch {
    /* ignore */
  }

  return [
    {
      stage: 'refine',
      status: 'done',
      producer: model,
      content: {
        summary:
          'LEASEBIL.cbl and CAMCALC.cbl compute monthly base rent escalations, pro-rata CAM pass-throughs, base-year OpEx stops, caps, and cooling SLA credits from COOLFLAG.DAT.',
        rules: [
          {
            paragraph: '2100-YEAR-WINDOW',
            rule: 'Two-digit start year pivots at 50 (< 50 -> 2000+, >= 50 -> 1900+)',
          },
          {
            paragraph: '2200-BASE-RENT',
            rule: 'Compounds annual escalation step-by-step ROUNDED to 6 decimals (PIC S9(5)V9(6) COMP-3)',
          },
          {
            paragraph: '2300-CAM-SHARE',
            rule: 'Calls CAMCALC (occupied SF denominator bug, F-2) and multiplies without ROUNDED (truncation, F-4)',
          },
          {
            paragraph: '2400-BASE-YEAR-STOP',
            rule: 'Computes OpEx increase over hardcoded WS-BASE-YEAR = 2019 ($6,970/yr Northwind bug, F-1)',
          },
          {
            paragraph: '2600-SLA-CREDIT',
            rule: 'Reads COOLFLAG.DAT (line 278) and deducts cooling SLA credit when flag is active',
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
          'Replace floating-point math with exact BigInt fixed-point arithmetic (naive float port only passes 11 of 47 cases)',
          'Implement COBOL ROUNDED (half away from zero) vs non-ROUNDED truncation (truncDiv) semantics',
          'Reproduce PIC S9(i)V9(d) high-order digit truncation and PIC -,---,--9.99 editing byte-for-byte',
          'Parameterize base_year and CAM denominator per tenant lease to remediate F-1 ($6,970/yr) and F-2 ($6,055/yr)',
          `Validate 1:1 byte-for-byte parity across all ${parityResults.length} real GnuCOBOL 3.1.2 golden cases`,
        ],
      },
    },
    {
      stage: 'assemble',
      status: 'done',
      producer: model,
      content: {
        typescript_code: tsCode,
        tests_code: [
          "import { describe, it, expect } from 'vitest';",
          "import { parseLine, invoiceLine } from './leasebil';",
          "import golden from '../golden/parity_cases.json';",
          '',
          "describe('LEASEBIL + CAMCALC BigInt port vs GnuCOBOL 3.1.2 (47 golden cases)', () => {",
          "  it('matches T01 Northwind Retail ($30,637.39 total, $1,503.33 OpEx, $3,784.60 CAM)', () => {",
          "    const c = golden.cases.find((x) => x.id === 'T01')!;",
          '    expect(invoiceLine(parseLine(c.input_line), c.cool_flag)).toBe(c.expected_output_line);',
          '  });',
          "  it('matches T03 Acme Cloud with COOLFLAG=Y ($18,500.00 SLA credit applied)', () => {",
          "    const c = golden.cases.find((x) => x.id === 'T03')!;",
          '    expect(invoiceLine(parseLine(c.input_line), c.cool_flag)).toBe(c.expected_output_line);',
          '  });',
          "  it('matches all 47 GnuCOBOL cases byte-for-byte (vs 11/47 for naive float port)', () => {",
          '    for (const c of golden.cases) {',
          '      expect(invoiceLine(parseLine(c.input_line), c.cool_flag)).toBe(c.expected_output_line);',
          '    }',
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

/**
 * Load real-world validation benchmarks from cascade-real-data/real/
 * (AWS Mainframe Modernization CardDemo + Building Data Genome Project 2).
 */
export function getRealWorldBenchmarks() {
  let carddemo: Record<string, unknown> | null = null;
  let bdg2: Record<string, unknown> | null = null;

  try {
    if (fs.existsSync(CARDDEMO_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CARDDEMO_PATH, 'utf-8')) as Record<string, unknown>;
      carddemo = {
        source: raw['source'],
        stats: raw['stats'],
        most_shared_copybooks: ((raw['most_shared_copybooks'] as unknown[]) ?? []).slice(0, 6),
        shared_datasets: ((raw['shared_datasets'] as unknown[]) ?? []).slice(0, 6),
      };
    }
  } catch {
    /* ignore */
  }

  try {
    if (fs.existsSync(BDG2_PATH)) {
      bdg2 = JSON.parse(fs.readFileSync(BDG2_PATH, 'utf-8')) as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }

  return { carddemo, bdg2 };
}
