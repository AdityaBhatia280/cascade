// Cooling deficits judged against the load that is actually left, on the DFW1 seed. Found by an
// independent re-derivation of every single failure from the raw documents (crosscheck/), which
// disagreed with the engine on exactly these two cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { assemble } from '../facility/assemble.js';
import { siteId, tagOf, type AnyId } from '../facility/ids.js';
import { loadDfw1 } from '../testing/dfw1.js';

const { facility: f } = assemble({ site: siteId('dfw1'), statements: loadDfw1().statements, completed: [] });
const an = analyze(f);
const fail = (id: string) => {
  const r = an.whatIf({ events: [{ target: f.parseId(id)!, how: 'fails', atMin: 0 }] });
  const final = new Map<AnyId, (typeof r.timeline)[number]>();
  for (const tr of r.timeline) final.set(tr.id, tr);
  const cabinets = f.list('cabinet').map((c) => c.id);
  return { r, final, down: cabinets.filter((c) => final.get(c)?.state === 'down').map(tagOf).sort(), cabinets };
};
const ROW_C = Array.from({ length: 12 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);

test('losing SWGR-B darkens row C only: the PDU-2A overload sheds 173.5 kW before CH-1 alone is judged against the heat', () => {
  // SWGR-B takes CH-2 and CH-3 (both on MCC-B) and leaves CH-1, 316.5 kW against 347.2 kW of IT
  // heat. But row C's A cords then pull 173.5 kW through PDU-2A (142.5 kW), which trips; the
  // remaining ~174 kW fits on CH-1. Rows A, B, D and E keep their A side.
  const x = fail('switchgear:SWGR-B');
  assert.deepEqual(x.down, ROW_C);
  assert.equal(x.final.get(f.parseId('pdu:PDU-2A')!)?.cause.kind, 'overload');
  assert.ok(!x.r.timeline.some((t) => t.cause.kind === 'thermal'), 'the deficit cleared within its ride-through, so no heat event lands');
});

test('losing SWGR-B CB-3 is still a whole-hall cooling loss: nothing sheds load, so CH-1 alone is short', () => {
  const x = fail('breaker:SWGR-B-CB-3');
  assert.equal(x.down.length, x.cabinets.length);
  assert.ok(x.cabinets.every((c) => x.final.get(c)!.cause.kind === 'thermal'));
});

test('a failed chilled-water loop takes every CRAH it feeds, whatever its chillers and pumps are doing', () => {
  const x = fail('loop:CHW-LOOP-1');
  assert.equal(x.down.length, x.cabinets.length);
  // Full loss: ride-through is the full-loss constant (6 min), not stretched by a partial deficit.
  assert.ok(x.cabinets.every((c) => x.final.get(c)!.cause.kind === 'thermal' && x.final.get(c)!.tMin === 6));
});

test('MCC-B, the mechanical panels and XFMR-5B are devices between their breaker and their loads', () => {
  // Register: CH-2, CH-3 and CHWP-2 are fed "SWGR-B CB-3 (via MCC-B)"; MCC-B is fed from SWGR-B CB-3.
  const mcc = fail('panel:MCC-B');
  assert.deepEqual(['chiller:CH-2', 'chiller:CH-3', 'pump:CHWP-2'].map((u) => mcc.final.get(f.parseId(u)!)?.state), ['down', 'down', 'down']);
  assert.ok(!mcc.final.has(f.parseId('chiller:CH-1')!), 'CH-1 is on MCC-A');
  assert.deepEqual(mcc.down, fail('breaker:SWGR-B-CB-3').down, 'MCC-B carries everything its feeder breaker does');
  // SWGR-A CB-4's note: "MP-A mech panel: CRAH-01/03/05/07". Four 105 kW CRAHs are left for 347.2 kW of heat.
  const mp = fail('panel:MP-A');
  assert.deepEqual([...mp.final.keys()].filter((id) => id.startsWith('crah:')).sort(), ['crah:CRAH-1', 'crah:CRAH-3', 'crah:CRAH-5', 'crah:CRAH-7']);
  assert.deepEqual(mp.down, []);
  // RPP-5B: "SWGR-B CB-6 via XFMR-5B". Losing the transformer leaves Lone Star E06-E10 on their A cords.
  const x = fail('transformer:XFMR-5B');
  assert.deepEqual(x.down, []);
  assert.deepEqual(['E06', 'E07', 'E08', 'E09', 'E10'].map((c) => x.final.get(f.parseId(`cabinet:${c}`)!)?.state), Array(5).fill('exposed'));
});
