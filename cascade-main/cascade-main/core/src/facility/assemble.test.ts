import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, BMS, fixture, fixtureInput, setRow } from '../testing/fixture.js';
import { assemble } from './assemble.js';
import { displayFact } from './kinds.js';
import { applyPatch, type PatchOp } from './patch.js';

test('the fixture assembles with no issues', () => {
  assert.deepEqual(fixture().issues, []);
});

test('when the register and the BMS disagree, the BMS value is the fact', () => {
  const { facility } = fixture();
  const cord = facility.get(facility.parseId('cord:C22/B', ['cord'])!);
  assert.deepEqual(cord.circuit, { ref: 'cord:C22/B#circuit', kind: 'known', value: 'circuit:PDU-A1/6' });
});

test('the order documents arrive in does not change which source wins', () => {
  const input = fixtureInput();
  const reversed = assemble({ ...input, statements: [...input.statements].reverse() });
  assert.equal(displayFact(reversed.facility.fact(fixture().facility.parseRef('cord:C22/B#circuit')!)!), 'PDU-A1/6');
});

test('within one source, the first value read wins', () => {
  const r = assemble(fixtureInput([...BASE, ['ups', 'UPS-A', 'batteryMin', '20 min']], []));
  assert.equal(displayFact(r.facility.fact(r.facility.parseRef('ups:UPS-A#batteryMin')!)!), '10 min');
});

test('a field no document states is missing', () => {
  const r = fixture(setRow(BASE, 'ups', 'UPS-A', 'rating', null), BMS);
  const ups = r.facility.get(r.facility.parseId('ups:UPS-A', ['ups'])!);
  assert.equal(ups.rating.kind, 'missing');
  assert.equal(displayFact(ups.rating), null);
});

test('a dangling reference is rejected at assembly', () => {
  const r = fixture([...BASE, ['pdu', 'PDU-X', 'input', 'UPS-NOPE']], BMS);
  assert.deepEqual(r.issues.map((i) => i.kind), ['dangling-ref']);
});

test('assembly is deterministic: same inputs, same revision', () => {
  assert.equal(fixture().facility.revision, fixture().facility.revision);
  assert.notEqual(fixture().facility.revision, fixture(BASE, []).facility.revision);
});

test('applying the same patch twice is refused', () => {
  const { facility } = fixture();
  const ops: PatchOp[] = [
    { op: 'refeed', device: facility.parseId('rpp:RPP-B2', ['rpp'])!, from: facility.parseId('breaker:UPS-A-2', ['breaker'])!, to: facility.parseId('breaker:UPS-B-2', ['breaker'])! },
    { op: 'add-cord', cabinet: facility.parseId('cabinet:C21', ['cabinet'])!, side: 'B', circuit: facility.parseId('circuit:PDU-B1/3', ['circuit'])! },
  ];
  const once = applyPatch(facility, { base: facility.revision, ops }, 'p1');
  assert.ok(once.ok);
  const twice = applyPatch(once.facility, { base: once.facility.revision, ops }, 'p1');
  assert.ok(!twice.ok);
  assert.deepEqual(twice.conflicts.map((c) => c.reason), ['value-changed', 'cord-exists']);
  const added = once.facility.get(once.facility.parseId('cord:C21/B', ['cord'])!);
  assert.equal(displayFact(added.circuit), 'PDU-B1/3');
});

test('a patch against a missing fact is refused, not applied silently', () => {
  const { facility } = fixture(setRow(BASE, 'cord', 'C22/B', 'circuit', null), []);
  const op: PatchOp = {
    op: 'rehome-cord',
    cord: facility.parseId('cord:C22/B', ['cord'])!,
    from: facility.parseId('circuit:PDU-B1/2', ['circuit'])!,
    to: facility.parseId('circuit:PDU-B1/3', ['circuit'])!,
  };
  const r = applyPatch(facility, { base: facility.revision, ops: [op] }, 'p2');
  assert.ok(!r.ok && r.conflicts[0]!.kind === 'precondition' && r.conflicts[0]!.reason === 'fact-missing');
});

test('a documented absence ("no bypass") is a value, not a rejected statement', () => {
  const r = fixture(setRow(BASE, 'ups', 'UPS-A', 'bypass', 'none'), BMS);
  assert.deepEqual(r.issues, []);
  const ups = r.facility.get(r.facility.parseId('ups:UPS-A', ['ups'])!);
  assert.equal(ups.bypass.kind, 'known');
  assert.equal(displayFact(ups.bypass), 'none');
});
