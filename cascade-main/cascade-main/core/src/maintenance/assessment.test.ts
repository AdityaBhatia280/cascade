import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { assemble } from '../facility/assemble.js';
import { siteId } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import { loadDfw1 } from '../testing/dfw1.js';
import { assessWorkOrders, renderRedundancy } from './assessment.js';
import { upcomingWorkOrders, workOrdersOf, type WorkOrder } from './work-orders.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const all = workOrdersOf(docs.documents, facility);
const week = assessWorkOrders(an, upcomingWorkOrders(all, '2026-11-08T00:00'), all);
const byWonum = new Map(week.map((x) => [x.workOrder.wonum, x]));
const assessed = (wonum: string) => {
  const x = byWonum.get(wonum);
  assert.ok(x?.assessed, `${wonum} was not assessed`);
  return x;
};

test("this week's five work orders come back in schedule order, each with a risk grade", () => {
  assert.deepEqual(
    week.map((x) => [x.workOrder.wonum, x.assessed && x.grade]),
    [
      ['WO-26-1227', 'medium'],
      ['WO-26-1230', 'highest'],
      ['WO-26-1235', 'medium'],
      ['WO-26-1241', 'high'],
      ['WO-26-1242', 'high'],
    ],
  );
});

test('PDU-3A shutdown is STOP (highest): Halcyon E01–E05 go from A+B to none because RPP-4B, labelled B, is fed from PDU-3A', () => {
  const x = assessed('WO-26-1230');
  const r = x.reasons[0]!;
  assert.equal(r.kind, 'loses-power');
  assert.equal(r.certainty, 'definite');
  const halcyon = r.customers[0]!;
  assert.equal(halcyon.customer, 'customer:C1156');
  assert.deepEqual(halcyon.cabinets, ['cabinet:E01', 'cabinet:E02', 'cabinet:E03', 'cabinet:E04', 'cabinet:E05']);
  assert.deepEqual([renderRedundancy(halcyon.before!), renderRedundancy(halcyon.after!)], ['A+B', 'none']);
  assert.ok(halcyon.revenueExposed > 0);
  assert.match(x.headline, /Halcyon Health Partners E01–E05 lose power \(A\+B → none\)/);

  const c = r.contradictions[0]!;
  assert.deepEqual([c.entity, c.labelledSide, c.tracedSide, c.fedFrom], ['rpp:RPP-4B', 'B', 'A', 'breaker:PDU-3A-SF-3']);
  assert.deepEqual(
    c.workOrders.filter((o) => o.description.includes('MOP-0117')).map((o) => [o.wonum, o.status]),
    [['WO-23-0498', 'CLOSE'], ['WO-23-0499', 'CAN']],
  );
});

test("PDU-3A's reason names the contract promise Halcyon is owed", () => {
  const promise = assessed('WO-26-1230').reasons[0]!.customers[0]!.promise!;
  assert.equal(promise, 'contract:DFW-MSA-1156#terms/power-redundancy');
  assert.equal(displayFact(facility.fact(promise)!), 'power A+B');
});

test('PDU-3A shutdown also drops D03 (both cords on RPP-3A per the BMS) and single-corded D06, and leaves the rest of row D and E06–E10 on one cord', () => {
  const x = assessed('WO-26-1230');
  const line = (kind: string) =>
    x.reasons.filter((r) => r.kind === kind).flatMap((r) => r.customers.map((c) => [c.cabinets.join(' '), `${renderRedundancy(c.before!)} → ${renderRedundancy(c.after!)}`, c.certainty]));
  assert.deepEqual(line('loses-power'), [
    ['cabinet:E01 cabinet:E02 cabinet:E03 cabinet:E04 cabinet:E05', 'A+B → none', 'definite'],
    ['cabinet:D03', 'A+B → none', 'definite'],
    ['cabinet:D06', 'A → none', 'definite'],
  ]);
  assert.ok(line('one-cord-left').some(([cabs, change]) => cabs === 'cabinet:E06 cabinet:E07 cabinet:E08 cabinet:E09 cabinet:E10' && change === 'A+B → B'));
});

test('CH-2 offline is medium: chillers drop from N+1 to N, a CH-1 or CH-3 trip would overheat the hall, and CH-3 shares CH-2’s breaker', () => {
  const x = assessed('WO-26-1235');
  assert.deepEqual(x.reasons.map((r) => r.kind), ['cooling-margin']);
  const r = x.reasons[0]!;
  assert.deepEqual(r.pools.map((p) => [p.pool, p.units, p.before, p.after]), [['loop:CHW-LOOP-1', 'chillers', 1, 0]]);
  assert.deepEqual(r.secondFaults.slice(0, 2), ['chiller:CH-1', 'chiller:CH-3']);
  assert.ok((r.standingFaults as readonly string[]).includes('breaker:SWGR-B-CB-3'), 'the breaker CH-2 and CH-3 share is already a single fault today');
  assert.deepEqual(r.sharedFeeds.map((s) => [s.unit, s.feed]), [['chiller:CH-3', 'breaker:SWGR-B-CB-3']]);
  assert.match(x.headline, /^Chillers N\+1 → N\./);
});

test('CRAH-05 filter change is medium: with it stopped, one MP-B breaker trip leaves 315 kW of CRAH for 347 kW of load', () => {
  const x = assessed('WO-26-1227');
  const r = x.reasons[0]!;
  assert.equal(r.kind, 'cooling-margin');
  assert.deepEqual(r.secondFaults, ['breaker:SWGR-B-CB-4']);
  assert.deepEqual(r.pools.map((p) => [p.units, p.before, p.after]), [['crahs', 4, 3]]);
});

test('UPS-A on maintenance bypass makes its bypass breaker a single fault for A-only cabinets, Halcyon included', () => {
  const x = assessed('WO-26-1241');
  assert.deepEqual(x.plant, ['ups:UPS-A']);
  const r = x.reasons.find((y) => y.customers.some((c) => c.customer === 'customer:C1156'))!;
  assert.equal(r.kind, 'new-single-fault');
  assert.deepEqual(r.secondFaults, ['breaker:SWGR-A-CB-2']);
  assert.deepEqual(r.contradictions.map((c) => c.entity), ['cord:D03/B', 'rpp:RPP-4B']);
});

const reworded = (wonum: string, description: string): WorkOrder => ({ ...all.find((o) => o.wonum === wonum)!, description });

test('a pump taken offline with two spares left is low: pumps N+2 → N+1 and no new single fault', () => {
  const [x] = assessWorkOrders(an, [reworded('WO-25-0779', 'CHWP-1 SEAL REPLACEMENT, CHWP-1 OFFLINE')], all);
  assert.ok(x?.assessed);
  assert.equal(x.grade, 'low');
  assert.deepEqual(x.reasons, []);
  assert.deepEqual(x.pools.map((p) => [p.units, p.before, p.after]), [['pumps', 2, 1]]);
});

test('work whose text takes nothing out of service is reported as not assessed, with the reason', () => {
  const [x] = assessWorkOrders(an, [all.find((o) => o.wonum === 'WO-25-0779')!], all);
  assert.ok(x && !x.assessed);
  assert.match(x.why, /does not say CHWP-1 goes out of service/);
});
