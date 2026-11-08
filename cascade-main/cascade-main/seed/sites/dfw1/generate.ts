// Regenerates the DFW1 seed documents and ground_truth.json together, so planted defects, document
// numbers and ground-truth line references cannot drift apart. Run from the repo root:
//   npx tsx seed/sites/dfw1/generate.ts
// README.md is hand-written and not touched.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = fileURLToPath(new URL('.', import.meta.url));
const docsDir = join(siteDir, 'docs');
mkdirSync(join(docsDir, 'contracts'), { recursive: true });

// ───────────────────────── customers & cabinets ─────────────────────────

type Power = '2N' | 'A+B' | 'N';
interface Customer {
  acct: string; name: string; short: string; cage: string; msa: string; of: string;
  power: Power; cooling: 'N+1' | null; availability: string; mrc: number; signed: string;
}
const CUSTOMERS: Customer[] = [
  { acct: 'C1041', name: 'Mesquite Cloud LLC', short: 'mesquite', cage: 'CG-101', msa: 'DFW-MSA-1041', of: 'OF-1041-03', power: 'A+B', cooling: 'N+1', availability: '99.999', mrc: 16940, signed: '2022-04-18' },
  { acct: 'C1077', name: 'Pecan Street Media Inc', short: 'pecan', cage: 'CG-102', msa: 'DFW-MSA-1077', of: 'OF-1077-01', power: 'N', cooling: null, availability: '99.99', mrc: 5880, signed: '2023-01-09' },
  { acct: 'C1102', name: 'Caddo AI Corp', short: 'caddo', cage: 'CG-110', msa: 'DFW-MSA-1102', of: 'OF-1102-02', power: 'A+B', cooling: 'N+1', availability: '99.999', mrc: 32400, signed: '2024-06-27' },
  { acct: 'C1129', name: 'Trinity Logistics Group', short: 'trinity', cage: 'CG-120', msa: 'DFW-MSA-1129', of: 'OF-1129-01', power: 'A+B', cooling: 'N+1', availability: '99.999', mrc: 13500, signed: '2023-08-14' },
  { acct: 'C1156', name: 'Halcyon Health Partners', short: 'halcyon', cage: 'CG-130', msa: 'DFW-MSA-1156', of: 'OF-1156-02', power: 'A+B', cooling: 'N+1', availability: '99.999', mrc: 7850, signed: '2021-11-02' },
  { acct: 'C1183', name: 'Lone Star Genomics', short: 'lonestar', cage: 'CG-131', msa: 'DFW-MSA-1183', of: 'OF-1183-01', power: '2N', cooling: 'N+1', availability: '99.999', mrc: 9275, signed: '2024-03-05' },
];
const byAcct = (a: string) => CUSTOMERS.find((c) => c.acct === a)!;

interface Cab {
  cab: string; acct: string; committed: number; measured: number; psu: 'dual' | 'single';
  amps: number; phases: 1 | 3; panels: { A: string; B: string | null }; pos: number; note?: string;
}
const cabs: Cab[] = [];
const posOdd1ph = [1, 5, 9, 13, 17, 21, 25, 29, 35, 39];
const posEven1ph = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38];
const pos3ph = [1, 7, 13, 19, 25, 31, 37, 2, 8, 14, 20, 26];

const rowA = [3.1, 3.4, 2.8, 3.6, 3.9, 3.2, 2.9, 6.2, 3.5, 3.0];
rowA.forEach((m, i) => {
  const cab = `A${String(i + 1).padStart(2, '0')}`;
  const three = cab === 'A08';
  cabs.push({ cab, acct: 'C1041', committed: three ? 7.5 : 4.0, measured: m, psu: 'dual', amps: 30, phases: three ? 3 : 1,
    panels: { A: 'PDU-1A', B: 'PDU-1B' }, pos: posOdd1ph[i]!, ...(three ? { note: '3ph whip per CR-1877' } : {}) });
});
const rowB = [3.3, 3.7, 4.2, 2.6, 2.9, 3.1, 2.4, 3.0, 2.7, 3.3];
rowB.forEach((m, i) => {
  const cab = `B${String(i + 1).padStart(2, '0')}`;
  const acct = i < 4 ? 'C1041' : 'C1077';
  const single = cab === 'B07' || cab === 'B08';
  const notes: Record<string, string> = {
    B03: 'upgraded to 8kW per OF-1041-03 (CR-2291)',
    B07: 'single feed per order',
    B08: 'single PSU appliance - single feed per order',
  };
  cabs.push({ cab, acct, committed: cab === 'B03' ? 8.0 : acct === 'C1041' ? 4.0 : 3.5, measured: m,
    psu: cab === 'B08' ? 'single' : 'dual', amps: 30, phases: 1,
    panels: { A: 'PDU-1A', B: single ? null : 'PDU-1B' }, pos: posEven1ph[i]!, ...(notes[cab] ? { note: notes[cab]! } : {}) });
});
const rowC = [14.6, 14.2, 14.9, 14.4, 14.7, 14.1, 14.8, 14.5, 14.3, 14.6, 14.0, 14.4];
rowC.forEach((m, i) => {
  cabs.push({ cab: `C${String(i + 1).padStart(2, '0')}`, acct: 'C1102', committed: 15.0, measured: m, psu: 'dual', amps: 60, phases: 3,
    panels: { A: 'PDU-2A', B: 'PDU-2B' }, pos: pos3ph[i]! });
});
const rowD = [4.8, 5.1, 4.6, 5.3, 4.9, 4.4, 5.0, 5.2, 4.7, 4.5];
rowD.forEach((m, i) => {
  const cab = `D${String(i + 1).padStart(2, '0')}`;
  const notes: Record<string, string> = {
    D03: 'B cord re-terminated during RPP-3B IR scan 2025-03 (verify)',
    D06: 'B whip not installed - see ticket 88213',
  };
  cabs.push({ cab, acct: 'C1129', committed: 6.0, measured: m, psu: 'dual', amps: 30, phases: 3,
    panels: { A: 'RPP-3A', B: cab === 'D06' ? null : 'RPP-3B' }, pos: pos3ph[i]!, ...(notes[cab] ? { note: notes[cab]! } : {}) });
});
const rowE = [5.4, 5.8, 5.1, 5.6, 5.3, 6.1, 6.6, 5.9, 6.4, 6.2];
rowE.forEach((m, i) => {
  const cab = `E${String(i + 1).padStart(2, '0')}`;
  const hal = i < 5;
  cabs.push({ cab, acct: hal ? 'C1156' : 'C1183', committed: hal ? 6.0 : 7.0, measured: m, psu: 'dual', amps: 30, phases: 3,
    panels: hal ? { A: 'RPP-4A', B: 'RPP-4B' } : { A: 'RPP-5A', B: 'RPP-5B' }, pos: pos3ph[i % 5]! });
});

// ───────────────────────── CSV helpers ─────────────────────────

const csvCell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvLine = (cells: string[]) => cells.map(csvCell).join(',');

// ───────────────────────── circuit roster ─────────────────────────

// Panel spellings as each source writes them (the roster was hand-maintained by three people).
const rosterPanel: Record<string, string> = {
  'PDU-1A': 'PDU-1A', 'PDU-1B': 'PDU 1B', 'PDU-2A': 'PDU2A', 'PDU-2B': 'PDU2B',
  'RPP-3A': 'RPP-3A', 'RPP-3B': 'RPP-3B', 'RPP-4A': 'RPP-4A', 'RPP-4B': 'RPP-4B', 'RPP-5A': 'RPP-5A', 'RPP-5B': 'RPP-5B',
};
const rosterHeader = ['acct', 'customer', 'cage', 'hall', 'row', 'cabinet', 'psu', 'cord', 'panel', 'ckt', 'poles', 'brkr_a', 'volts', 'phase', 'contract_kw', 'cab_kw_meas', 'ckt_kw_meas', 'notes'];
const rosterLines: string[] = [csvLine(rosterHeader)];
let rosterIdx = 0;
const rosterLineOf: Record<string, number> = {};
for (const c of cabs) {
  const cust = byAcct(c.acct);
  const sides: ('A' | 'B')[] = c.panels.B ? ['A', 'B'] : ['A'];
  for (const side of sides) {
    rosterIdx++;
    const panel = side === 'A' ? c.panels.A : c.panels.B!;
    // D03's B cord: the roster says RPP-3B position 13 (BMS disagrees).
    const pos = c.pos;
    const ckt = rosterIdx % 3 === 0 ? String(pos) : String(pos).padStart(2, '0');
    const share = sides.length === 2 ? (side === 'A' ? Math.round(c.measured * 52) / 100 : Math.round(c.measured * 48) / 100) : c.measured;
    const cktMeas = c.cab === 'E07' && side === 'B' ? 'n/a (BCM offline)' : share.toFixed(2);
    const volts = rosterIdx % 4 === 0 ? '208V' : '208';
    const phase = c.phases === 1 ? (rosterIdx % 2 ? '1' : '1Ø') : rosterIdx % 2 ? '3' : '3PH';
    rosterLines.push(csvLine([
      c.acct, cust.name, cust.cage, 'DH1', c.cab[0]!, c.cab, c.psu, side, rosterPanel[panel]!, ckt,
      String(c.phases === 1 ? 2 : 3), String(c.amps), volts, phase, c.committed.toFixed(1), c.measured.toFixed(1), cktMeas,
      side === 'A' || c.cab === 'D03' ? c.note ?? '' : '',
    ]));
    rosterLineOf[`${c.cab}/${side}`] = rosterLines.length;
  }
}
writeFileSync(join(docsDir, 'circuit_roster.csv'), rosterLines.join('\n') + '\n');

// ───────────────────────── equipment register ─────────────────────────

const regHeader = ['asset_id', 'tag', 'asset_class', 'manufacturer_model', 'rating', 'fed_from', 'alt_source', 'system', 'location', 'status', 'notes'];
type RegRow = [string, string, string, string, string, string, string, string, string, string];
const reg: RegRow[] = [
  ['UTIL-1', 'Utility Service', 'Oncor 12.47kV svc / pad xfmr T1', '2500 kVA', '', '', '', 'Utility yard', 'Active', 'Primary service. Feeds ATS-A and ATS-B normal side. Oncor acct 10443-221'],
  ['UTIL-2', 'Utility Service', 'Oncor 480V house service', '300 kVA', '', '', '', 'Utility yard', 'Active', 'Office / house loads only (HP-1). Not in critical path'],
  ['GEN-1', 'Generator', 'Caterpillar 3512C', '2,000 kW', '', '', 'A', 'Gen yard', 'Active', 'Standby rating. start/transfer 10 s. 4000 gal belly tank'],
  ['GEN-2', 'Generator', 'Caterpillar 3512C', '2000kW', '', '', 'B', 'Gen yard', 'Active', 'Standby rating. start/transfer 10 s. 4000 gal belly tank'],
  ['ATS-A', 'Automatic Transfer Switch', 'ASCO 7000 Series', '3000A 480V 3PH', 'UTIL-1', 'GEN-1', 'A', 'Elec Rm 1', 'Active', 'Open transition'],
  ['ATS-B', 'ATS', 'ASCO 7000 Series', '3000 A 480V 3PH', 'UTIL 1', 'GEN-2', 'B', 'Elec Rm 2', 'Active', 'Open transition'],
  ['SWGR-A', 'Switchgear', 'Square D QED-2', '3000A 480V 3PH', 'ATS-A', '', 'A', 'Elec Rm 1', 'Active', 'Main switchboard A'],
  ['SWGR-B', 'Switchgear', 'Square D QED-2', '3000A 480V 3PH', 'ATS-B', '', 'B', 'Elec Rm 2', 'Active', 'Main switchboard B'],
  ['SWGR-A CB-1', 'LV Breaker (ACB)', 'Masterpact NW12', '1200 A @ 480V 3P', 'SWGR-A', '', 'A', 'Elec Rm 1', 'Active', 'UPS-A input'],
  ['SWGR-A CB-2', 'LV Breaker (ACB)', 'Masterpact NW12', '1200 A @ 480V 3P', 'SWGR-A', '', 'A', 'Elec Rm 1', 'Active', 'UPS-A maint. bypass'],
  ['SWGR-A CB-3', 'LV Breaker (ACB)', 'Masterpact NW08', '800 A @ 480V 3P', 'SWGR-A', '', 'A', 'Elec Rm 1', 'Active', 'MCC-A (CH-1, CHWP-1, CHWP-3)'],
  ['SWGR-A CB-4', 'MCCB', 'PowerPact R', '400A 480V 3P', 'SWGR-A', '', 'A', 'Elec Rm 1', 'Active', 'MP-A mech panel: CRAH-01/03/05/07'],
  ['SWGR-A CB-5', 'LV Breaker (ACB)', 'Masterpact NW30', '3000A 480V 3P', 'SWGR-A', '', '', 'Elec Rm 1', 'Active', 'TIE to SWGR-B. NORMALLY OPEN, kirk-key interlocked with ATS-A/ATS-B mains'],
  ['SWGR-B CB-1', 'LV Breaker (ACB)', 'Masterpact NW12', '1200 A @ 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Active', 'UPS-B input'],
  ['SWGR-B CB-2', 'LV Breaker (ACB)', 'Masterpact NW12', '1200 A @ 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Active', 'UPS-B maint. bypass'],
  ['SWGR-B CB-3', 'LV Breaker (ACB)', 'Masterpact NW08', '800 A @ 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Active', 'MCC-B (CH-2, CH-3, CHWP-2)'],
  ['SWGR-B CB-4', 'MCCB', 'PowerPact R', '400A 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Active', 'MP-B mech panel: CRAH-02/04/06/08'],
  ['SWGR-B CB-5', 'LV Breaker (ACB)', 'Masterpact NW08', '800 A @ 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Spare', 'Spare'],
  ['SWGR-B CB-6', 'MCCB', 'PowerPact H', '100A 480V 3P', 'SWGR-B', '', 'B', 'Elec Rm 2', 'Active', 'Feeds RPP-5B via XFMR-5B (75kVA 480-208/120). Installed 2024 for LSG expansion'],
  ['MCC-A', 'Motor Control Center', 'Square D Model 6', '800A 480V 3PH', 'SWGR-A CB-3', '', 'A', 'Central plant', 'Active', 'Buckets: CH-1, CHWP-1, CHWP-3'],
  ['MCC-B', 'Motor Control Center', 'Square D Model 6', '800A 480V 3PH', 'SWGR-B CB-3', '', 'B', 'Central plant', 'Active', 'Buckets: CH-2, CH-3, CHWP-2'],
  ['XFMR-5B', 'Transformer', 'Square D EX 75kVA', '75 kVA', 'SWGR-B CB-6', '', 'B', 'DH-1 Row E mid', 'Active', '480-208/120V K-13'],
  ['UPS-A', 'UPS', 'Eaton 9395P-750', '750 kVA', 'SWGR-A CB-1', 'SWGR-A CB-2', 'A', 'UPS Rm A', 'Active', 'Batt: 8 min @ full load (VRLA, 2 strings). Static + maint bypass'],
  ['UPS-B', 'UPS', 'Eaton 9395P-750', '750kVA', 'SWGR-B CB-1', 'SWGR-B CB-2', 'B', 'UPS Rm B', 'Active', 'Batt: 8 min @ full load (VRLA, 2 strings). Static + maint bypass'],
  ['UPS-C', 'UPS', 'Liebert NX 225', '225 kVA', '', '', '', 'UPS Rm A', 'Retired', 'Decommissioned 2021, removed from site'],
  ['UPS-A OB-1', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-A', '', 'A', 'UPS Rm A', 'Active', 'Output board: PDU-1A'],
  ['UPS-A OB-2', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-A', '', 'A', 'UPS Rm A', 'Active', 'Output board: PDU-2A'],
  ['UPS-A OB-3', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-A', '', 'A', 'UPS Rm A', 'Active', 'Output board: PDU-3A'],
  ['UPS-B OB-1', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-B', '', 'B', 'UPS Rm B', 'Active', 'Output board: PDU-1B'],
  ['UPS-B OB-2', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-B', '', 'B', 'UPS Rm B', 'Active', 'Output board: PDU-2B'],
  ['UPS-B OB-3', 'Breaker', 'Eaton Magnum DS', '400A 480V 3P', 'UPS-B', '', 'B', 'UPS Rm B', 'Active', 'Output board: PDU-3B'],
  ['PDU-1A', 'PDU', 'Liebert FPC 150', '150 kVA', 'UPS-A OB-1', '', 'A', 'DH-1 Row A start', 'Active', '84-pos panelboard'],
  ['PDU-1B', 'PDU', 'Liebert FPC 150', '150 KVA', 'UPS-B OB-1', '', 'B', 'DH-1 Row B start', 'Active', '84-pos panelboard'],
  ['PDU-2A', 'PDU', 'Liebert FPC 150', '150 kVA', 'UPS-A OB-2', '', 'A', 'DH-1 Row C start', 'Active', 'HD row C (Caddo)'],
  ['PDU-2B', 'PDU', 'Liebert FPC 150', '150 kVA', 'UPS-B OB-2', '', 'B', 'DH-1 Row C end', 'Active', 'HD row C (Caddo)'],
  ['PDU-3A', 'PDU', 'Liebert FPC 150', '150 kVA', 'UPS-A OB-3', '', 'A', 'Elec Rm 1', 'Active', 'Sub-feed bkrs SF-1..SF-4 to RPPs'],
  ['PDU-3B', 'PDU', 'Liebert FPC 150', '150 kVA', 'UPS-B OB-3', '', 'B', 'Elec Rm 2', 'Active', 'Replaced 2023 (MOP-0117). Sub-feed bkrs SF-1..SF-2'],
  ['PDU-3A SF-1', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3A', '', 'A', 'Elec Rm 1', 'Active', 'To RPP-3A'],
  ['PDU-3A SF-2', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3A', '', 'A', 'Elec Rm 1', 'Active', 'To RPP-4A'],
  ['PDU-3A SF-3', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3A', '', 'A', 'Elec Rm 1', 'Active', 'To RPP-4B (temp during PDU-3B swap 2023, MOP-0117)'],
  ['PDU-3A SF-4', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3A', '', 'A', 'Elec Rm 1', 'Active', 'To RPP-5A'],
  ['PDU-3B SF-1', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3B', '', 'B', 'Elec Rm 2', 'Active', 'To RPP-3B'],
  ['PDU-3B SF-2', 'Sub-feed Breaker', 'Square D I-Line', '225A/208V/3ph', 'PDU-3B', '', 'B', 'Elec Rm 2', 'Spare', 'Spare (was RPP-4B before 2023)'],
  ['RPP-3A', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'PDU-3A SF-1', '', 'A', 'DH-1 Row D start', 'Active', '42-pos'],
  ['RPP-3B', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'PDU-3B SF-1', '', 'B', 'DH-1 Row D end', 'Active', '42-pos. IR scan 2025-03'],
  ['RPP-4A', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'PDU-3A SF-2', '', 'A', 'DH-1 Row E start', 'Active', '42-pos'],
  ['RPP-4B', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'PDU-3A SF-3', '', 'B', 'DH-1 Row E end', 'Active', '42-pos'],
  ['RPP-5A', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'PDU-3A SF-4', '', 'A', 'DH-1 Row E mid (E05/E06)', 'Active', '42-pos'],
  ['RPP-5B', 'Remote Power Panel', 'Square D I-Line RPP', '225A/208V/3ph', 'SWGR-B CB-6 via XFMR-5B', '', 'B', 'DH-1 Row E mid (E05/E06)', 'Active', '42-pos. LSG expansion 2024'],
  ['CH-1', 'Chiller', 'Trane CGAM 090 air-cooled', '90 TR', 'SWGR-A CB-3 (via MCC-A)', '', 'CHWS-HDR-1', 'Central plant pad', 'Active', 'Duty'],
  ['CH-2', 'Chiller', 'Trane CGAM 090 air-cooled', '90 TR', 'SWGR-B CB-3 (via MCC-B)', '', 'CHWS-HDR-2', 'Central plant pad', 'Active', 'Duty'],
  ['CH-3', 'Chiller', 'Trane CGAM 090 air-cooled', '90 TR', 'SWGR-B CB-3 (via MCC-B)', '', 'CHWS-HDR-2', 'Central plant pad', 'Active', 'Standby. Moved from MCC-A to MCC-B 2022 after bucket failure (WO-22-0418)'],
  ['CHWS-HDR-1', 'CHW Header', '8in primary supply header', '', '', '', 'CHW-LOOP-1', 'Central plant', 'Active', ''],
  ['CHWS-HDR-2', 'CHW Header', '8in primary supply header', '', '', '', 'CHW-LOOP-1', 'Central plant', 'Active', ''],
  ['CHW-LOOP-1', 'CHW Loop', 'Primary/secondary, 44F supply', '', '', '', '', 'Central plant', 'Active', 'Design N+1 (3x 90TR, 2 required at 600 kW IT build-out)'],
  ['CHWP-1', 'Pump', 'B&G e-1510 40HP VFD', '40 HP', 'SWGR-A CB-3 (via MCC-A)', '', 'CHW-LOOP-1', 'Central plant', 'Active', 'Secondary pump; sized for 400 kW @ 12F dT'],
  ['CHWP-2', 'Pump', 'B&G e-1510 40HP VFD', '40 HP', 'SWGR-B CB-3 (via MCC-B)', '', 'CHW-LOOP-1', 'Central plant', 'Active', 'Secondary pump; sized for 400 kW @ 12F dT'],
  ['CHWP-3', 'Pump', 'B&G e-1510 40HP VFD', '40 HP', 'SWGR-A CB-3 (via MCC-A)', '', 'CHW-LOOP-1', 'Central plant', 'Active', 'Secondary pump; sized for 400 kW @ 12F dT'],
];
const crahGrid: [number, number][] = [[3.0, 0.8], [9.5, 0.8], [16.0, 0.8], [22.5, 0.8], [3.0, 21.2], [9.5, 21.2], [16.0, 21.2], [22.5, 21.2]];
crahGrid.forEach(([x, z], i) => {
  const n = String(i + 1).padStart(2, '0');
  const sideA = i % 2 === 0;
  reg.push([`CRAH-${n}`, 'CRAH', 'Liebert CW106 (chilled water)', '105 kW sens.', sideA ? 'SWGR-A CB-4 (MP-A)' : 'SWGR-B CB-4 (MP-B)', '', 'CHW-LOOP-1',
    `DH-1 grid (${x.toFixed(1)}, ${z.toFixed(1)})`, 'Active', i < 4 ? 'North wall' : 'South wall']);
});
reg.push(['DH-1', 'Data Hall', '', '600 kW IT design', '', '', '', 'Bldg 1 Level 1', 'Active', '30.5 m x 22.0 m raised floor; cooling design N+1; max inlet 27 C (ASHRAE A1)']);
reg.push(['FACP-1', 'Fire Alarm Panel', 'Notifier NFS2-3030', '', '', '', '', 'Security', 'Active', 'Not tracked for power']);

const regLines = [csvLine(regHeader)];
const regLineOf: Record<string, number> = {};
const assetNumOf: Record<string, string> = {};
reg.forEach((r, i) => {
  assetNumOf[r[0]] = `EQ-${String(10230 + i * 7).padStart(6, '0')}`;
  regLines.push(csvLine([assetNumOf[r[0]], ...r]));
  regLineOf[r[0]] = regLines.length;
});
writeFileSync(join(docsDir, 'equipment_register.csv'), regLines.join('\n') + '\n');

// ───────────────────────── BMS points ─────────────────────────

const L: string[] = [];
const bmsLineOf: Record<string, number> = {};
const mark = (key: string) => { bmsLineOf[key] = L.length + 1; };
const push = (s: string) => L.push(s);
push('{');
push('  "bms_system": { "system_id": "DFW1-BMS-01", "protocol": "BACnet/IP", "vendor": "Siemens Desigo CC", "export_date": "2026-10-28", "polling_interval_sec": 15 },');
push('  "chillers": [');
const chillers = [
  { name: 'CH-1', oid: 'DEV:1100', role: 'DUTY', power: 'SWGR-A-CB3 (MCC-A)', header: 'CHWS HDR-1' },
  { name: 'CH-2', oid: 'DEV:1200', role: 'DUTY', power: 'SWGR-B-CB3 (MCC-B)', header: 'CHWS HDR-2' },
  { name: 'CH-3', oid: 'DEV:1300', role: 'STANDBY', power: 'SWGR-B-CB3 (MCC-B)', header: 'CHWS HDR-2' },
];
chillers.forEach((c, i) => {
  push('    {');
  push(`      "object_id": "${c.oid}",`);
  push(`      "name": "${c.name}",`);
  push(`      "description": "Air-cooled chiller ${i + 1}",`);
  mark(`${c.name}.role`); push(`      "chiller_role": "${c.role}",`);
  mark(`${c.name}.power`); push(`      "power_source": "${c.power}",`);
  mark(`${c.name}.header`); push(`      "header": "${c.header}",`);
  mark(`${c.name}.capacity`); push('      "capacity_tons": 90,');
  push('      "location": "Central plant pad",');
  push('      "points": [');
  push(`        { "object_id": "AI:${1101 + i * 100}", "name": "${c.name}.CHWS.Temp", "units": "degF", "alarm_high": 50 },`);
  push(`        { "object_id": "AI:${1102 + i * 100}", "name": "${c.name}.CHWR.Temp", "units": "degF" },`);
  push(`        { "object_id": "AI:${1103 + i * 100}", "name": "${c.name}.kW", "units": "kW" },`);
  push(`        { "object_id": "BI:${1104 + i * 100}", "name": "${c.name}.RunStatus", "values": { "0": "OFF", "1": "RUN" } }`);
  push('      ]');
  push(i === chillers.length - 1 ? '    }' : '    },');
});
push('  ],');
push('  "pumps": [');
const pumps = [
  { name: 'CHWP-1', power: 'SWGR-A CB-3', loop: 'CHW LOOP 1' },
  { name: 'CHWP-2', power: 'SWGR-B CB-3', loop: 'CHW LOOP 1' },
  { name: 'CHWP-3', power: 'SWGR-A CB-3', loop: 'CHW LOOP 1' },
];
pumps.forEach((p, i) => {
  push('    {');
  push(`      "object_id": "DEV:${1400 + i * 10}",`);
  push(`      "name": "${p.name}",`);
  mark(`${p.name}.power`); push(`      "power_source": "${p.power}",`);
  mark(`${p.name}.loop`); push(`      "loop": "${p.loop}",`);
  push(`      "points": [ { "object_id": "AI:${1401 + i * 10}", "name": "${p.name}.VFD.Hz", "units": "Hz" }, { "object_id": "AI:${1402 + i * 10}", "name": "${p.name}.DP", "units": "psi" } ]`);
  push(i === pumps.length - 1 ? '    }' : '    },');
});
push('  ],');
push('  "crahs": [');
crahGrid.forEach((_, i) => {
  const n = i + 1;
  const name = n === 5 ? 'CRAH-5' : `CRAH-${String(n).padStart(2, '0')}`;
  push('    {');
  push(`      "object_id": "DEV:${2100 + n}",`);
  mark(`${name}.name`); push(`      "name": "${name}",`);
  mark(`CRAH-${n}.power`); push(`      "power_source": "${i % 2 === 0 ? 'SWGR-A CB-4' : 'SWGR-B CB-4'}",`);
  mark(`CRAH-${n}.loop`); push('      "loop": "CHW-LOOP-1",');
  mark(`CRAH-${n}.zone`); push('      "zone": "DH-1",');
  mark(`CRAH-${n}.capacity`); push('      "net_sensible_kw": 105,');
  push(`      "points": [ { "object_id": "AI:${2200 + n}", "name": "${name}.SAT", "units": "degF" }, { "object_id": "AI:${2300 + n}", "name": "${name}.ValvePos", "units": "%" } ]`);
  push(i === crahGrid.length - 1 ? '    }' : '    },');
});
push('  ],');
push('  "ups": [');
(['A', 'B'] as const).forEach((s, i) => {
  push('    {');
  push(`      "object_id": "DEV:${3000 + i}",`);
  push(`      "name": "UPS-${s}",`);
  mark(`UPS-${s}.rating`); push('      "kva_rating": 750,');
  mark(`UPS-${s}.battery`); push('      "battery_runtime_min": 8,');
  push(`      "points": [ { "object_id": "AI:${3010 + i * 10}", "name": "UPS-${s}.LoadPct", "units": "%" }, { "object_id": "BI:${3011 + i * 10}", "name": "UPS-${s}.OnBypass" } ]`);
  push(i === 1 ? '    }' : '    },');
});
push('  ],');
push('  "pdus": [');
const pdus = [
  { name: 'PDU-1A', kva: 150, fed: 'UPS-A OB-1' }, { name: 'PDU-1B', kva: 150, fed: 'UPS-B OB-1' },
  { name: 'PDU 2A', kva: 150, fed: 'UPS-A OB-2' }, { name: 'PDU 2B', kva: 225, fed: 'UPS-B OB-2' },
  { name: 'PDU-3A', kva: 150, fed: 'UPS-A OB-3' }, { name: 'PDU-3B', kva: 150, fed: 'UPS-B OB-3' },
];
pdus.forEach((p, i) => {
  push('    {');
  push(`      "object_id": "DEV:${3100 + i}",`);
  mark(`${p.name}.name`); push(`      "name": "${p.name}",`);
  mark(`${p.name}.rating`); push(`      "kva_rating": ${p.kva},`);
  mark(`${p.name}.fed`); push(`      "fed_from": "${p.fed}",`);
  push(`      "points": [ { "object_id": "AI:${3110 + i}", "name": "${p.name.replace(' ', '-')}.kW", "units": "kW" } ]`);
  push(i === pdus.length - 1 ? '    }' : '    },');
});
push('  ],');
push('  "electrical_meters": [');
mark('SWGR-A-CB-1.meter'); push('    { "object_id": "AI:4001", "name": "SWGR-A.CB1.Amps", "breaker": "SWGR-A CB-1", "trip_rating_a": 1200, "volts": 480, "phases": 3 },');
mark('SWGR-B-CB-1.meter'); push('    { "object_id": "AI:4002", "name": "SWGR-B.CB1.Amps", "breaker": "SWGR-B CB-1", "trip_rating_a": 1600, "volts": 480, "phases": 3 },');
push('    { "object_id": "AI:4003", "name": "SWGR-A.Main.kW", "units": "kW" },');
push('    { "object_id": "AI:4004", "name": "SWGR-B.Main.kW", "units": "kW" }');
push('  ],');
push('  "branch_circuit_monitoring": {');
const dcabs = cabs.filter((c) => c.cab.startsWith('D'));
const point = (o: Record<string, string | number>) => JSON.stringify(o).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }');

// Documented spare branch circuits: breaker installed and metered, no cord. The fix planner can only
// add or re-home cords onto these. Each is the physically obvious landing spot for one planted defect.
interface Spare { panel: string; pos: number; amps: number; phases: 1 | 3; note: string; base: number }
const SPARES: Spare[] = [
  { panel: 'RPP-3B', pos: 31, amps: 30, phases: 3, base: 5200, note: 'D06 B position; breaker installed, whip not pulled (ticket 88213)' },
  { panel: 'PDU-1B', pos: 26, amps: 30, phases: 1, base: 5400, note: 'B07 B position; breaker installed, no whip (single feed per order)' },
  ...[61, 67, 73, 79].map((pos) => ({ panel: 'PDU-1A', pos, amps: 60, phases: 3 as const, base: 5300, note: 'Caddo expansion pre-pull: 60A 3P whip to row C tray (CR-2410)' })),
];
const bcm = (panel: string): { e: string; key: string }[] => {
  const entries: { e: string; key: string }[] = [];
  for (const c of panel.startsWith('RPP-3') ? dcabs : []) {
    const side = panel === 'RPP-3A' ? 'A' : 'B';
    if (side === 'B' && !c.panels.B) continue;
    const pos = c.pos;
    if (c.cab === 'D03' && side === 'B') continue; // BMS has D03-B on RPP-3A (below), not RPP-3B
    entries.push({ key: `bcm.${c.cab}-${side}`, e: point({ object_id: `AI:${panel === 'RPP-3A' ? 5100 : 5200}${String(pos).padStart(2, '0')}`, name: `${panel}.CB${String(pos).padStart(2, '0')}.kW`, serves: `${c.cab}-${side}`, trip_a: 30, volts: 208, phases: 3 }) });
  }
  if (panel === 'RPP-3A') {
    entries.push({ key: 'bcm.D03-B', e: point({ object_id: 'AI:510026', name: 'RPP-3A.CB26.kW', serves: 'D03-B', trip_a: 30, volts: 208, phases: 3 }) });
  }
  for (const s of SPARES.filter((x) => x.panel === panel)) {
    entries.push({ key: `spare.${s.panel}/${s.pos}`, e: point({ object_id: `AI:${s.base}${s.pos}`, name: `${s.panel}.CB${s.pos}.kW`, serves: 'SPARE', trip_a: s.amps, volts: 208, phases: s.phases, note: s.note }) });
  }
  return entries;
};
const bcmPanels = ['RPP-3A', 'RPP-3B', 'PDU-1A', 'PDU-1B'];
bcmPanels.forEach((panel, pi) => {
  push(`    "${panel}": [`);
  const es = bcm(panel);
  es.forEach(({ e, key }, i) => {
    mark(key);
    push(`      ${e}${i === es.length - 1 ? '' : ','}`);
  });
  push(pi === bcmPanels.length - 1 ? '    ]' : '    ],');
});
push('  }');
push('}');
const bmsText = L.join('\n') + '\n';
JSON.parse(bmsText);
writeFileSync(join(docsDir, 'bms_points.json'), bmsText);

// ───────────────────────── contracts ─────────────────────────

const cabsOf = (acct: string) => cabs.filter((c) => c.acct === acct);
const ranges = (list: string[]) => {
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j + 1 < list.length && list[j + 1]![0] === list[i]![0] && Number(list[j + 1]!.slice(1)) === Number(list[j]!.slice(1)) + 1) j++;
    out.push(j > i ? `${list[i]}-${list[j]}` : list[i]!);
    i = j + 1;
  }
  return out.join('; ');
};
const powerText: Record<Power, string> = {
  '2N': '2N - two (2) independent UPS systems, each capable of carrying the full Customer load',
  'A+B': 'A+B - dual power feeds from diverse PDUs/RPPs',
  N: 'N - single power feed (non-redundant)',
};
const contractLineOf: Record<string, number> = {};
for (const cu of CUSTOMERS) {
  const msa: string[] = [];
  const add = (a: string[], s: string) => a.push(s);
  add(msa, `MASTER SERVICES AGREEMENT No. ${cu.msa}`);
  add(msa, 'DFW1 Data Center - 4200 Lakeshore Industrial Pkwy, Garland, TX');
  add(msa, '');
  add(msa, `Customer: ${cu.name} (Account ${cu.acct})`);
  add(msa, `Effective Date: ${cu.signed}`);
  add(msa, '');
  add(msa, '[EXCERPT - Sections 1-6 omitted]');
  add(msa, '');
  add(msa, '7. SERVICE LEVELS');
  if (cu.short === 'caddo') {
    // Wrapped across lines the way the PDF export left it: no single line states the full commitment.
    add(msa, `7.1 Availability Commitment. Provider will maintain Power Availability of ${cu.availability}% per`);
    add(msa, '    calendar month for each Licensed Cabinet, excluding Scheduled Maintenance as defined in Section 9.');
  } else if (cu.short === 'halcyon') {
    add(msa, `7.1 Availability Commitment. Power Availability shall be ${cu.availability}% per calendar month, excluding Scheduled Maintenance (Section 9).`);
  } else {
    add(msa, `7.1 Availability Commitment. Provider will maintain Power Availability of ${cu.availability}% per calendar month, excluding Scheduled Maintenance (Section 9).`);
    contractLineOf[`${cu.short}.availability`] = msa.length;
  }
  if (cu.short === 'halcyon') contractLineOf[`${cu.short}.availability`] = msa.length;
  add(msa, '7.2 Power Outage. A Power Outage occurs when a Licensed Cabinet loses power on all contracted feeds.');
  add(msa, '    For redundant (A+B or 2N) service, loss of a single feed is not a Power Outage.');
  add(msa, '7.3 Exclusions. No credit is owed where (a) the Customer is not connected to all contracted feeds,');
  add(msa, '    (b) Customer load on a redundant pair exceeds 80% of a single circuit rating, or (c) the event');
  add(msa, '    occurs during Scheduled Maintenance.');
  add(msa, '');
  add(msa, '8. SERVICE CREDITS');
  add(msa, '8.1 Credits are calculated on the Monthly Recurring Charge (MRC) of the affected Licensed Cabinets:');
  add(msa, '      Cumulative Power Outage per month      Credit');
  add(msa, '      10 - 43 minutes                         5% of MRC');
  add(msa, '      43 - 240 minutes                        10% of MRC');
  add(msa, '      240 - 720 minutes                       25% of MRC');
  add(msa, '      > 720 minutes                           50% of MRC');
  add(msa, '8.2 Total credits in any month shall not exceed 50% of the MRC. Credits are the sole and exclusive remedy');
  add(msa, '    except as provided in Section 8.3 (chronic failure termination right).');
  add(msa, '');
  add(msa, '9. SCHEDULED MAINTENANCE');
  add(msa, '9.1 Provider will give at least ten (10) business days written notice of Scheduled Maintenance.');
  add(msa, '9.2 Provider will use commercially reasonable efforts to keep at least one contracted feed energized');
  add(msa, '    during Scheduled Maintenance for redundant service.');
  writeFileSync(join(docsDir, 'contracts', `${cu.acct}-${cu.short}-msa.txt`), msa.join('\n') + '\n');

  const of: string[] = [];
  add(of, `ORDER FORM ${cu.of}`);
  add(of, `Issued under Master Services Agreement No. ${cu.msa}`);
  add(of, `Customer: ${cu.name}    Account: ${cu.acct}    Cage: ${cu.cage}`);
  add(of, `Order Date: ${cu.signed}    Term: 36 months    Site: DFW1 / Data Hall DH-1`);
  add(of, '');
  add(of, '1. PRICING');
  add(of, `1.1 Monthly Recurring Charge (MRC): $${cu.mrc.toLocaleString('en-US')}.00`);
  contractLineOf[`${cu.short}.mrc`] = of.length;
  add(of, '1.2 Non-Recurring Charge (NRC): waived');
  add(of, '');
  add(of, '2. SPACE AND POWER');
  const list = cabsOf(cu.acct).map((c) => c.cab);
  add(of, `2.1 Licensed Cabinets: ${ranges(list)}`);
  contractLineOf[`${cu.short}.cabinets`] = of.length;
  add(of, `2.2 Power Redundancy: ${powerText[cu.power]}`);
  contractLineOf[`${cu.short}.power`] = of.length;
  if (cu.cooling) {
    add(of, `2.3 Cooling Redundancy: ${cu.cooling} (chilled water plant and CRAH units)`);
    contractLineOf[`${cu.short}.cooling`] = of.length;
  } else {
    add(of, '2.3 Cooling: per Provider standard operating environment');
  }
  add(of, '2.4 Committed Power per cabinet (kW, contracted maximum average draw):');
  add(of, '      Cabinet   Circuits (each feed)          Committed');
  for (const c of cabsOf(cu.acct)) {
    const feeds = cu.power === 'N' ? (c.panels.B ? 'A+B (courtesy)' : 'A only') : 'A+B';
    const circ = `${c.amps}A/208V/${c.phases === 1 ? '1ph' : '3ph'} ${feeds}`;
    add(of, `      ${c.cab}       ${circ.padEnd(30)}${c.committed.toFixed(1)} kW`);
    contractLineOf[`${cu.short}.committed.${c.cab}`] = of.length;
  }
  add(of, '');
  add(of, '3. SPECIAL TERMS');
  if (cu.short === 'mesquite') add(of, '3.1 B03 upgraded from 4.0 kW to 8.0 kW effective 2025-07-01 (CR-2291). Circuits unchanged.');
  else if (cu.short === 'lonestar') add(of, '3.1 Expansion cabinets E06-E10 delivered on new RPP-5A/RPP-5B (2024).');
  else if (cu.short === 'pecan') add(of, '3.1 Customer acknowledges single-feed service; dual feeds, where present, are provided as a courtesy.');
  else add(of, '3.1 None.');
  writeFileSync(join(docsDir, 'contracts', `${cu.acct}-${cu.short}-order-form.txt`), of.join('\n') + '\n');
}

// ───────────────────────── Maximo work orders ─────────────────────────
// A Work Order Tracking list export (attribute names as headers, times as Maximo prints them in the
// site's local time). The saved query: DFW1 work orders reported since May 2025, the older work
// orders the register and roster cite, and the schedule for the week of Mon 2026-11-09.

// Date objects here carry site-local wall-clock time in their UTC fields, so no time zone applies.
const wall = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const addMin = (t: Date, m: number) => new Date(t.getTime() + m * 60_000);
const addDays = (t: Date, d: number) => addMin(t, d * 1440);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const maximoTime = (t: Date | null) => {
  if (!t) return '';
  const h = t.getUTCHours();
  return `${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())}/${t.getUTCFullYear()} ${pad(h % 12 || 12)}:${pad(t.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
};
const nthWeekday = (y: number, mo: number, nth: number, dow: number) => {
  const first = wall(y, mo, 1);
  return wall(y, mo, 1 + ((dow - first.getUTCDay() + 7) % 7) + (nth - 1) * 7);
};
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

let rngState = 0x0df1;
const rand = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const EXPORTED = wall(2026, 11, 8);
const HISTORY_FROM = wall(2025, 5, 1);
const WEEK_END = wall(2026, 11, 14);
const SITE_LOCATION: readonly (readonly [RegExp, string])[] = [
  [/^Elec Rm 1/, 'DFW1-ER1'], [/^Elec Rm 2/, 'DFW1-ER2'], [/^UPS Rm A/, 'DFW1-UPSA'], [/^UPS Rm B/, 'DFW1-UPSB'],
  [/^Central plant/, 'DFW1-PLANT'], [/^Gen yard/, 'DFW1-GENYD'], [/^Utility yard/, 'DFW1-UTYD'], [/^DH-1/, 'DFW1-DH1'], [/^Security/, 'DFW1-SEC'],
];
const locationOf = (tag: string) => {
  const where = reg.find((r) => r[0] === tag)![7];
  return SITE_LOCATION.find(([re]) => re.test(where))![1];
};
const LEADS = { 'DFW1-ELEC': ['JRAMIREZ', 'DOKAFOR', 'KWILLIAMS'], 'DFW1-MECH': ['TNGUYEN', 'MPATEL', 'BHOLLIS'] } as const;
type Group = keyof typeof LEADS;
const leadOf = (g: Group) => LEADS[g][between(0, LEADS[g].length - 1)]!;

type WoStatus = 'WAPPR' | 'APPR' | 'WSCH' | 'WMATL' | 'WPCOND' | 'INPRG' | 'COMP' | 'CLOSE' | 'CAN';
interface Wo {
  key: string;
  wonum?: string;
  desc: string;
  tag: string | null;
  location: string;
  status: WoStatus;
  type: 'PM' | 'CM' | 'EM' | 'CP';
  pri: number;
  sched: { start: Date; finish: Date } | null;
  act: { start: Date; finish: Date | null } | null;
  report: Date;
  statusDate: Date;
  pm: string;
  jp: string;
  group: Group;
  lead: string;
  vendor: string;
}

/** Actuals and closure for work done on schedule: a few slip a day or two, most close within a week. */
function performed(sched: Date, hours: number, slips = true): Pick<Wo, 'act' | 'status' | 'statusDate'> {
  const slip = slips && sched < addDays(EXPORTED, -7) && rand() < 0.07 ? between(1, 2) * 1440 : 0;
  const start = addMin(sched, slip + between(0, 9) * 5);
  const finish = addMin(start, Math.round((hours * 60 * (0.8 + rand() * 0.4)) / 5) * 5);
  const day = addDays(finish, between(1, 9));
  const closed = wall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 9, between(0, 11) * 5);
  return closed < EXPORTED ? { act: { start, finish }, status: 'CLOSE', statusDate: closed } : { act: { start, finish }, status: 'COMP', statusDate: finish };
}

interface PmSeries {
  tag: string; desc: string; jp: string; months: readonly number[]; nth: number; dow: number;
  at: readonly [number, number]; hours: number; group: Group; vendor: string; pri: number;
}
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const Q1 = [1, 4, 7, 10], Q2 = [2, 5, 8, 11], Q3 = [3, 6, 9, 12];
// Frequencies: NFPA 110 (monthly generator run >= 30% for 30 min, monthly ATS transfer, annual load
// bank), NFPA 70B-2023 (annual IR of switchgear / PDUs / RPPs), OEM schedules for UPS, chillers, CRAHs.
const PM_SERIES: PmSeries[] = [
  ...(['1', '2'] as const).map((n, i) => ({ tag: `GEN-${n}`, desc: `GEN-${n} MONTHLY LOAD RUN 30 MIN + ATS-${n === '1' ? 'A' : 'B'} TRANSFER TEST`, jp: 'JP-GEN-MONTHLY', months: ALL_MONTHS, nth: 2 + i, dow: FRI, at: [9, 0] as const, hours: 2, group: 'DFW1-ELEC' as const, vendor: '', pri: 3 })),
  ...(['1', '2'] as const).map((n, i) => ({ tag: `GEN-${n}`, desc: `GEN-${n} ANNUAL 2-HR LOAD BANK TEST - HOLT CAT`, jp: 'JP-GEN-LOADBANK', months: [4], nth: 2 + i, dow: TUE, at: [7, 0] as const, hours: 4, group: 'DFW1-ELEC' as const, vendor: 'HOLT-CAT', pri: 2 })),
  ...(['A', 'B'] as const).map((s) => ({ tag: `UPS-${s}`, desc: `UPS-${s} EATON 9395P SEMI-ANNUAL PM, MAINT BYPASS REQ - EATON`, jp: 'JP-UPS-SEMI', months: s === 'A' ? [5, 11] : [6, 12], nth: 2, dow: THU, at: [22, 0] as const, hours: 6, group: 'DFW1-ELEC' as const, vendor: 'EATON', pri: 2 })),
  ...(['A', 'B'] as const).map((s) => ({ tag: `UPS-${s}`, desc: `UPS-${s} QUARTERLY BATTERY OHMIC TEST - 2 STRINGS`, jp: 'JP-UPS-BATT-Q', months: Q1, nth: 3, dow: s === 'A' ? TUE : WED, at: [9, 0] as const, hours: 3, group: 'DFW1-ELEC' as const, vendor: '', pri: 3 })),
  ...[1, 2, 3].map((n) => ({ tag: `CH-${n}`, desc: `CH-${n} TRANE CGAM QUARTERLY INSPECTION - TRANE`, jp: 'JP-CH-QTR', months: Q2, nth: 1, dow: [TUE, WED, THU][n - 1]!, at: [8, 0] as const, hours: 4, group: 'DFW1-MECH' as const, vendor: 'TRANE', pri: 3 })),
  ...[1, 2, 3].map((n) => ({ tag: `CH-${n}`, desc: `CH-${n} TRANE CGAM ANNUAL OIL ANALYSIS, CH-${n} OFFLINE - TRANE`, jp: 'JP-CH-OIL', months: [[9], [11], [1]][n - 1]!, nth: 2, dow: WED, at: [7, 0] as const, hours: 8, group: 'DFW1-MECH' as const, vendor: 'TRANE', pri: 2 })),
  ...([[Q1, 1], [Q1, 3], [Q2, 1], [Q3, 1], [Q2, 2], [Q2, 3], [Q3, 3], [Q1, 2]] as const).map(([months, nth], i) => ({
    tag: `CRAH-${pad(i + 1)}`, desc: `CRAH-${pad(i + 1)} QUARTERLY FILTER CHANGE`, jp: 'JP-CRAH-FILTER', months, nth, dow: MON, at: [8, 0] as const, hours: 2, group: 'DFW1-MECH' as const, vendor: '', pri: 3,
  })),
  ...[1, 2, 3].map((n) => ({ tag: `CHWP-${n}`, desc: `CHWP-${n} QUARTERLY LUBE + VIBRATION CHECK`, jp: 'JP-PUMP-LUBE', months: Q1, nth: 4, dow: WED, at: [[8, 0], [10, 0], [13, 0]][n - 1] as [number, number], hours: 1.5, group: 'DFW1-MECH' as const, vendor: '', pri: 3 })),
  // Row C cannot ride on one PDU-2 (the failover overload), so those PMs are scanned energized.
  ...([['PDU-1A', 1, 3], ['PDU-1B', 2, 3], ['PDU-2A', 6, 3], ['PDU-2B', 7, 3], ['PDU-3A', 11, 2], ['PDU-3B', 12, 2]] as const).map(([tag, month, nth]) => ({
    tag, desc: tag.startsWith('PDU-2') ? `${tag} ANNUAL PM - ENERGIZED IR ONLY (ROW C LOAD) - VERTIV-ERS` : `${tag} ANNUAL PM - IR + TORQUE, SHUTDOWN REQ - VERTIV-ERS`,
    jp: 'JP-PDU-ANNUAL', months: [month], nth, dow: TUE, at: [14, 0] as const, hours: 4, group: 'DFW1-ELEC' as const, vendor: 'VERTIV-ERS', pri: 2,
  })),
  ...(['SWGR-A', 'RPP-3A', 'RPP-4A', 'RPP-5A', 'SWGR-B', 'RPP-3B', 'RPP-4B', 'RPP-5B'] as const).map((tag, i) => ({
    tag, desc: `${tag} ANNUAL IR SCAN - VERTIV-ERS`, jp: 'JP-IR-SCAN', months: [3], nth: 2, dow: i < 4 ? TUE : WED, at: [8 + (i % 4), 0] as const, hours: 1, group: 'DFW1-ELEC' as const, vendor: 'VERTIV-ERS', pri: 3,
  })),
  { tag: 'FACP-1', desc: 'FACP-1 ANNUAL FIRE ALARM INSPECTION - NFPA 72 - NTX-FIRE', jp: 'JP-FA-ANNUAL', months: [2], nth: 2, dow: THU, at: [9, 0], hours: 4, group: 'DFW1-ELEC', vendor: 'NTX-FIRE', pri: 3 },
];

/** History rows older than HISTORY_FROM that other documents cite, kept by the export's query. */
const CITED_OLDER_PM = new Set(['RPP-3B ANNUAL IR SCAN - VERTIV-ERS@2025-03']);
/** The planned week, with the planner's status for each. Nothing else may land in it. */
const WEEK: Record<string, WoStatus> = { 'CRAH-05': 'WSCH', 'PDU-3A': 'APPR', 'CH-2': 'APPR', 'UPS-A': 'APPR', 'GEN-1': 'APPR' };

const wos: Wo[] = [];
PM_SERIES.forEach((s, si) => {
  const pm = `PM${1001 + si}`;
  for (const y of [2025, 2026]) {
    for (const mo of s.months) {
      const day = nthWeekday(y, mo, s.nth, s.dow);
      const start = wall(y, mo, day.getUTCDate(), s.at[0], s.at[1]);
      const sched = { start, finish: addMin(start, s.hours * 60) };
      const report = wall(y, mo, day.getUTCDate() - 14, 2, 0);
      const base = { desc: s.desc, tag: s.tag, location: locationOf(s.tag), type: 'PM' as const, pri: s.pri, sched, report, pm, jp: s.jp, group: s.group, lead: leadOf(s.group), vendor: s.vendor };
      const key = `${s.desc}@${y}-${pad(mo)}`;
      if (start >= EXPORTED) {
        if (start >= WEEK_END) continue;
        const status = WEEK[s.tag];
        if (!status) throw new Error(`${key} falls in the planned week but is not one of its work orders`);
        wos.push({ key, ...base, status, act: null, statusDate: addMin(report, between(2, 4) * 1440 + between(16, 30) * 30) });
      } else if (start >= HISTORY_FROM || CITED_OLDER_PM.has(key)) {
        // PDU-3A's 2025 PM had no shutdown window, so its first de-energized PM since the 2023 re-feed is this week's.
        const desc = key === 'PDU-3A ANNUAL PM - IR + TORQUE, SHUTDOWN REQ - VERTIV-ERS@2025-11' ? 'PDU-3A ANNUAL PM - IR ONLY, NO SHUTDOWN WINDOW, TORQUE DEFERRED - VERTIV-ERS' : s.desc;
        wos.push({ key, ...base, desc, ...performed(start, s.hours) });
      }
    }
  }
});

interface OneOff {
  key: string; wonum?: string; desc: string; tag: string | null; location?: string; type: Wo['type']; pri: number; group: Group; vendor?: string;
  report: Date; sched?: readonly [Date, number]; status?: WoStatus; statusDate?: Date; act?: Wo['act'];
}
const ONE_OFFS: OneOff[] = [
  { key: 'ch3-mcc-move', wonum: 'WO-22-0418', desc: 'CH-3 MCC-A BUCKET FAILURE - REFEED CH-3 FROM MCC-B SPARE BUCKET', tag: 'CH-3', type: 'EM', pri: 1, group: 'DFW1-ELEC',
    report: wall(2022, 4, 12, 6, 42), act: { start: wall(2022, 4, 12, 7, 10), finish: wall(2022, 4, 13, 15, 30) }, status: 'CLOSE', statusDate: wall(2022, 4, 20, 10, 5) },
  { key: 'a08-3ph', desc: 'A08 REPLACE A/B WHIPS WITH 30A 3PH PER CR-1877', tag: null, location: 'DFW1-DH1', type: 'CM', pri: 3, group: 'DFW1-ELEC', report: wall(2023, 2, 6, 10, 15), sched: [wall(2023, 2, 14, 9, 0), 4] },
  { key: 'mop-0117', desc: 'PDU-3B REPLACEMENT PER MOP-0117 - VERTIV', tag: 'PDU-3B', type: 'CP', pri: 2, group: 'DFW1-ELEC', vendor: 'VERTIV',
    report: wall(2023, 5, 1, 9, 0), sched: [wall(2023, 6, 10, 6, 0), 36] },
  { key: 'mop-0117-step12', desc: 'TEMP RE-FEED RPP-4B FROM PDU-3A SF-3 (MOP-0117 STEP 12)', tag: 'RPP-4B', type: 'CP', pri: 2, group: 'DFW1-ELEC', vendor: 'VERTIV',
    report: wall(2023, 5, 1, 9, 20), sched: [wall(2023, 6, 10, 6, 0), 2] },
  { key: 'mop-0117-step31', desc: 'RETURN RPP-4B TO PDU-3B SF-2 (MOP-0117 STEP 31)', tag: 'RPP-4B', type: 'CP', pri: 2, group: 'DFW1-ELEC', vendor: 'VERTIV',
    report: wall(2023, 5, 1, 9, 25), sched: [wall(2023, 6, 11, 14, 0), 2], status: 'CAN', statusDate: wall(2023, 6, 11, 17, 45), act: null },
  { key: 'xfmr-5b', desc: 'INSTALL XFMR-5B 75KVA + SWGR-B CB-6 FOR LSG EXPANSION', tag: 'XFMR-5B', type: 'CP', pri: 2, group: 'DFW1-ELEC', report: wall(2024, 1, 22, 13, 40), sched: [wall(2024, 2, 20, 7, 0), 10] },
  { key: 'rpp-5b', desc: 'INSTALL + COMMISSION RPP-5B (LSG EXPANSION)', tag: 'RPP-5B', type: 'CP', pri: 2, group: 'DFW1-ELEC', report: wall(2024, 1, 22, 13, 55), sched: [wall(2024, 2, 22, 7, 0), 8] },
  { key: 'd03-retermination', desc: 'D03 B CORD TERMINATION HOT SPOT - RE-TERMINATE - RPP-3B', tag: 'RPP-3B', type: 'CM', pri: 2, group: 'DFW1-ELEC', report: wall(2025, 3, 12, 11, 20), sched: [wall(2025, 3, 12, 13, 0), 1] },
  { key: 'b03-upgrade', desc: 'B03 CONTRACT KW 4.0 TO 8.0 PER CR-2291 - CIRCUITS UNCHANGED', tag: null, location: 'DFW1-DH1', type: 'CM', pri: 4, group: 'DFW1-ELEC', report: wall(2025, 6, 16, 14, 5), sched: [wall(2025, 6, 24, 10, 0), 1] },
  { key: 'chwp2-vfd', desc: 'CHWP-2 VFD OVERCURRENT FAULT - RESET + INSPECT', tag: 'CHWP-2', type: 'CM', pri: 2, group: 'DFW1-MECH', report: wall(2025, 7, 8, 3, 12), sched: [wall(2025, 7, 8, 7, 0), 2] },
  { key: 'caddo-prepull', desc: 'PRE-PULL 4X 60A 3P WHIPS PDU-1A CB61-79 TO ROW C TRAY - CR-2410', tag: 'PDU-1A', type: 'CM', pri: 3, group: 'DFW1-ELEC', report: wall(2025, 9, 8, 15, 30), sched: [wall(2025, 9, 23, 22, 0), 5] },
  { key: 'upsb-jar', desc: 'UPS-B STRING 2 JAR 14 HIGH IMPEDANCE - REPLACE JAR', tag: 'UPS-B', type: 'CM', pri: 2, group: 'DFW1-ELEC', report: wall(2025, 10, 15, 13, 30), sched: [wall(2025, 10, 28, 9, 0), 3] },
  { key: 'gen2-heater', desc: 'GEN-2 BLOCK HEATER FAILED - REPLACE - HOLT CAT', tag: 'GEN-2', type: 'CM', pri: 2, group: 'DFW1-ELEC', vendor: 'HOLT-CAT', report: wall(2026, 1, 20, 6, 50), sched: [wall(2026, 1, 21, 8, 0), 3] },
  { key: 'atsb-display', desc: 'ATS-B CONTROLLER DISPLAY INOP - ASCO SERVICE', tag: 'ATS-B', type: 'CM', pri: 3, group: 'DFW1-ELEC', vendor: 'ASCO', report: wall(2026, 3, 3, 11, 0), sched: [wall(2026, 3, 17, 10, 0), 2] },
  // Heat-wave trip: NOAA LCD KDFW 42.2 C (108 F) at 15:53 and 16:53 on 2026-08-24.
  { key: 'ch2-trip', desc: 'CH-2 HIGH DISCHARGE PRESSURE TRIP - AMBIENT 108F', tag: 'CH-2', type: 'EM', pri: 1, group: 'DFW1-MECH',
    report: wall(2026, 8, 24, 16, 5), act: { start: wall(2026, 8, 24, 16, 15), finish: wall(2026, 8, 24, 18, 40) }, status: 'CLOSE', statusDate: wall(2026, 8, 27, 9, 10) },
  { key: 'ch2-coil', desc: 'CH-2 CONDENSER COIL CLEANING - TRANE', tag: 'CH-2', type: 'CM', pri: 2, group: 'DFW1-MECH', vendor: 'TRANE', report: wall(2026, 8, 25, 8, 30), sched: [wall(2026, 8, 28, 7, 0), 6] },
  { key: 'd06-whip', desc: 'PULL D06 B WHIP TO RPP-3B CB31 - TICKET 88213', tag: 'RPP-3B', type: 'CM', pri: 2, group: 'DFW1-ELEC',
    report: wall(2026, 9, 14, 10, 40), status: 'WMATL', statusDate: wall(2026, 9, 18, 14, 15), act: null },
  { key: 'crah07-fan', desc: 'CRAH-07 EC FAN 2 FAULT - REPLACE FAN - VERTIV', tag: 'CRAH-07', type: 'CM', pri: 2, group: 'DFW1-MECH', vendor: 'VERTIV',
    report: wall(2026, 11, 3, 10, 15), sched: [wall(2026, 11, 5, 8, 0), 4], status: 'INPRG', statusDate: wall(2026, 11, 5, 8, 20), act: { start: wall(2026, 11, 5, 8, 20), finish: null } },
];
for (const o of ONE_OFFS) {
  const sched = o.sched ? { start: o.sched[0], finish: addMin(o.sched[0], o.sched[1] * 60) } : null;
  const outcome = o.status ? { status: o.status, statusDate: o.statusDate!, act: o.act ?? null } : performed(sched!.start, o.sched![1], false);
  wos.push({ key: o.key, ...(o.wonum ? { wonum: o.wonum } : {}), desc: o.desc, tag: o.tag, location: o.location ?? locationOf(o.tag!), type: o.type, pri: o.pri,
    sched, report: o.report, pm: '', jp: '', group: o.group, lead: leadOf(o.group), vendor: o.vendor ?? '', ...outcome });
}

// Maximo's WONUM autokey is org-wide (NTXDC runs several sites), so DFW1's numbers advance with gaps.
const lastOfYear = new Map<number, number>();
for (const w of [...wos].sort((a, b) => a.report.getTime() - b.report.getTime() || a.key.localeCompare(b.key))) {
  const y = w.report.getUTCFullYear();
  const doy = Math.floor((w.report.getTime() - wall(y, 1, 1).getTime()) / 86_400_000) + 1;
  const n = w.wonum ? Number(w.wonum.slice(6)) : Math.max((lastOfYear.get(y) ?? 0) + 1, Math.floor(doy * 4.1) + between(0, 3));
  lastOfYear.set(y, n);
  w.wonum ??= `WO-${String(y).slice(2)}-${pad(n, 4)}`;
}
wos.sort((a, b) => a.wonum!.localeCompare(b.wonum!));

const woHeader = ['WONUM', 'DESCRIPTION', 'LOCATION', 'ASSETNUM', 'STATUS', 'WORKTYPE', 'WOPRIORITY', 'SCHEDSTART', 'SCHEDFINISH', 'ACTSTART', 'ACTFINISH', 'REPORTDATE', 'PMNUM', 'JPNUM', 'OWNERGROUP', 'LEAD', 'VENDOR', 'SITEID', 'ORGID', 'STATUSDATE'];
const woLines = [csvLine(woHeader)];
const woLineOf: Record<string, number> = {};
const woOf: Record<string, Wo> = {};
for (const w of wos) {
  if (w.desc.length > 100 || w.desc !== w.desc.toUpperCase()) throw new Error(`${w.key}: Maximo descriptions are upper case, at most 100 characters`);
  if (w.tag && !assetNumOf[w.tag]) throw new Error(`${w.key}: ${w.tag} is not in the register`);
  woLines.push(csvLine([
    w.wonum!, w.desc, w.location, w.tag ? assetNumOf[w.tag]! : '', w.status, w.type, String(w.pri),
    maximoTime(w.sched?.start ?? null), maximoTime(w.sched?.finish ?? null), maximoTime(w.act?.start ?? null), maximoTime(w.act?.finish ?? null),
    maximoTime(w.report), w.pm, w.jp, w.group, w.lead, w.vendor, 'DFW1', 'NTXDC', maximoTime(w.statusDate),
  ]));
  woLineOf[w.key] = woLines.length;
  woOf[w.key] = w;
}
const week = wos.filter((w) => w.sched && w.sched.start >= EXPORTED && !['COMP', 'CLOSE', 'CAN'].includes(w.status)).sort((a, b) => a.sched!.start.getTime() - b.sched!.start.getTime());
if (week.map((w) => w.tag).join() !== 'CRAH-05,PDU-3A,CH-2,UPS-A,GEN-1') throw new Error(`planned week is ${week.map((w) => w.tag).join()}`);
writeFileSync(join(docsDir, 'maximo_workorders.csv'), woLines.join('\n') + '\n');

// ───────────────────────── BMS and power-monitoring history ─────────────────────────
// Siemens Desigo CC (event log, trend export) and Schneider EcoStruxure PME (event history, Data
// Export - Extended). One plant and electrical model drives all four, so a chiller stop, a transfer
// or a bypass reads the same in every system and lines up with the Maximo actuals above. Outdoor
// air is NOAA LCD at KDFW; everything else is modeled (the README lists what).

const SEC = 1000, MIN = 60 * SEC, HR = 60 * MIN;
// US Central: CDT from 2026-03-08 02:00 CST until 2026-11-01 02:00 CDT.
const CDT = [Date.UTC(2026, 2, 8, 8), Date.UTC(2026, 10, 1, 7)] as const;
const offsetHr = (utc: number) => (utc >= CDT[0] && utc < CDT[1] ? 5 : 6);
const localOf = (utc: number) => new Date(utc - offsetHr(utc) * HR);
/** UTC instant of a site wall-clock time (inside the repeated fall-back hour, the CDT one). */
const utcOf = (local: Date) => (offsetHr(local.getTime() + 5 * HR) === 5 ? local.getTime() + 5 * HR : local.getTime() + 6 * HR);
const at = (local: Date, seconds = 0) => utcOf(local) + seconds * SEC;

const HIST_FROM = utcOf(wall(2026, 5, 1));
const HIST_TO = utcOf(EXPORTED);
const hrng = (() => {
  let s = 0x48157;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const hBetween = (lo: number, hi: number) => lo + Math.floor(hrng() * (hi - lo + 1));
/** Measurement noise in [-1, 1] for a channel at an instant, independent of evaluation order. */
const jitter = (channel: number, utc: number) => {
  let x = Math.imul(channel + 0x9e3779b9, 0x85ebca6b) ^ Math.floor(utc / SEC);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (((x ^ (x >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};

const external = (file: string) =>
  readFileSync(join(siteDir, 'external', file), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split(','));
// LCD timestamps are local standard time (UTC-6) all year.
const NOAA = external('noaa_kdfw_lcd_2026-06-01_2026-11-07.csv').map(([t, c]) => ({ utc: Date.parse(`${t}Z`) + 6 * HR, f: (Number(c) * 9) / 5 + 32 }));
const noaaF = (utc: number): number | null => {
  if (utc < NOAA[0]!.utc || utc > NOAA[NOAA.length - 1]!.utc) return null;
  let lo = 0, hi = NOAA.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (NOAA[mid]!.utc <= utc) lo = mid;
    else hi = mid;
  }
  const a = NOAA[lo]!, b = NOAA[hi]!;
  return b.utc === a.utc ? a.f : a.f + ((b.f - a.f) * (utc - a.utc)) / (b.utc - a.utc);
};
// NCEI publishes LCD about two weeks behind, so the file ends 2026-10-26 and November's outdoor air is
// a modeled diurnal curve: daily [low, high] in °F, low at 07:00, high at 15:00 standard time.
const NOV_OAT: Record<number, readonly [number, number]> = { 31: [56, 76], 1: [57, 77], 2: [59, 79], 3: [55, 72], 4: [47, 64], 5: [45, 66], 6: [49, 71], 7: [53, 74], 8: [55, 75] };
const NOV_FROM = utcOf(wall(2026, 10, 31));
const modeledOatF = (utc: number) => {
  const l = new Date(utc - 6 * HR);
  const h = l.getUTCHours() + l.getUTCMinutes() / 60;
  const d = l.getUTCDate();
  const day = (n: number) => NOV_OAT[n] ?? (() => { throw new Error(`no modeled outdoor air for day ${n}`); })();
  const ease = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;
  if (h >= 7 && h <= 15) return day(d)[0] + (day(d)[1] - day(d)[0]) * ease((h - 7) / 8);
  const [fromHi, toLo, x] = h > 15 ? [day(d)[1], day(d === 31 ? 1 : d + 1)[0], (h - 15) / 16] : [day(d === 1 ? 31 : d - 1)[1], day(d)[0], (h + 9) / 16];
  return fromHi + (toLo - fromHi) * ease(x);
};
// May (before the NOAA file starts) only feeds event values, never a trend; it assumes 85 °F.
const oatF = (utc: number) => noaaF(utc) ?? (utc >= NOV_FROM ? modeledOatF(utc) : 85);

// IT load: the roster's measured cabinet kW with a mild afternoon swing, split by the UPS each cord
// actually reaches (RPP-4B rides on PDU-3A, so UPS-A; RPP-5B is fed from SWGR-B through XFMR-5B, no UPS).
const IT_KW = cabs.reduce((s, c) => s + c.measured, 0);
const UPS_OF_PANEL: Record<string, 'A' | 'B' | 'X'> = {
  'PDU-1A': 'A', 'PDU-2A': 'A', 'RPP-3A': 'A', 'RPP-4A': 'A', 'RPP-5A': 'A', 'RPP-4B': 'A', 'PDU-1B': 'B', 'PDU-2B': 'B', 'RPP-3B': 'B', 'RPP-5B': 'X',
};
const itShare = { A: 0, B: 0, X: 0 };
for (const c of cabs) {
  if (c.panels.B) {
    itShare[UPS_OF_PANEL[c.panels.A]!] += (c.measured * 0.52) / IT_KW;
    itShare[UPS_OF_PANEL[c.panels.B]!] += (c.measured * 0.48) / IT_KW;
  } else itShare[UPS_OF_PANEL[c.panels.A]!] += c.measured / IT_KW;
}
const hourOf = (utc: number) => { const l = localOf(utc); return l.getUTCHours() + l.getUTCMinutes() / 60; };
const itKw = (utc: number) => IT_KW * (1 + 0.025 * Math.sin((2 * Math.PI * (hourOf(utc) - 9)) / 24) + 0.004 * jitter(1, utc));
const demandTons = (utc: number) => (itKw(utc) * 1.08) / 3.517;

// Chiller run schedule. CH-1 and CH-2 are duty, CH-3 standby; every start and stop is a RunChange.
type Chiller = 'CH-1' | 'CH-2' | 'CH-3';
const CHILLERS: readonly Chiller[] = ['CH-1', 'CH-2', 'CH-3'];
const MCC_OF: Record<Chiller, 'A' | 'B'> = { 'CH-1': 'A', 'CH-2': 'B', 'CH-3': 'B' };
const INITIAL_RUNNING: Record<Chiller, boolean> = { 'CH-1': true, 'CH-2': true, 'CH-3': false };
interface RunChange { readonly utc: number; readonly running: boolean; readonly rampMin: number }
const runs: Record<Chiller, RunChange[]> = { 'CH-1': [], 'CH-2': [], 'CH-3': [] };
const lastChange = (u: Chiller, utc: number) => {
  let c: RunChange | null = null;
  for (const r of runs[u]) {
    if (r.utc > utc) break;
    c = r;
  }
  return c;
};
const isRunning = (u: Chiller, utc: number) => lastChange(u, utc)?.running ?? INITIAL_RUNNING[u];
const loadedOf = (c: RunChange | null, u: Chiller, utc: number) => (!c ? (INITIAL_RUNNING[u] ? 1 : 0) : c.running ? Math.min(1, (utc - c.utc) / (c.rampMin * MIN)) : 0);

// ── Desigo CC event log rows ──
interface Point { readonly designation: string; readonly description: string }
interface DesigoRow {
  readonly utc: number; readonly point: Point; readonly record: 'Event' | 'Activity'; readonly message: string; readonly category: string;
  readonly eventUtc: number | null; readonly state: string; readonly cause: string; readonly instance: object | null;
  readonly action: string; readonly value: string; readonly prev: string; readonly unit: string;
}
const desigoRows: DesigoRow[] = [];
const plantPt = (tag: string, point: string, description: string): Point => ({ designation: `DFW1.Bldg1.CHW_Plant.${tag}.${point}`, description });
const hallPt = (tag: string, point: string, description: string): Point => ({ designation: `DFW1.Bldg1.DH-1.${tag}.${point}`, description });
const upsPt = (s: 'A' | 'B', point: string, description: string): Point => ({ designation: `DFW1.Bldg1.UPS_Rm_${s}.UPS-${s}.${point}`, description: `UPS-${s} ${description}` });
const crahBms = (n: number) => (n === 5 ? 'CRAH-5' : `CRAH-${pad(n)}`);
const runPt = (u: string) => plantPt(u, 'Run_Status', `${u} Run Status`);
const cmdPt = (u: string) => plantPt(u, 'Start_Stop_Cmd', `${u} Start/Stop Command`);
const enablePt = (u: string) => plantPt(u, 'Enable_Cmd', `${u} Enable Command`);

interface AlarmSpec {
  readonly point: Point; readonly message: string; readonly normal: string; readonly category: string; readonly fault?: boolean;
  readonly at: number; readonly value: string; readonly prev: string; readonly unit?: string;
  readonly ackAt: number; readonly normalAt: number | null; readonly normalValue?: string; readonly closeAt?: number;
}
/** An alarm's life as Desigo logs it: raised, acknowledged, back to normal, closed (each when it happened). */
function alarm(a: AlarmSpec): void {
  const instance = {};
  const base = { point: a.point, category: a.category, instance, unit: a.unit ?? '' };
  const ackFirst = a.normalAt === null || a.ackAt < a.normalAt;
  desigoRows.push({ ...base, utc: a.at, record: 'Event', message: a.message, eventUtc: a.at, state: 'Unprocessed', cause: a.fault ? 'To Fault' : 'To Offnormal', action: '', value: a.value, prev: a.prev });
  desigoRows.push({ ...base, utc: a.ackAt, record: 'Activity', message: a.message, eventUtc: a.at, state: ackFirst ? 'Acknowledged' : 'Ready to be closed', cause: '', action: 'Acknowledge', value: '', prev: '', unit: '' });
  if (a.normalAt === null) return;
  desigoRows.push({ ...base, utc: a.normalAt, record: 'Event', message: a.normal, eventUtc: a.normalAt, state: ackFirst ? 'Ready to be closed' : 'Unprocessed', cause: 'To Normal', action: '', value: a.normalValue ?? '', prev: a.value });
  if (a.closeAt === undefined) return;
  desigoRows.push({ ...base, utc: a.closeAt, record: 'Activity', message: a.normal, eventUtc: a.normalAt, state: 'Closed', cause: '', action: 'Close', value: '', prev: '', unit: '' });
}
const status = (point: Point, utc: number, value: string, prev: string) =>
  desigoRows.push({ utc, point, record: 'Event', message: value, category: 'Status', eventUtc: utc, state: 'Closed', cause: 'Status Changed', instance: {}, action: '', value, prev, unit: '' });
const command = (point: Point, utc: number, value: string, prev: string) =>
  desigoRows.push({ utc, point, record: 'Activity', message: '', category: '', eventUtc: null, state: '', cause: '', instance: null, action: 'Command', value, prev, unit: '' });

const startChiller = (u: Chiller, utc: number, rampMin: number) => {
  runs[u].push({ utc, running: true, rampMin });
  runs[u].sort((a, b) => a.utc - b.utc);
  status(runPt(u), utc, 'Running', 'Stopped');
};
const stopChiller = (u: Chiller, utc: number) => {
  runs[u].push({ utc, running: false, rampMin: 0 });
  runs[u].sort((a, b) => a.utc - b.utc);
  status(runPt(u), utc, 'Stopped', 'Running');
};

// ── PME event history rows ──
type PmeType = 'Pick up' | 'Drop out' | 'Instantaneous';
/** `value` may be deferred: a generator's load is only known once the plant model is complete. */
interface PmeEvent { readonly utc: number; readonly source: string; readonly event: string; readonly condition: string; readonly measurement: string; readonly value: number | (() => number); readonly type: PmeType; readonly priority: number }
const pmeEvents: PmeEvent[] = [];
const pme = (e: PmeEvent) => pmeEvents.push(e);
const ms = () => hBetween(0, 999);

// Planned chiller swaps: the standby is started and loaded before the duty unit is handed over.
const swapToStandby = (u: Chiller, workStart: number, workFinish: number) => {
  command(cmdPt('CH-3'), workStart - 15 * MIN - 30 * SEC, 'Start', 'Stop');
  startChiller('CH-3', workStart - 14 * MIN - 48 * SEC, 8);
  command(enablePt(u), workStart - 5 * MIN - 10 * SEC, 'Disable', 'Enable');
  stopChiller(u, workStart - 4 * MIN - 40 * SEC);
  command(enablePt(u), workFinish + 3 * MIN + 10 * SEC, 'Enable', 'Disable');
  startChiller(u, workFinish + 3 * MIN + 52 * SEC, 8);
  command(cmdPt('CH-3'), workFinish + 20 * MIN + 5 * SEC, 'Stop', 'Start');
  stopChiller('CH-3', workFinish + 20 * MIN + 33 * SEC);
};
const actOf = (key: string) => {
  const w = woOf[key];
  if (!w?.act?.finish) throw new Error(`${key}: no actual start and finish in the Maximo export`);
  return { start: utcOf(w.act.start), finish: utcOf(w.act.finish), report: utcOf(w.report) };
};

// The 2026-08-24 heat-wave trip (WO-26-0971). CH-2's condenser coil was fouled (cleaned 08/28 under
// WO-26-0972), so it ran in condenser pressure limit the day before and tripped on high discharge
// pressure at 16:04 with NOAA KDFW at 108 °F. High pressure cutout latches, so the sequencer starts
// CH-3 after its two-minute proof delay; CH-2 is reset at the panel and back at 18:40.
const condLimit = plantPt('CH-2', 'Cond_Limit', 'CH-2 Condenser Pressure Limit');
alarm({ point: condLimit, message: 'Condenser Pressure Limit', normal: 'Condenser Pressure Limit Cleared', category: 'Trouble', at: at(wall(2026, 8, 23, 15, 52), 6), value: 'Active', prev: 'Inactive',
  ackAt: at(wall(2026, 8, 23, 15, 55), 16), normalAt: at(wall(2026, 8, 23, 17, 41), 30), normalValue: 'Inactive', closeAt: at(wall(2026, 8, 24, 7, 12), 44) });
const trip = at(wall(2026, 8, 24, 16, 4), 12);
const ch2Back = at(wall(2026, 8, 24, 18, 40), 5);
const closeAll = at(wall(2026, 8, 24, 18, 45), 10);
if (Math.abs(trip - actOf('ch2-trip').report) > 2 * MIN || Math.abs(ch2Back - actOf('ch2-trip').finish) > MIN) throw new Error('the CH-2 trip no longer matches WO-26-0971');
alarm({ point: condLimit, message: 'Condenser Pressure Limit', normal: 'Condenser Pressure Limit Cleared', category: 'Trouble', at: at(wall(2026, 8, 24, 15, 38), 20), value: 'Active', prev: 'Inactive',
  ackAt: at(wall(2026, 8, 24, 15, 41), 2), normalAt: trip, normalValue: 'Inactive', closeAt: closeAll });
alarm({ point: plantPt('CH-2', 'Disch_Press', 'CH-2 Discharge Pressure'), message: 'High Discharge Pressure', normal: 'Discharge Pressure Normal', category: 'Alarm', at: trip, value: '648.3', prev: '631.9', unit: 'psig',
  ackAt: trip + 88 * SEC, normalAt: trip + 51 * SEC, normalValue: '412.6', closeAt: closeAll + 2 * SEC });
alarm({ point: plantPt('CH-2', 'Comp_Flt', 'CH-2 Compressor Fault'), message: 'Compressor Fault', normal: 'Compressor Fault Reset', category: 'Fault', fault: true, at: trip + SEC, value: 'Fault', prev: 'Normal',
  ackAt: trip + 89 * SEC, normalAt: at(wall(2026, 8, 24, 18, 36), 44), normalValue: 'Normal', closeAt: closeAll + 4 * SEC });
stopChiller('CH-2', trip + 1400);
command(cmdPt('CH-3'), trip + 116 * SEC, 'Start', 'Stop');
startChiller('CH-3', trip + 159 * SEC, 12);
startChiller('CH-2', ch2Back, 8);
command(cmdPt('CH-3'), at(wall(2026, 8, 24, 19, 10), 2), 'Stop', 'Start');
stopChiller('CH-3', at(wall(2026, 8, 24, 19, 10), 31));

const coil = actOf('ch2-coil');
swapToStandby('CH-2', coil.start, coil.finish);
const CH2_COIL_CLEANED = coil.finish;
const ch1Oil = wos.find((w) => w.desc.startsWith('CH-1 TRANE CGAM ANNUAL OIL ANALYSIS') && w.act?.finish && utcOf(w.act.start) >= HIST_FROM && utcOf(w.act.start) < HIST_TO)!;
swapToStandby('CH-1', utcOf(ch1Oil.act!.start), utcOf(ch1Oil.act!.finish!));

// Monthly generator load runs with an ATS transfer test (NFPA 110), from the Maximo actuals. The
// ASCO 7000s are open transition, so each transfer and retransfer is a brief outage on that side:
// UPS rides through on battery, chillers on that MCC drop out on Momentary Power Loss and restart.
type Side = 'A' | 'B';
interface Transfer { readonly side: Side; readonly from: number; readonly to: number }
const onGenerator: Transfer[] = [];
const transferOutage = (side: Side, x: number, toGenerator: boolean) => {
  const dur = hBetween(150, 330) / 1000;
  pme({ utc: x, source: `DFW1.ATS-${side}`, event: `ATS-${side} ${toGenerator ? 'Transfer to Emergency' : 'Retransfer to Normal'}`, condition: 'Test', measurement: toGenerator ? 'Emergency Voltage A-B' : 'Normal Voltage A-B', value: 478 + hBetween(0, 6000) / 1000, type: 'Instantaneous', priority: 128 });
  pme({ utc: x + 30 + hBetween(0, 99), source: `DFW1.SWGR-${side}-MAIN`, event: 'Interruption', condition: `Duration ${dur.toFixed(3)} s`, measurement: 'Voltage A-B', value: 2 + hBetween(0, 7000) / 1000, type: 'Instantaneous', priority: 192 });
  const onBattery = x + 12 + hBetween(0, 19);
  const restored = x + hBetween(4, 9) * SEC + ms();
  pme({ utc: onBattery, source: `DFW1.UPS-${side}`, event: 'On Battery', condition: 'Input out of tolerance', measurement: 'Output Active Power', value: itKw(x) * itShare[side], type: 'Pick up', priority: 192 });
  pme({ utc: restored, source: `DFW1.UPS-${side}`, event: 'Utility Power Restored', condition: '', measurement: 'Input Voltage A-B', value: 478 + hBetween(0, 6000) / 1000, type: 'Instantaneous', priority: 64 });
  pme({ utc: restored + 20, source: `DFW1.UPS-${side}`, event: 'On Battery', condition: 'Input out of tolerance', measurement: 'Output Active Power', value: itKw(restored) * itShare[side], type: 'Drop out', priority: 192 });
  for (const u of CHILLERS.filter((c) => MCC_OF[c] === side && isRunning(c, x - SEC))) {
    stopChiller(u, x + 50);
    const restart = x + hBetween(150, 200) * SEC;
    const normalAt = x + hBetween(3, 6) * SEC;
    alarm({ point: plantPt(u, 'Chiller_Diag', `${u} Diagnostic`), message: 'Momentary Power Loss', normal: 'Momentary Power Loss Cleared', category: 'Trouble', at: x + 100, value: 'Active', prev: 'Inactive',
      ackAt: x + hBetween(40, 120) * SEC, normalAt, normalValue: 'Inactive', closeAt: restart + hBetween(10, 40) * MIN });
    startChiller(u, restart, 5);
  }
};
for (const w of wos) {
  const m = /^GEN-([12]) MONTHLY LOAD RUN/.exec(w.desc);
  if (!m || !w.act?.finish) continue;
  const start = utcOf(w.act.start), finish = utcOf(w.act.finish);
  if (start < HIST_FROM || start >= HIST_TO) continue;
  const side: Side = m[1] === '1' ? 'A' : 'B';
  const gen = `DFW1.GEN-${m[1]}`;
  const crank = start + hBetween(7, 11) * MIN + hBetween(0, 59) * SEC + ms();
  const transfer = crank + hBetween(95, 140) * SEC + ms();
  const retransfer = transfer + hBetween(32, 35) * MIN + hBetween(0, 59) * SEC + ms();
  const stop = retransfer + 5 * MIN + hBetween(0, 30) * SEC + ms();
  if (stop > finish) throw new Error(`${w.wonum}: the load run does not fit its actual start and finish`);
  pme({ utc: crank, source: gen, event: 'General Event', condition: 'Engine Running', measurement: 'Engine Speed', value: 1800 + hBetween(-3000, 3000) / 1000, type: 'Pick up', priority: 64 });
  transferOutage(side, transfer, true);
  pme({ utc: transfer + 900 + hBetween(0, 99), source: gen, event: 'Backup Power', condition: 'Generator breaker closed', measurement: 'Active Power', value: () => sideAt(side, transfer + 5 * SEC).mainKw, type: 'Pick up', priority: 128 });
  onGenerator.push({ side, from: transfer, to: retransfer });
  transferOutage(side, retransfer, false);
  pme({ utc: retransfer + 300 + hBetween(0, 99), source: gen, event: 'Backup Power', condition: 'Generator breaker open', measurement: 'Active Power', value: 0, type: 'Drop out', priority: 128 });
  pme({ utc: stop, source: gen, event: 'General Event', condition: 'Engine Running', measurement: 'Engine Speed', value: 0, type: 'Drop out', priority: 64 });
}
const onGen = (side: Side, utc: number) => onGenerator.some((t) => t.side === side && utc >= t.from && utc < t.to);

// Loop supply temperature excursion above the 44 °F setpoint (modeled). Losing a loaded chiller
// sends its share of primary flow back unchilled, so supply heads for 44 + 14 °F x (unloaded
// fraction of the two required chillers), +1.5 °F when outdoor air above 100 °F caps the survivor;
// it rises with a 2.5 min lag and recovers with a 10 min lag as a restarted or standby unit loads.
const STEP = 10 * SEC;
const excursion = new Float64Array(Math.ceil((HIST_TO - HIST_FROM) / STEP) + 1);
{
  const idx: Record<Chiller, number> = { 'CH-1': 0, 'CH-2': 0, 'CH-3': 0 };
  let e = 0;
  for (let i = 0; i < excursion.length; i++) {
    const t = HIST_FROM + i * STEP;
    let loaded = 0;
    for (const u of CHILLERS) {
      while (idx[u] < runs[u].length && runs[u][idx[u]]!.utc <= t) idx[u]++;
      loaded += loadedOf(idx[u] > 0 ? runs[u][idx[u] - 1]! : null, u, t);
    }
    const unloaded = Math.max(0, 2 - loaded) / 2;
    const target = unloaded > 0 ? 14 * unloaded + ((noaaF(t) ?? 0) > 100 ? 1.5 : 0) : 0;
    e = target + (e - target) * Math.exp(-STEP / ((target > e ? 150 : 600) * SEC));
    excursion[i] = e;
  }
}
const excAt = (utc: number) => {
  const x = (utc - HIST_FROM) / STEP;
  if (x <= 0) return excursion[0]!;
  const i = Math.min(Math.floor(x), excursion.length - 2);
  return excursion[i]! + (excursion[i + 1]! - excursion[i]!) * Math.min(1, x - i);
};
const CHWS_SETPOINT = 44;
// CHW-LOOP-1 supply high limit: 50 °F, the limit the BMS point list sets on each chiller's CHWS.
{
  const point = plantPt('CHW-LOOP-1', 'CHWS_Temp', 'CHW Loop 1 Supply Temp');
  let raisedAt: number | null = null, raisedValue = '';
  for (let i = 1; i < excursion.length; i++) {
    const t = HIST_FROM + i * STEP;
    const v = CHWS_SETPOINT + excursion[i]!;
    if (raisedAt === null && v >= 50) {
      raisedAt = t - STEP + Math.round((STEP * (50 - CHWS_SETPOINT - excursion[i - 1]!)) / (excursion[i]! - excursion[i - 1]!));
      raisedValue = v.toFixed(1);
    } else if (raisedAt !== null && v < 49) {
      alarm({ point, message: 'CHWS Temp High', normal: 'CHWS Temp Normal', category: 'Alarm', at: raisedAt, value: raisedValue, prev: '49.9', unit: '°F',
        ackAt: raisedAt + hBetween(50, 110) * SEC, normalAt: t, normalValue: v.toFixed(1), closeAt: t + hBetween(25, 40) * MIN });
      raisedAt = null;
    }
  }
}

// Electrical model per side (modeled): UPS input, MCC, mechanical panel, XFMR-5B, house loads.
const kwPerTon = (utc: number) => Math.max(0.7, 1.15 * (1 + 0.017 * (oatF(utc) - 95)));
const capTons = (u: Chiller, utc: number) => 90 * (1 - 0.007 * Math.max(0, oatF(utc) - 95)) * (u === 'CH-2' && utc < CH2_COIL_CLEANED ? 0.8 : 1);
const loaded = (u: Chiller, utc: number) => loadedOf(lastChange(u, utc), u, utc);
const chillerTons = (u: Chiller, utc: number) => {
  if (!isRunning(u, utc)) return 0;
  const weight = (c: Chiller) => (isRunning(c, utc) ? Math.max(0.25, loaded(c, utc)) : 0);
  const share = weight(u) / CHILLERS.reduce((s, c) => s + weight(c), 0);
  return Math.min(capTons(u, utc) * Math.max(0.25, loaded(u, utc)), demandTons(utc) * (1 + excAt(utc) / 20) * share);
};
const chillerKw = (u: Chiller, utc: number) => (isRunning(u, utc) ? chillerTons(u, utc) * kwPerTon(utc) + 1.5 : 0.4);
const pumpHz = (n: 1 | 2 | 3, utc: number) => (n === 3 ? 0 : 36 + (8 * (demandTons(utc) - 90)) / 30 + 1.2 * excAt(utc) + 0.3 * jitter(10 + n, utc));
const pumpKw = (hz: number) => (30 * (hz / 60) ** 3) / 0.93;
const sideAt = (s: Side, utc: number) => {
  const upsOutKw = itKw(utc) * itShare[s];
  const mccKw = s === 'A' ? chillerKw('CH-1', utc) + pumpKw(pumpHz(1, utc)) : chillerKw('CH-2', utc) + chillerKw('CH-3', utc) + pumpKw(pumpHz(2, utc));
  const loads: [number, number][] = [
    [upsOutKw / 0.955 + 1.5, 0.99], [mccKw, 0.86], [4 * 3.6 * (1 + (0.12 * excAt(utc)) / 7), 0.95], [s === 'B' ? (itKw(utc) * itShare.X) / 0.97 : 0, 0.95], [8, 0.92],
  ];
  const p = loads.reduce((a, [kw]) => a + kw, 0);
  const q = loads.reduce((a, [kw, pf]) => a + kw * Math.tan(Math.acos(pf)), 0);
  return { upsOutKw, mccKw, mccAmps: (mccKw * 1000) / (Math.sqrt(3) * 480 * 0.86), mainKw: p, pf: p / Math.hypot(p, q) };
};

// MCC feeder under-current (site setpoint on the PM8000s at SWGR-x CB-3: below 25 A for 5 s), from
// the run schedule: it picks up whenever no chiller on that MCC runs, and drops out when one starts.
for (const side of ['A', 'B'] as const) {
  const units = CHILLERS.filter((u) => MCC_OF[u] === side);
  const times = [...new Set(units.flatMap((u) => runs[u].map((r) => r.utc)))].sort((a, b) => a - b);
  let emptySince: number | null = null;
  for (const t of times) {
    const any = units.some((u) => isRunning(u, t));
    if (!any && emptySince === null) emptySince = t;
    else if (any && emptySince !== null) {
      if (t - emptySince > 5 * SEC) {
        const pick = emptySince + 5 * SEC + ms();
        const drop = t + 200 + hBetween(0, 333);
        const source = `DFW1.SWGR-${side}-CB3`;
        pme({ utc: pick, source, event: 'Under Current', condition: 'Below 25 A for 5 s', measurement: 'Current A', value: sideAt(side, pick).mccAmps, type: 'Pick up', priority: 192 });
        pme({ utc: drop, source, event: 'Under Current', condition: 'Below 25 A for 5 s', measurement: 'Current A', value: sideAt(side, drop + 20 * SEC).mccAmps, type: 'Drop out', priority: 192 });
      }
      emptySince = null;
    }
  }
}

// UPS semi-annual PM (Eaton): static bypass, then maintenance bypass, then back, inside the actuals.
for (const w of wos) {
  const m = /^UPS-([AB]) EATON 9395P SEMI-ANNUAL PM/.exec(w.desc);
  if (!m || !w.act?.finish) continue;
  const start = utcOf(w.act.start), finish = utcOf(w.act.finish);
  if (start < HIST_FROM || start >= HIST_TO) continue;
  const s = m[1] as Side;
  const source = `DFW1.UPS-${s}`;
  const bypass = start + hBetween(12, 18) * MIN + hBetween(0, 59) * SEC + ms();
  const maint = bypass + hBetween(5, 8) * MIN + hBetween(0, 59) * SEC + ms();
  const maintOff = finish - hBetween(25, 32) * MIN + hBetween(0, 59) * SEC + ms();
  const bypassOff = maintOff + hBetween(5, 9) * MIN + hBetween(0, 59) * SEC + ms();
  const out = (t: number) => itKw(t) * itShare[s];
  pme({ utc: bypass, source, event: 'On Bypass', condition: 'Transfer to static bypass', measurement: 'Output Active Power', value: out(bypass), type: 'Pick up', priority: 128 });
  pme({ utc: maint, source, event: 'On Maintenance Bypass', condition: 'Maintenance bypass breaker closed', measurement: 'Output Active Power', value: out(maint), type: 'Pick up', priority: 128 });
  pme({ utc: maintOff, source, event: 'On Maintenance Bypass', condition: 'Maintenance bypass breaker open', measurement: 'Output Active Power', value: out(maintOff), type: 'Drop out', priority: 128 });
  pme({ utc: bypassOff, source, event: 'On Bypass', condition: 'Transfer to inverter', measurement: 'Output Active Power', value: out(bypassOff), type: 'Drop out', priority: 128 });
  status(upsPt(s, 'On_Bypass', 'Bypass Status'), bypass + 2 * SEC, 'On Bypass', 'On Inverter');
  status(upsPt(s, 'On_Bypass', 'Bypass Status'), bypassOff + 2 * SEC, 'On Inverter', 'On Bypass');
}

// Utility disturbances on UTIL-1, seen at both mains. Two sit on the two highest ERCOT North Central
// load days outside the heat event; the disturbances themselves are modeled, not sourced.
const ncPeak = new Map<string, { he: number; mw: number }>();
for (const [day, he, mw] of external('ercot_np6-345-cd_2026-06-01_2026-11-07.csv')) {
  if (Number(mw) > (ncPeak.get(day!)?.mw ?? 0)) ncPeak.set(day!, { he: Number(he!.slice(0, 2)), mw: Number(mw) });
}
const highLoadDays = [...ncPeak].filter(([d]) => d < '2026-08-22' || d > '2026-08-26').sort((a, b) => b[1].mw - a[1].mw).slice(0, 2).sort((a, b) => a[0].localeCompare(b[0]));
const dayWall = (day: string, h: number, mi: number) => wall(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), h, mi);
const DISTURBANCES = [
  { utc: at(dayWall('2026-06-23', 6, 12), 37), kind: 'Sag', pct: 88.4, dur: 0.05, deep: false },
  ...highLoadDays.map(([day, p], i) => ({ utc: at(dayWall(day, p.he - 1, hBetween(5, 55)), hBetween(0, 59)), kind: 'Sag', pct: i === 0 ? 86.1 : 71.3, dur: i === 0 ? 0.067 : 0.083, deep: i === 1 })),
  { utc: at(dayWall('2026-10-03', 14, 41), 9), kind: 'Swell', pct: 108.2, dur: 0.083, deep: false },
];
for (const d of DISTURBANCES) {
  const x = d.utc + ms();
  for (const s of ['A', 'B'] as const) {
    pme({ utc: x + (s === 'B' ? 2 : 0), source: `DFW1.SWGR-${s}-MAIN`, event: `${d.kind} (Voltage)`, condition: `Duration ${d.dur.toFixed(3)} s`, measurement: 'Voltage A-B', value: (480 * d.pct) / 100 + hBetween(-800, 800) / 1000, type: 'Instantaneous', priority: 128 });
  }
  if (!d.deep) continue;
  // To 71% for five cycles: both UPSs go to battery and CHWP-2's VFD trips on DC bus undervoltage
  // (auto-reset); the chiller contactors ride through.
  for (const s of ['A', 'B'] as const) {
    const back = x + hBetween(3, 6) * SEC + ms();
    pme({ utc: x + 10 + hBetween(0, 19), source: `DFW1.UPS-${s}`, event: 'On Battery', condition: 'Input out of tolerance', measurement: 'Output Active Power', value: itKw(x) * itShare[s], type: 'Pick up', priority: 192 });
    pme({ utc: back, source: `DFW1.UPS-${s}`, event: 'Utility Power Restored', condition: '', measurement: 'Input Voltage A-B', value: 478 + hBetween(0, 6000) / 1000, type: 'Instantaneous', priority: 64 });
    pme({ utc: back + 20, source: `DFW1.UPS-${s}`, event: 'On Battery', condition: 'Input out of tolerance', measurement: 'Output Active Power', value: itKw(back) * itShare[s], type: 'Drop out', priority: 192 });
  }
  alarm({ point: plantPt('CHWP-2', 'VFD_Flt', 'CHWP-2 VFD Fault'), message: 'VFD Fault', normal: 'VFD Fault Reset', category: 'Fault', fault: true, at: x + 400, value: 'Fault', prev: 'Normal',
    ackAt: x + 70 * SEC, normalAt: x + 31 * SEC, normalValue: 'Normal', closeAt: x + hBetween(20, 45) * MIN });
  alarm({ point: plantPt('CHWP-2', 'Run_Status', 'CHWP-2 Run Status'), message: 'Pump Fail (Status/Command Mismatch)', normal: 'Pump Status Normal', category: 'Alarm', at: x + 15 * SEC, value: 'Off', prev: 'On',
    ackAt: x + 72 * SEC, normalAt: x + 44 * SEC, normalValue: 'On', closeAt: x + hBetween(20, 45) * MIN });
}

// CRAH dirty-filter alarms (filter differential pressure switch) ahead of about half the filter PMs,
// cleared when the new filters go in.
for (const w of wos) {
  const m = /^CRAH-(\d+) QUARTERLY FILTER CHANGE/.exec(w.desc);
  if (!m || !w.act?.finish || hrng() >= 0.55) continue;
  const start = utcOf(w.act.start), finish = utcOf(w.act.finish);
  const day = addDays(w.act.start, -hBetween(1, 5));
  const raised = at(wall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hBetween(6, 21), hBetween(0, 59)), hBetween(0, 59));
  if (raised < HIST_FROM || finish >= HIST_TO || raised >= start) continue;
  const n = Number(m[1]);
  const closeDay = addDays(w.act.finish, 1);
  alarm({ point: hallPt(crahBms(n), 'Filter_Status', `${crahBms(n)} Filter Status`), message: 'Change Filters', normal: 'Filters Normal', category: 'Maintenance', at: raised, value: 'Dirty', prev: 'Clean',
    ackAt: raised + hBetween(4, 50) * MIN, normalAt: finish - hBetween(8, 25) * MIN, normalValue: 'Clean', closeAt: at(wall(closeDay.getUTCFullYear(), closeDay.getUTCMonth() + 1, closeDay.getUTCDate(), 7, hBetween(5, 55)), hBetween(0, 59)) });
}

// CRAH-07 EC fan 2 (WO-26-1259 reported 11/03 10:15, fan replacement still in progress at export).
const crah07Fault = utcOf(woOf['crah07-fan']!.report) - 23 * MIN + 29 * SEC;
alarm({ point: hallPt('CRAH-07', 'Fan2_Status', 'CRAH-07 EC Fan 2 Status'), message: 'EC Fan 2 Fault', normal: 'EC Fan 2 Normal', category: 'Fault', fault: true, at: crah07Fault, value: 'Fault', prev: 'Normal',
  ackAt: crah07Fault + 5 * MIN + 41 * SEC, normalAt: null });

// Pump lube PMs: the duty pump is handed to CHWP-3 by command. On 07/22 the tech opened CHWP-1's
// disconnect before the swap, so the BMS saw it stop while commanded on.
for (const w of wos) {
  const m = /^CHWP-(\d) QUARTERLY LUBE/.exec(w.desc);
  if (!m || m[1] === '3' || !w.act?.finish) continue;
  const start = utcOf(w.act.start), finish = utcOf(w.act.finish);
  if (start < HIST_FROM || start >= HIST_TO) continue;
  const pump = `CHWP-${m[1]}`;
  if (pump === 'CHWP-1' && w.act.start.getUTCMonth() === 6) {
    alarm({ point: plantPt(pump, 'Run_Status', `${pump} Run Status`), message: 'Pump Fail (Status/Command Mismatch)', normal: 'Pump Status Normal', category: 'Alarm', at: start + 2 * MIN + 17 * SEC, value: 'Off', prev: 'On',
      ackAt: start + 3 * MIN + 20 * SEC, normalAt: start + 4 * MIN + 41 * SEC, normalValue: 'Off', closeAt: start + 21 * MIN + 6 * SEC });
    command(cmdPt('CHWP-3'), start + 4 * MIN + 2 * SEC, 'Start', 'Stop');
    command(cmdPt(pump), start + 4 * MIN + 40 * SEC, 'Stop', 'Start');
  } else {
    command(cmdPt('CHWP-3'), start - 4 * MIN - 12 * SEC, 'Start', 'Stop');
    command(cmdPt(pump), start - 3 * MIN - 5 * SEC, 'Stop', 'Start');
  }
  command(cmdPt(pump), finish + 2 * MIN + 14 * SEC, 'Start', 'Stop');
  command(cmdPt('CHWP-3'), finish + 3 * MIN + 1 * SEC, 'Stop', 'Start');
}

// ── Writing the four exports ──
const desigoTime = (utc: number) => {
  const l = localOf(utc);
  return `${pad(l.getUTCMonth() + 1)}/${pad(l.getUTCDate())}/${l.getUTCFullYear()} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())}`;
};
const pmeClock = (d: Date, millis: boolean) => {
  const h = d.getUTCHours();
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${h % 12 || 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${millis ? `.${pad(d.getUTCMilliseconds(), 3)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const writeExport = (name: string, lines: readonly string[]) => {
  const text = lines.join('\n') + '\n';
  if (Buffer.byteLength(text) > 1_500_000) throw new Error(`${name} is ${Buffer.byteLength(text)} bytes; each export must stay under 1.5 MB`);
  writeFileSync(join(docsDir, name), text);
};
const HISTORY_DOCS = {
  bmsEvents: 'desigo_event_log_2026-05-01_2026-11-07.csv',
  bmsTrendHeat: 'desigo_trend_2026-08-22_2026-08-26.csv',
  bmsTrendWeek: 'desigo_trend_2026-11-01_2026-11-07.csv',
  pmeEvents: 'pme_event_history_2026-05-01_2026-11-07.csv',
  pmeDataHeat: 'pme_data_export_2026-08-22_2026-08-26.csv',
  pmeDataWeek: 'pme_data_export_2026-11-01_2026-11-07.csv',
} as const;

const inHistory = desigoRows.map((r, seq) => ({ r, seq })).filter(({ r }) => r.utc >= HIST_FROM && r.utc < HIST_TO).sort((a, b) => a.r.utc - b.r.utc || a.seq - b.seq).map(({ r }) => r);
const eventIds = new Map<object, number>();
let nextEventId = 184_211;
const desigoLines = [csvLine(['System Name', 'Date/Time', 'Source Description', 'Record Type', 'Source Property', 'Event Message Text', 'Event Category', 'Event Time', 'Event State', 'Event Cause', 'Event ID', 'Log Type', 'Action', 'Value', 'Quality', 'Previous Value', 'Previous Quality', 'Unit', 'Source Designation', 'Discipline'])];
const desigoLineOf = new Map<DesigoRow, number>();
for (const r of inHistory) {
  if (r.instance && !eventIds.has(r.instance)) eventIds.set(r.instance, (nextEventId += hBetween(1, 37)));
  desigoLines.push(csvLine([
    'DFW1-BMS-01', desigoTime(r.utc), r.point.description, r.record, 'Present_Value', r.message, r.category, r.eventUtc === null ? '' : desigoTime(r.eventUtc), r.state, r.cause,
    r.instance ? String(eventIds.get(r.instance)) : '', r.record === 'Activity' ? 'Activity' : r.category === 'Status' ? 'Event' : 'Alarm', r.action, r.value, r.value ? 'Good' : '', r.prev, r.prev ? 'Good' : '', r.unit, r.point.designation, 'Building Automation',
  ]));
  desigoLineOf.set(r, desigoLines.length);
}
writeExport(HISTORY_DOCS.bmsEvents, desigoLines);

const pmeSorted = pmeEvents.filter((e) => e.utc >= HIST_FROM && e.utc < HIST_TO).sort((a, b) => a.utc - b.utc);
const pmeLines = [csvLine(['ID', 'Source', 'Timestamp', 'Timestamp UTC', 'Event', 'Condition', 'Measurement', 'Value', 'Type', 'Priority'])];
const pmeLineOf = new Map<PmeEvent, number>();
let nextPmeId = 40_112;
for (const e of pmeSorted) {
  pmeLines.push(csvLine([String((nextPmeId += hBetween(1, 9))), e.source, pmeClock(localOf(e.utc), true), pmeClock(new Date(e.utc), true), e.event, e.condition, e.measurement, (typeof e.value === 'function' ? e.value() : e.value).toFixed(3), e.type, String(e.priority)]));
  pmeLineOf.set(e, pmeLines.length);
}
writeExport(HISTORY_DOCS.pmeEvents, pmeLines);

// Trend windows: the heat event and the last full week, sampled every 15 minutes in site time
// (so the fall-back hour on 11/01 appears twice, as the exports print it).
const samplesBetween = (from: Date, to: Date) => {
  const out: number[] = [];
  for (let t = utcOf(from); t < utcOf(to); t += 15 * MIN) out.push(t);
  return out;
};
const HEAT_WINDOW = samplesBetween(wall(2026, 8, 22), wall(2026, 8, 27));
const LAST_WEEK = samplesBetween(wall(2026, 11, 1), wall(2026, 11, 8));
const CRAH_BASE_F = [65.2, 64.8, 65.6, 65.0, 66.1, 65.4, 64.9, 65.7];
const loopChws = (utc: number) => CHWS_SETPOINT + excAt(utc);
const chwr = (utc: number) => loopChws(utc) + (10.6 * demandTons(utc)) / 106.7;
const sat = (n: number, utc: number) => CRAH_BASE_F[n - 1]! + 0.8 * excAt(utc - 3 * MIN) + (n === 7 && utc >= crah07Fault ? -0.9 : 0);
const meanSat = (utc: number) => CRAH_BASE_F.reduce((s, _, i) => s + sat(i + 1, utc), 0) / CRAH_BASE_F.length;
const COLD_AISLE_OFFSET_F: Record<string, number> = { A: 4.6, C: 6.8, E: 5.4 };
const coldAisle = (row: string, utc: number) => meanSat(utc) + COLD_AISLE_OFFSET_F[row]! + 25 * (itKw(utc) / IT_KW - 1);
interface TrendPoint { readonly point: Point; readonly unit: string; readonly value: (utc: number) => number }
const TREND: TrendPoint[] = [
  { point: { designation: 'DFW1.Bldg1.CHW_Plant.OAT', description: 'Plant Outside Air Temp' }, unit: '°F', value: oatF },
  ...CHILLERS.map((u, i) => ({ point: plantPt(u, 'CHWS_Temp', `${u} CHW Supply Temp`), unit: '°F',
    value: (t: number) => (isRunning(u, t) ? CHWS_SETPOINT + 0.25 * excAt(t) + 0.2 * jitter(20 + i, t) : chwr(t) + 1.5 + 0.1 * jitter(20 + i, t)) })),
  ...CHILLERS.map((u) => ({ point: plantPt(u, 'kW', `${u} Power`), unit: 'kW', value: (t: number) => chillerKw(u, t) })),
  { point: plantPt('CHW-LOOP-1', 'CHWS_Temp', 'CHW Loop 1 Supply Temp'), unit: '°F', value: (t: number) => loopChws(t) + 0.3 * jitter(24, t) },
  { point: plantPt('CHW-LOOP-1', 'CHWR_Temp', 'CHW Loop 1 Return Temp'), unit: '°F', value: (t: number) => chwr(t) + 0.3 * jitter(25, t) },
  ...([1, 2, 3] as const).map((n) => ({ point: plantPt(`CHWP-${n}`, 'VFD_Hz', `CHWP-${n} VFD Speed`), unit: 'Hz', value: (t: number) => pumpHz(n, t) })),
  ...CRAH_BASE_F.map((_, i) => ({ point: hallPt(crahBms(i + 1), 'SAT', `${crahBms(i + 1)} Supply Air Temp`), unit: '°F', value: (t: number) => sat(i + 1, t) + 0.2 * jitter(30 + i, t) })),
  ...['A', 'C', 'E'].map((row, i) => ({ point: { designation: `DFW1.Bldg1.DH-1.Row_${row}.Cold_Aisle_Temp`, description: `DH-1 Row ${row} Cold Aisle Temp` }, unit: '°F', value: (t: number) => coldAisle(row, t) + 0.3 * jitter(40 + i, t) })),
  ...(['A', 'B'] as const).map((s) => ({ point: upsPt(s, 'Load_Pct', 'Output Load'), unit: '%', value: (t: number) => (sideAt(s, t).upsOutKw / 750) * 100 })),
];
const writeDesigoTrend = (name: string, samples: readonly number[]) => {
  const lines = [csvLine(['Date/Time', 'Source Designation', 'Source Description', 'Value', 'Unit', 'Quality'])];
  for (const t of samples) for (const p of TREND) lines.push(csvLine([desigoTime(t), p.point.designation, p.point.description, p.value(t).toFixed(1), p.unit, 'Good']));
  writeExport(name, lines);
};
writeDesigoTrend(HISTORY_DOCS.bmsTrendHeat, HEAT_WINDOW);
writeDesigoTrend(HISTORY_DOCS.bmsTrendWeek, LAST_WEEK);

const PME_SERIES: readonly (readonly [source: string, measurement: string, unit: string, value: (utc: number) => number])[] = [
  ...(['A', 'B'] as const).flatMap((s, i) => [
    [`DFW1.SWGR-${s}-MAIN`, 'Active Power', 'kW', (t: number) => sideAt(s, t).mainKw * (1 + 0.003 * jitter(50 + i, t))],
    [`DFW1.SWGR-${s}-MAIN`, 'Power Factor Total', '', (t: number) => sideAt(s, t).pf],
    [`DFW1.SWGR-${s}-CB3`, 'Active Power', 'kW', (t: number) => sideAt(s, t).mccKw],
    [`DFW1.SWGR-${s}-CB3`, 'Current A', 'A', (t: number) => sideAt(s, t).mccAmps * (1 + 0.01 * jitter(52 + i, t))],
    [`DFW1.UPS-${s}`, 'Active Power', 'kW', (t: number) => sideAt(s, t).upsOutKw],
    [`DFW1.GEN-${i + 1}`, 'Active Power', 'kW', (t: number) => (onGen(s, t) ? sideAt(s, t).mainKw : 0)],
  ] as const),
].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const writePmeData = (name: string, samples: readonly number[]) => {
  const lines = [csvLine(['Timestamp UTC', 'Timestamp', 'Value', 'Source', 'Measurement', 'Unit'])];
  for (const [source, measurement, unit, value] of PME_SERIES) {
    for (const t of samples) lines.push(csvLine([pmeClock(new Date(t), false), pmeClock(localOf(t), false), value(t).toFixed(3), source, measurement, unit]));
  }
  writeExport(name, lines);
};
writePmeData(HISTORY_DOCS.pmeDataHeat, HEAT_WINDOW);
writePmeData(HISTORY_DOCS.pmeDataWeek, LAST_WEEK);

// The modeled heat event must stay physical: cold aisles inside ASHRAE recommended (80.6 °F).
const hottestAisle = Math.max(...HEAT_WINDOW.flatMap((t) => ['A', 'C', 'E'].map((row) => coldAisle(row, t))));
if (hottestAisle >= 80.6) throw new Error(`cold aisle reaches ${hottestAisle.toFixed(1)} F in the heat window`);

const tripAlarm = inHistory.find((r) => r.utc === trip && r.message === 'High Discharge Pressure')!;
const tripFeeder = pmeSorted.find((e) => e.source === 'DFW1.SWGR-B-CB3' && e.type === 'Pick up' && e.utc > trip && e.utc < trip + MIN)!;

// ───────────────────────── ground truth ─────────────────────────

const R = 'docs/circuit_roster.csv';
const E = 'docs/equipment_register.csv';
const B = 'docs/bms_points.json';
const W = 'docs/maximo_workorders.csv';
// Register asset classes the model represents, by ground-truth kind. Anything else (MCC, transformer,
// fire alarm panel) is an asset Cascade does not model.
const MODELED_CLASS: Record<string, string> = {
  Generator: 'generator', 'Automatic Transfer Switch': 'ats', ATS: 'ats', Switchgear: 'switchgear', UPS: 'ups', PDU: 'pdu',
  'Remote Power Panel': 'rpp', Chiller: 'chiller', Pump: 'pump', CRAH: 'crah',
};
const kindOfClass = (cls: string): string | null => MODELED_CLASS[cls] ?? null;
const of = (s: string) => `docs/contracts/${CUSTOMERS.find((c) => c.short === s)!.acct}-${s}-order-form.txt`;
const msaOf = (s: string) => `docs/contracts/${CUSTOMERS.find((c) => c.short === s)!.acct}-${s}-msa.txt`;
const ref = (kind: string, tag: string) => ({ kind, tag });
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const rowCLoad = sum(cabs.filter((c) => c.cab.startsWith('C')).map((c) => c.measured));
const hallLoad = sum(cabs.map((c) => c.measured));
// What the fix planner should achieve per defect: `op` is the move kind a verified plan uses, landing on
// one of `onto`; null means no physical move in the planner's set (add/re-home cord, re-feed) clears it.
const spareRefs = (panel: string) => SPARES.filter((s) => s.panel === panel).map((s) => ref('circuit', `${s.panel}/${s.pos}`));
const fix = (op: 'add-cord' | 'rehome-cord' | 'refeed' | null, onto: { kind: string; tag: string }[], why: string) => ({ op, onto, why });

const truth = {
  site: 'dfw1',
  purpose: 'Planted defects, conflicts and decoys for accuracy tests ONLY. The application must never load this file.',
  numbers: {
    hallMeasuredKw: hallLoad,
    rowCMeasuredKw: rowCLoad,
    chillerCapacityKwEach: Math.round(90 * 3.517 * 10) / 10,
    note: 'Numbers derived from the seed documents by the generator; tests should recompute rather than trust them.',
  },
  defects: [
    {
      id: 'ab-convergence-halcyon',
      rule: 'ab-convergence',
      subjects: [ref('rpp', 'RPP-4B'), ref('rpp', 'RPP-4A'), ref('pdu', 'PDU-3A')],
      affectedCabinets: ['E01', 'E02', 'E03', 'E04', 'E05'],
      customer: 'C1156',
      why: 'Halcyon cabinets E01-E05 have A cords on RPP-4A and B cords on RPP-4B. RPP-4B is labelled B but is fed from PDU-3A SF-3 (a 2023 temporary re-feed that was never reverted), so both paths converge at PDU-3A / UPS-A. Losing PDU-3A or UPS-A drops all five cabinets.',
      evidence: [
        { doc: E, line: regLineOf['RPP-4B'], note: 'RPP-4B system B, fed_from PDU-3A SF-3' },
        { doc: E, line: regLineOf['PDU-3A SF-3'], note: 'sub-feed breaker bus PDU-3A' },
        { doc: E, line: regLineOf['PDU-3B SF-2'], note: 'the original B-side breaker, now spare' },
        { doc: R, line: rosterLineOf['E01/B'], note: 'E01 B cord on RPP-4B' },
        { doc: W, line: woLineOf['mop-0117-step12'], note: 'the temporary re-feed, closed' },
        { doc: W, line: woLineOf['mop-0117-step31'], note: 'the return to PDU-3B SF-2, cancelled' },
      ],
      consequential: [{ rule: 'contract-topology-mismatch', subject: ref('contract', 'DFW-MSA-1156'), why: 'order form promises A+B', evidence: [{ doc: of('halcyon'), line: contractLineOf['halcyon.power'] }] }],
      fix: fix('refeed', [ref('breaker', 'PDU-3B-SF-2')], 'Re-feed one Halcyon RPP from the spare PDU-3B SF-2 (the original B-side breaker).'),
    },
    ...(['B07', 'B08'] as const).map((cab) => ({
      id: `single-corded-${cab}`,
      rule: 'single-corded',
      subjects: [ref('cabinet', cab)],
      affectedCabinets: [cab],
      customer: 'C1077',
      why: `${cab} has only an A cord in the roster. The Pecan Street contract is N (single feed), so this is a redundancy finding but not a contract breach.${cab === 'B08' ? ' Single-PSU appliance: an add-cord fix is not possible.' : ''}`,
      evidence: [{ doc: R, line: rosterLineOf[`${cab}/A`] }, { doc: of('pecan'), line: contractLineOf['pecan.power'] }],
      consequential: [],
      fix: cab === 'B08'
        ? fix(null, [], 'Single-PSU appliance: a second cord has nothing to plug into.')
        : fix('add-cord', spareRefs('PDU-1B'), 'Dual-PSU cabinet; the B breaker at PDU-1B/26 is installed and spare, only the whip is missing.'),
    })),
    {
      id: 'single-corded-D06-ab-contract',
      rule: 'single-corded',
      subjects: [ref('cabinet', 'D06')],
      affectedCabinets: ['D06'],
      customer: 'C1129',
      why: 'D06 has only an A cord (B whip never installed) while the Trinity order form promises A+B power, and its committed-power table lists D06 as A+B.',
      evidence: [{ doc: R, line: rosterLineOf['D06/A'] }, { doc: of('trinity'), line: contractLineOf['trinity.power'] }, { doc: of('trinity'), line: contractLineOf['trinity.committed.D06'] }],
      consequential: [{ rule: 'contract-topology-mismatch', subject: ref('contract', 'DFW-MSA-1129'), why: 'A+B promised, D06 single-corded', evidence: [{ doc: of('trinity'), line: contractLineOf['trinity.power'] }] }],
      fix: fix('add-cord', spareRefs('RPP-3B'), 'Pull the B whip to the spare breaker at RPP-3B/31 (UPS-B path, diverse from RPP-3A).'),
    },
    {
      id: 'failover-overload-pdu2',
      rule: 'failover-overload',
      subjects: [ref('pdu', 'PDU-2A'), ref('pdu', 'PDU-2B')],
      affectedCabinets: cabs.filter((c) => c.cab.startsWith('C')).map((c) => c.cab),
      customer: 'C1102',
      why: `Row C (Caddo AI, 12 cabinets) draws ${rowCLoad} kW split across PDU-2A and PDU-2B (each ~${Math.round(rowCLoad / 2)} kW, about 64% of 150 kVA at pf 0.9). Losing either side puts ${rowCLoad} kW on the survivor, above its 150 kVA rating at any power factor. PDU-2B's rating is itself conflicted (register 150 kVA vs BMS 225 kVA), so the loss-of-PDU-2A direction is contingent; loss of PDU-2B overloading PDU-2A (150 kVA, unconflicted) is definite.`,
      evidence: [
        { doc: E, line: regLineOf['PDU-2A'] }, { doc: E, line: regLineOf['PDU-2B'] },
        { doc: R, line: rosterLineOf['C01/A'], note: 'per-cabinet measured kW column cab_kw_meas' },
      ],
      consequential: [],
      fix: fix('rehome-cord', spareRefs('PDU-1A'), 'Move enough row C A cords (three of the heaviest) onto the 60A spares on PDU-1A that losing PDU-2B no longer overloads PDU-2A. The contingent PDU-2B direction is left for the rating conflict to settle.'),
    },
    {
      id: 'circuit-overcommit-B03',
      rule: 'circuit-overcommit',
      subjects: [ref('circuit', `PDU-1A/${cabs.find((c) => c.cab === 'B03')!.pos}`), ref('circuit', `PDU-1B/${cabs.find((c) => c.cab === 'B03')!.pos}`), ref('cabinet', 'B03')],
      affectedCabinets: ['B03'],
      customer: 'C1041',
      why: 'B03 was upgraded to 8.0 kW committed (CR-2291) but its circuits stayed 30A/208V single-phase: 6.24 kVA nameplate, 4.99 kW at the 80% continuous limit (pf 1.0). On failover one circuit must carry the committed 8.0 kW.',
      evidence: [{ doc: of('mesquite'), line: contractLineOf['mesquite.committed.B03'] }, { doc: R, line: rosterLineOf['B03/A'] }, { doc: R, line: rosterLineOf['B03/B'] }],
      consequential: [],
      fix: fix(null, [], 'Needs both whips upsized to 3-phase (a circuit upgrade), which is not a cord move; no spare is planted for it.'),
    },
    {
      id: 'cooling-common-cause-mcc-b',
      rule: 'cooling-common-cause',
      subjects: [ref('chiller', 'CH-2'), ref('chiller', 'CH-3'), ref('breaker', 'SWGR-B-CB-3'), ref('header', 'CHWS-HDR-2')],
      affectedCabinets: 'all',
      customer: null,
      why: `The loop is documented N+1 (3 x 90 TR, 2 required). Standby CH-3 was moved onto MCC-B in 2022, so it shares SWGR-B CB-3 (and header CHWS-HDR-2) with duty chiller CH-2. Losing SWGR-B CB-3, SWGR-B or ATS-B leaves only CH-1 (${Math.round(90 * 3.517 * 10) / 10} kW) against ~${hallLoad} kW of IT heat. N+1 by unit count, not by failure domain.`,
      evidence: [
        { doc: E, line: regLineOf['CH-3'] }, { doc: E, line: regLineOf['CH-2'] }, { doc: E, line: regLineOf['CHW-LOOP-1'] },
        { doc: B, line: bmsLineOf['CH-3.power'] }, { doc: B, line: bmsLineOf['CH-3.role'] },
        { doc: W, line: woLineOf['ch3-mcc-move'], note: 'WO-22-0418: CH-3 re-fed from MCC-B' },
      ],
      consequential: CUSTOMERS.filter((c) => c.cooling === 'N+1').map((c) => ({
        rule: 'contract-topology-mismatch', subject: ref('contract', c.msa), why: 'order form promises N+1 cooling',
        evidence: [{ doc: of(c.short), line: contractLineOf[`${c.short}.cooling`] }],
      })),
      fix: fix(null, [], 'Cooling: move CH-3 back to an A-side MCC. Not a power cord move.'),
    },
    {
      id: 'contract-2n-lonestar',
      rule: 'contract-topology-mismatch',
      subjects: [ref('contract', 'DFW-MSA-1183'), ref('rpp', 'RPP-5B')],
      affectedCabinets: ['E06', 'E07', 'E08', 'E09', 'E10'],
      customer: 'C1183',
      why: 'Lone Star Genomics bought 2N (two independent UPS systems). E06-E10 A cords are on RPP-5A (PDU-3A, UPS-A); B cords are on RPP-5B, fed from SWGR-B CB-6 through a transformer with no UPS. The paths are independent, so there is no A/B convergence, but only one UPS path exists.',
      evidence: [{ doc: of('lonestar'), line: contractLineOf['lonestar.power'] }, { doc: E, line: regLineOf['RPP-5B'] }, { doc: E, line: regLineOf['SWGR-B CB-6'] }],
      consequential: [],
      fix: fix(null, [], 'Needs a second UPS path for RPP-5B (new equipment), not a cord move.'),
    },
  ],
  spares: SPARES.map((s) => ({
    circuit: ref('circuit', `${s.panel}/${s.pos}`),
    rating: `${s.amps}A/208V/${s.phases}ph`,
    note: s.note,
    evidence: [{ doc: B, line: bmsLineOf[`spare.${s.panel}/${s.pos}`] }],
  })),
  conflicts: [
    {
      id: 'conflict-D03-B-circuit',
      entity: ref('cord', 'D03/B'),
      field: 'circuit',
      sources: [
        { doc: R, line: rosterLineOf['D03/B'], value: 'RPP-3B/13' },
        { doc: B, line: bmsLineOf['bcm.D03-B'], value: 'RPP-3A/26' },
      ],
      stakes: 'If the BMS is right both D03 cords are on RPP-3A, so D03 is single-path (convergence at RPP-3A).',
    },
    {
      id: 'conflict-PDU-2B-rating',
      entity: ref('pdu', 'PDU-2B'),
      field: 'rating',
      sources: [
        { doc: E, line: regLineOf['PDU-2B'], value: { unit: 'kva', kva: 150 } },
        { doc: B, line: bmsLineOf['PDU 2B.rating'], value: { unit: 'kva', kva: 225 } },
      ],
      stakes: 'At 225 kVA PDU-2B could carry all of row C after losing PDU-2A; at 150 kVA it cannot.',
    },
    {
      id: 'conflict-SWGR-B-CB-1-rating',
      entity: ref('breaker', 'SWGR-B-CB-1'),
      field: 'rating',
      sources: [
        { doc: E, line: regLineOf['SWGR-B CB-1'], value: { unit: 'amps', amps: 1200, volts: 480, phases: 3 } },
        { doc: B, line: bmsLineOf['SWGR-B-CB-1.meter'], value: { unit: 'amps', amps: 1600, volts: 480, phases: 3 } },
      ],
      stakes: 'Low: either rating carries UPS-B (750 kVA). A correct ranking puts this below the other two.',
    },
  ],
  workOrders: {
    doc: W,
    exportedAt: '2026-11-08T00:00',
    note: 'Times are site-local wall clock as Maximo printed them. expectedGrade is the risk grade (highest / high / medium / low, docs/research/03 §1) derived by hand from the register and contracts.',
    week: week.map((w) => {
      const grades: Record<string, { grade: 'highest' | 'high' | 'medium' | 'low'; why: string }> = {
        'CRAH-05': { grade: 'medium', why: `MP-B (SWGR-B CB-4) feeds CRAH-02/04/06/08, so with CRAH-05 stopped one CB-4 trip leaves CRAH-01/03/07, at most 315 kW, for ~${hallLoad} kW of IT heat; every cabinet keeps both cords.` },
        'PDU-3A': { grade: 'highest', why: 'RPP-4B was re-fed from PDU-3A SF-3 under MOP-0117 and never returned (step 31 cancelled), so a PDU-3A shutdown takes both paths to Halcyon E01-E05.' },
        'CH-2': { grade: 'medium', why: 'With CH-2 offline, the remaining chillers are CH-1 (MCC-A) and standby CH-3, which shares SWGR-B CB-3 / MCC-B with CH-2: one more fault on the B side leaves CH-1 alone. No power path changes.' },
        'UPS-A': { grade: 'high', why: 'Halcyon E01-E05 draw both cords from PDU-3A (RPP-4A and RPP-4B), so with UPS-A on maintenance bypass their only source is SWGR-A CB-2: one trip drops them.' },
        'GEN-1': { grade: 'high', why: 'GEN-1 is the only alternate on ATS-A, and Halcyon E01-E05 draw both cords from the A side, so during the test a UTIL-1 loss leaves them only UPS-A battery (8 min).' },
      };
      const asset = reg.find((r) => r[0] === w.tag)!;
      return {
        wonum: w.wonum, line: woLineOf[w.key], assetNum: assetNumOf[w.tag!], asset: ref(kindOfClass(asset[1]), w.tag!),
        schedStart: w.sched!.start.toISOString().slice(0, 16), status: w.status,
        expectedGrade: grades[w.tag!]!.grade, why: grades[w.tag!]!.why,
      };
    }),
    paperTrail: (['ch3-mcc-move', 'mop-0117', 'mop-0117-step12', 'mop-0117-step31', 'd03-retermination', 'b03-upgrade', 'xfmr-5b', 'caddo-prepull', 'd06-whip', 'ch2-trip', 'ch2-coil'] as const)
      .map((k) => ({ key: k, wonum: woOf[k]!.wonum, line: woLineOf[k], status: woOf[k]!.status, description: woOf[k]!.desc })),
    unresolvedAssets: wos.filter((w) => w.tag && !kindOfClass(reg.find((r) => r[0] === w.tag)![1]))
      .map((w) => ({ wonum: w.wonum, line: woLineOf[w.key], assetNum: assetNumOf[w.tag!], tag: w.tag, why: `register class "${reg.find((r) => r[0] === w.tag)![1]}" is not part of the model` })),
  },
  history: {
    docs: Object.values(HISTORY_DOCS).map((d) => `docs/${d}`),
    note: 'Site-local wall clock. The CH-2 trip is one event across the BMS, the power monitoring system and Maximo, in this order.',
    ch2Trip: [
      { doc: `docs/${HISTORY_DOCS.bmsEvents}`, line: desigoLineOf.get(tripAlarm), entity: ref('chiller', 'CH-2'), what: 'High Discharge Pressure raised' },
      { doc: `docs/${HISTORY_DOCS.pmeEvents}`, line: pmeLineOf.get(tripFeeder), entity: ref('breaker', 'SWGR-B CB-3'), what: 'MCC-B feeder Under Current pick up (CH-2 is fed from SWGR-B CB-3)' },
      { doc: W, line: woLineOf['ch2-trip'], entity: ref('chiller', 'CH-2'), what: `${woOf['ch2-trip']!.wonum} emergency work order` },
    ],
    unresolvedSources: [{ system: 'bms', source: 'DFW1.Bldg1.CHW_Plant.OAT', why: 'outdoor air sensor; no register asset' }],
  },
  decoys: [
    {
      id: 'decoy-shared-utility',
      looksLike: 'ab-convergence',
      subjects: [ref('utility', 'UTIL-1'), ref('ats', 'ATS-A'), ref('ats', 'ATS-B')],
      why: 'Both ATS normal inputs come from UTIL-1. Expected: each side has its own generator (GEN-1, GEN-2) and UPS battery (8 min) covers the 10 s transfer, so UTIL-1 is not a single point of failure.',
      evidence: [{ doc: E, line: regLineOf['ATS-A'] }, { doc: E, line: regLineOf['ATS-B'] }],
    },
    {
      id: 'decoy-normally-open-tie',
      looksLike: 'ab-convergence',
      subjects: [ref('breaker', 'SWGR-A-CB-5')],
      why: 'SWGR-A CB-5 is a tie to SWGR-B, normally open and kirk-key interlocked. Nothing is fed from it; it does not join the A and B paths.',
      evidence: [{ doc: E, line: regLineOf['SWGR-A CB-5'] }],
    },
    {
      id: 'decoy-3ph-A08',
      looksLike: 'circuit-overcommit',
      subjects: [ref('cabinet', 'A08'), ref('circuit', `PDU-1A/${cabs.find((c) => c.cab === 'A08')!.pos}`), ref('circuit', `PDU-1B/${cabs.find((c) => c.cab === 'A08')!.pos}`)],
      why: 'A08 is committed 7.5 kW on 30A circuits, which looks over the 4.99 kW single-phase limit, but the A08 whips are 3-phase: 30A x 208V x sqrt(3) = 10.8 kVA, 8.6 kW at 80% (7.8 kW at pf 0.9).',
      evidence: [{ doc: R, line: rosterLineOf['A08/A'] }, { doc: of('mesquite'), line: contractLineOf['mesquite.committed.A08'] }],
    },
    {
      id: 'decoy-tag-spellings',
      looksLike: 'conflict',
      subjects: [ref('pdu', 'PDU-2A'), ref('crah', 'CRAH-5')],
      why: 'PDU-2A is written "PDU-2A" (register), "PDU 2A" (BMS) and "PDU2A" (roster); CRAH-05 is "CRAH-5" in the BMS. Each set is one device after tag normalization, not a conflict and not extra equipment.',
      evidence: [{ doc: E, line: regLineOf['PDU-2A'] }, { doc: B, line: bmsLineOf['PDU 2A.name'] }, { doc: R, line: rosterLineOf['C01/A'] }, { doc: B, line: bmsLineOf['CRAH-5.name'] }],
    },
  ],
};
writeFileSync(join(siteDir, 'ground_truth.json'), JSON.stringify(truth, null, 2) + '\n');
console.log(JSON.stringify({ cabinets: cabs.length, rosterRows: rosterLines.length - 1, registerRows: reg.length, bmsLines: L.length, hallLoad, rowCLoad }));
