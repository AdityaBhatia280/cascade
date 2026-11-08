// A small, complete facility for tests, written as two documents (a register and a BMS export) so
// every test runs the full path: statements → source precedence → assemble.
//
// Topology: UTIL-1 + GEN-A/GEN-B → ATS-A/ATS-B → SWGR-A/SWGR-B → UPS-A/UPS-B (input + bypass) →
// PDU-A1/PDU-B1; RPP-B2 (labelled B) is fed from UPS-A's output breaker UPS-A-2: the planted A/B
// convergence for C12 and C13. C21 is single-corded (dual PSU). The register puts C22's B cord on
// PDU-B1/2; the BMS, which wins, puts it on PDU-A1/6. Spare: breaker UPS-B-2, circuits PDU-B1/3 and PDU-B1/4.
// Cooling: one loop (2 chillers on separate headers and mechanical breakers), 3 CRAHs in DH-1.

import { assemble, type AssemblyInput } from '../facility/assemble.js';
import { siteId } from '../facility/ids.js';
import type { Statement } from '../ingest/documents.js';
import type { FactSource } from '../ingest/sources.js';
import type { EntityKind } from '../contract.js';

/** [kind, tag, field (null: the entity only exists), text written in the document, value if it is not the text itself]. */
export type Row = readonly [EntityKind, string, string | null, string, unknown?];

export const BASE: readonly Row[] = [
  ['utility', 'UTIL-1', null, 'UTIL-1'],
  ['generator', 'GEN-A', 'rating', '1000 kW'],
  ['generator', 'GEN-B', 'rating', '1000 kW'],
  ['ats', 'ATS-A', 'normal', 'UTIL-1'],
  ['ats', 'ATS-A', 'alternate', 'GEN-A'],
  ['ats', 'ATS-A', 'rating', '1000 kW'],
  ['ats', 'ATS-B', 'normal', 'UTIL-1'],
  ['ats', 'ATS-B', 'alternate', 'GEN-B'],
  ['ats', 'ATS-B', 'rating', '1000 kW'],
  ['switchgear', 'SWGR-A', 'input', 'ATS-A'],
  ['switchgear', 'SWGR-A', 'rating', '1000 kW'],
  ['switchgear', 'SWGR-A', 'labelledSide', 'A'],
  ['switchgear', 'SWGR-B', 'input', 'ATS-B'],
  ['switchgear', 'SWGR-B', 'rating', '1000 kW'],
  ['switchgear', 'SWGR-B', 'labelledSide', 'B'],
  ...(['A', 'B'] as const).flatMap((s): Row[] => [
    ['breaker', `SWGR-${s}-1`, 'bus', `SWGR-${s}`],
    ['breaker', `SWGR-${s}-1`, 'rating', '400 kW'],
    ['breaker', `SWGR-${s}-2`, 'bus', `SWGR-${s}`],
    ['breaker', `SWGR-${s}-2`, 'rating', '400 kW'],
    ['breaker', `SWGR-${s}-M`, 'bus', `SWGR-${s}`],
    ['breaker', `SWGR-${s}-M`, 'rating', '400 kW'],
    ['ups', `UPS-${s}`, 'input', `SWGR-${s}-1`],
    ['ups', `UPS-${s}`, 'bypass', `SWGR-${s}-2`],
    ['ups', `UPS-${s}`, 'batteryMin', '10 min'],
    ['ups', `UPS-${s}`, 'rating', '300 kW'],
    ['ups', `UPS-${s}`, 'labelledSide', s],
    ['breaker', `UPS-${s}-2`, 'bus', `UPS-${s}`],
    ['breaker', `UPS-${s}-2`, 'rating', '100 kW'],
    ['pdu', `PDU-${s}1`, 'input', `UPS-${s}`],
    ['pdu', `PDU-${s}1`, 'rating', '150 kW'],
    ['pdu', `PDU-${s}1`, 'labelledSide', s],
  ]),
  ['rpp', 'RPP-B2', 'input', 'UPS-A-2'],
  ['rpp', 'RPP-B2', 'rating', '60 kW'],
  ['rpp', 'RPP-B2', 'labelledSide', 'B'],
  ...[1, 2, 3, 4, 5, 6].flatMap((n): Row[] => [
    ['circuit', `PDU-A1/${n}`, 'panel', 'PDU-A1'],
    ['circuit', `PDU-A1/${n}`, 'rating', '30A 208V 3ph'],
    ['circuit', `PDU-B1/${n}`, 'panel', 'PDU-B1'],
    ['circuit', `PDU-B1/${n}`, 'rating', '30A 208V 3ph'],
  ]),
  ...[1, 2].flatMap((n): Row[] => [
    ['circuit', `RPP-B2/${n}`, 'panel', 'RPP-B2'],
    ['circuit', `RPP-B2/${n}`, 'rating', '30A 208V 3ph'],
  ]),
  ['hall', 'DH-1', 'dimensionsM', '20 x 12'],
  ['hall', 'DH-1', 'coolingIntent', 'N+1'],
  ['row', 'ROW-1', 'hall', 'DH-1'],
  ['row', 'ROW-1', 'index', '1'],
  ['row', 'ROW-2', 'hall', 'DH-1'],
  ['row', 'ROW-2', 'index', '2'],
  ...(
    [
      ['C11', 'ROW-1', 1, 'ACME', 'PDU-A1/1', 'PDU-B1/1'],
      ['C12', 'ROW-1', 2, 'ACME', 'PDU-A1/2', 'RPP-B2/1'],
      ['C13', 'ROW-1', 3, 'GLOBEX', 'PDU-A1/3', 'RPP-B2/2'],
      ['C21', 'ROW-2', 1, 'GLOBEX', 'PDU-A1/4', null],
      ['C22', 'ROW-2', 2, 'INITECH', 'PDU-A1/5', 'PDU-B1/2'],
    ] as const
  ).flatMap(([cab, row, slot, customer, a, b]): Row[] => [
    ['cabinet', cab, 'row', row],
    ['cabinet', cab, 'slot', String(slot)],
    ['cabinet', cab, 'customer', customer],
    ['cabinet', cab, 'measuredKw', '6'],
    ['cabinet', cab, 'dualPsu', 'yes'],
    ['cord', `${cab}/A`, 'labelledSide', 'A'],
    ['cord', `${cab}/A`, 'circuit', a],
    ...(b ? ([['cord', `${cab}/B`, 'labelledSide', 'B'], ['cord', `${cab}/B`, 'circuit', b]] as Row[]) : []),
  ]),
  ['customer', 'ACME', 'name', 'Acme Corp'],
  ['customer', 'GLOBEX', 'name', 'Globex'],
  ['customer', 'INITECH', 'name', 'Initech'],
  ['contract', 'MSA-ACME', 'customer', 'ACME'],
  ['contract', 'MSA-ACME', 'monthlyFeeUsd', '20000'],
  ['contract', 'MSA-ACME', 'cabinets', 'C11; C12'],
  ['contract', 'MSA-ACME', 'terms', 'A+B', { term: 'power-redundancy', level: 'A+B' }],
  ['contract', 'MSA-ACME', 'terms', 'cooling N+1', { term: 'cooling-redundancy', level: 'N+1' }],
  ['contract', 'MSA-GLOBEX', 'customer', 'GLOBEX'],
  ['contract', 'MSA-GLOBEX', 'monthlyFeeUsd', '10000'],
  ['contract', 'MSA-GLOBEX', 'cabinets', 'C13; C21'],
  ['contract', 'MSA-GLOBEX', 'terms', 'A+B', { term: 'power-redundancy', level: 'A+B' }],
  ['contract', 'MSA-INITECH', 'customer', 'INITECH'],
  ['contract', 'MSA-INITECH', 'monthlyFeeUsd', '5000'],
  ['contract', 'MSA-INITECH', 'cabinets', 'C22'],
  ['contract', 'MSA-INITECH', 'terms', 'N', { term: 'power-redundancy', level: 'N' }],
  ['loop', 'CHW-1', 'intent', 'N+1'],
  ['header', 'HDR-1', 'loop', 'CHW-1'],
  ['header', 'HDR-2', 'loop', 'CHW-1'],
  ['chiller', 'CH-1', 'header', 'HDR-1'],
  ['chiller', 'CH-1', 'power', 'SWGR-A-M'],
  ['chiller', 'CH-1', 'capacityKw', '100'],
  ['chiller', 'CH-2', 'header', 'HDR-2'],
  ['chiller', 'CH-2', 'power', 'SWGR-B-M'],
  ['chiller', 'CH-2', 'capacityKw', '100'],
  ['crah', 'CRAH-1', 'loop', 'CHW-1'],
  ['crah', 'CRAH-1', 'hall', 'DH-1'],
  ['crah', 'CRAH-1', 'power', 'SWGR-A-M'],
  ['crah', 'CRAH-1', 'capacityKw', '30'],
  ['crah', 'CRAH-2', 'loop', 'CHW-1'],
  ['crah', 'CRAH-2', 'hall', 'DH-1'],
  ['crah', 'CRAH-2', 'power', 'SWGR-B-M'],
  ['crah', 'CRAH-2', 'capacityKw', '30'],
  ['crah', 'CRAH-3', 'loop', 'CHW-1'],
  ['crah', 'CRAH-3', 'hall', 'DH-1'],
  ['crah', 'CRAH-3', 'power', 'SWGR-A-M'],
  ['crah', 'CRAH-3', 'capacityKw', '30'],
];

/** The BMS disagrees with the register about where C22's B cord is plugged. */
export const BMS: readonly Row[] = [['cord', 'C22/B', 'circuit', 'PDU-A1/6']];

/** Replace every row matching (kind, tag, field) with `text`, or drop it when text is null. */
export function setRow(rows: readonly Row[], kind: EntityKind, tag: string, field: string | null, text: string | null, value?: unknown): Row[] {
  const out = rows.filter((r) => !(r[0] === kind && r[1] === tag && r[2] === field));
  if (text !== null) out.push(value === undefined ? [kind, tag, field, text] : [kind, tag, field, text, value]);
  return out;
}

/** What one source says, row by row. */
const statements = (source: FactSource, rows: readonly Row[]): Statement[] =>
  rows.map((r) => ({ subject: { kind: r[0], tag: r[1] }, field: r[2], value: r.length > 4 ? r[4] : r[3], source }));

export function fixtureInput(rows: readonly Row[] = BASE, bms: readonly Row[] = BMS, extra: Partial<AssemblyInput> = {}): AssemblyInput {
  return { site: siteId('test'), statements: [...statements('equipment-register', rows), ...statements('bms-points', bms)], completed: [], ...extra };
}

export function fixture(rows: readonly Row[] = BASE, bms: readonly Row[] = BMS, extra: Partial<AssemblyInput> = {}) {
  return assemble(fixtureInput(rows, bms, extra));
}
