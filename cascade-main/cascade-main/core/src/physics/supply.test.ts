import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { BASE, BMS, fixture, setRow, type Row } from '../testing/fixture.js';
import type { Initiator, Transition } from './supply.js';

const run = (rows: readonly Row[], events: readonly [string, Initiator['how'], number][], bms: readonly Row[] = BMS) => {
  const { facility: f } = fixture(rows, bms);
  const an = analyze(f);
  const r = an.whatIf({ events: events.map(([t, how, atMin]) => ({ target: f.parseId(t)!, how, atMin })) });
  const final = new Map<string, Transition>();
  for (const tr of r.timeline) final.set(tr.id, tr);
  return { r, final, state: (id: string) => final.get(id)?.state ?? 'up', at: (id: string) => final.get(id)?.tMin };
};

test('A/B any-cord: one side down leaves the cabinet up but exposed; both sides down takes it down', () => {
  const one = run(BASE, [['pdu:PDU-B1', 'fails', 0]]);
  assert.equal(one.state('cabinet:C11'), 'exposed');
  assert.equal(one.final.get('cabinet:C11')!.cause.kind, 'lost-redundancy');
  assert.equal(one.state('cord:C11/A'), 'up');
  const both = run(BASE, [['pdu:PDU-B1', 'fails', 0], ['pdu:PDU-A1', 'fails', 0]]);
  assert.equal(both.state('cabinet:C11'), 'down');
});

test('exposed is an annotation: it never propagates to dependents', () => {
  const r = run(BASE, [['pdu:PDU-B1', 'fails', 0]]);
  assert.equal(r.state('cabinet:C11'), 'exposed');
  assert.equal(r.state('customer:ACME'), 'up');
  assert.ok(!r.r.timeline.some((t) => t.state === 'exposed' && t.cause.kind === 'no-supply'));
});

test('a cord with no documented circuit drives its cabinet to unknown, naming the missing fact', () => {
  const r = run(setRow(BASE, 'cord', 'C22/B', 'circuit', null), [['pdu:PDU-A1', 'fails', 0]], []);
  assert.equal(r.state('cabinet:C22'), 'unknown');
  assert.deepEqual(r.final.get('cabinet:C22')!.contingentOn, ['cord:C22/B#circuit']);
  assert.equal(run(BASE, [['pdu:PDU-A1', 'fails', 0]], []).state('cabinet:C22'), 'exposed');
  assert.equal(run(BASE, [['pdu:PDU-A1', 'fails', 0]]).state('cabinet:C22'), 'down');
});

test('UPS maintenance moves its output to bypass: exposed, not down', () => {
  const r = run(BASE, [['ups:UPS-A', 'maintenance', 0]]);
  assert.equal(r.state('ups:UPS-A'), 'exposed');
  for (const c of ['C11', 'C12', 'C13', 'C21', 'C22']) assert.notEqual(r.state(`cabinet:${c}`), 'down');
  assert.ok((r.r.timeline.find((t) => t.id === 'ups:UPS-A')!.cause as { how: string }).how === 'maintenance');
});

test('UPS maintenance without a bypass drops its output; the single-corded and converged cabinets go down', () => {
  const r = run(setRow(BASE, 'ups', 'UPS-A', 'bypass', 'none'), [['ups:UPS-A', 'maintenance', 0]]);
  assert.equal(r.state('ups:UPS-A'), 'down');
  assert.equal(r.state('cabinet:C21'), 'down');
  assert.equal(r.state('cabinet:C12'), 'down');
  assert.equal(r.state('cabinet:C11'), 'exposed');
});

test('UPS battery carries the load until it is exhausted, then the outage happens', () => {
  const r = run(BASE, [['switchgear:SWGR-A', 'fails', 0]]);
  assert.equal(r.r.timeline.find((t) => t.id === 'ups:UPS-A')!.state, 'exposed');
  assert.equal(r.state('ups:UPS-A'), 'down');
  assert.equal(r.at('ups:UPS-A'), 10);
  assert.equal(r.final.get('ups:UPS-A')!.cause.kind, 'battery-exhausted');
  assert.equal(r.at('cabinet:C21'), 10);
});

test('ATS transfer: losing the utility puts both lines on generator; nothing goes down', () => {
  const r = run(BASE, [['utility:UTIL-1', 'fails', 0]]);
  assert.equal(r.state('ats:ATS-A'), 'exposed');
  assert.equal(r.state('ats:ATS-B'), 'exposed');
  assert.ok(!r.r.timeline.some((t) => t.state === 'down' && t.id !== 'utility:UTIL-1'));
  const both = run(BASE, [['utility:UTIL-1', 'fails', 0], ['generator:GEN-A', 'fails', 0]]);
  assert.equal(both.state('ats:ATS-A'), 'down');
  assert.equal(both.state('cabinet:C11'), 'exposed');
});

test('load re-shares onto surviving cords and overloads an undersized survivor', () => {
  const rows = setRow(BASE, 'ups', 'UPS-B', 'rating', '8 kW');
  const r = run(rows, [['ups:UPS-A', 'fails', 0]], []);
  const ups = r.final.get('ups:UPS-B')!;
  assert.equal(ups.cause.kind, 'overload');
  assert.ok(ups.cause.kind === 'overload' && ups.cause.loadKw > 8 && ups.cause.ratedKw === 8);
  assert.equal(r.state('cabinet:C11'), 'down');
  assert.equal(run(BASE, [['ups:UPS-A', 'fails', 0]]).state('cabinet:C11'), 'exposed');
});

test('cooling is a capacity pool: losing a unit with no spare overheats the hall after a ride-through', () => {
  const rows = ['CRAH-1', 'CRAH-2', 'CRAH-3'].reduce((acc, c) => setRow(acc, 'crah', c, 'capacityKw', '10'), BASE as readonly Row[]);
  const r = run(rows, [['crah:CRAH-1', 'fails', 0]]);
  // 5 cabinets × 6 kW = 30 kW of heat against 20 kW left: deficit 10 kW; ride = 6 min × 30 / 10.
  assert.equal(r.state('hall:DH-1'), 'down');
  assert.deepEqual(r.final.get('cabinet:C11')!.cause, { kind: 'thermal', deficitKw: 10 });
  assert.equal(r.at('cabinet:C11'), 18);
  assert.equal(run(BASE, [['crah:CRAH-1', 'fails', 0]]).state('hall:DH-1'), 'up');
});

test('propagation is deterministic', () => {
  const { facility: f } = fixture();
  const s = { events: [{ target: f.parseId('switchgear:SWGR-A')!, how: 'fails' as const, atMin: 0 }] };
  assert.deepEqual(analyze(f).whatIf(s), analyze(f).whatIf(s));
});

test('propagation terminates on a supply cycle and fails the whole loop', () => {
  const rows: Row[] = [
    ...BASE,
    ['breaker', 'LOOP-BKR', 'bus', 'PDU-LOOP'],
    ['breaker', 'LOOP-BKR', 'rating', '50 kW'],
    ['pdu', 'PDU-LOOP', 'input', 'LOOP-BKR'],
    ['pdu', 'PDU-LOOP', 'rating', '50 kW'],
    ['circuit', 'PDU-LOOP/1', 'panel', 'PDU-LOOP'],
    ['circuit', 'PDU-LOOP/1', 'rating', '10 kW'],
    ['cord', 'C21/B', 'labelledSide', 'B'],
    ['cord', 'C21/B', 'circuit', 'PDU-LOOP/1'],
  ];
  const r = run(rows, [['breaker:LOOP-BKR', 'fails', 0]]);
  assert.equal(r.state('pdu:PDU-LOOP'), 'down');
  assert.equal(r.state('cabinet:C21'), 'exposed');
  const an = analyze(fixture(rows).facility);
  assert.doesNotThrow(() => {
    an.audit();
    an.scene();
  });
});
