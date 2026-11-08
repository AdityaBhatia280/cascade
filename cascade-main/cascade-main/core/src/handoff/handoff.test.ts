import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { assemble } from '../facility/assemble.js';
import { siteId } from '../facility/ids.js';
import { historyOf } from '../history/history.js';
import { workOrdersOf } from '../maintenance/work-orders.js';
import { loadDfw1 } from '../testing/dfw1.js';
import { shiftHandoff } from './handoff.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const brief = (at: string) => shiftHandoff(an, { workOrders: workOrdersOf(docs.documents, facility), history: historyOf(docs.documents, facility), at });

test('at 2026-11-09 18:00 the brief lists WO-26-1230 as due within 24 h, with its assessment', () => {
  const b = brief('2026-11-09T18:00');
  const pdu = b.work.find((w) => w.assessment.workOrder.wonum === 'WO-26-1230');
  assert.equal(pdu?.when, 'due');
  assert.ok(pdu.assessment.assessed);
  assert.match(pdu.assessment.headline, /Halcyon Health Partners E01–E05 lose power/);
  assert.match(b.text, /DUE Tue 2026-11-10 14:00-18:00 {2}WO-26-1230 PDU-3A ANNUAL PM/);
  assert.equal(b.work.some((w) => w.assessment.workOrder.wonum === 'WO-26-1235'), false, 'CH-2 work starts 11/11 07:00, past the 24 h');
});

test('the D06 B-whip work order (ticket 88213) is listed as waiting on materials, and against D06 being single-corded', () => {
  const b = brief('2026-11-09T18:00');
  assert.deepEqual(b.waiting.map((o) => [o.wonum, o.status]), [['WO-26-1056', 'WMATL']]);
  assert.match(b.text, /WO-26-1056 PULL D06 B WHIP TO RPP-3B CB31 - TICKET 88213: waiting on materials since 2026-09-18\.$/m);
  const d06 = b.lostRedundancy.find((x) => x.finding.id === 'single-corded:cabinet:D06');
  assert.deepEqual(d06?.openWork.map((o) => o.wonum), ['WO-26-1056']);
  assert.equal(b.calls.find((c) => c.workOrder.wonum === 'WO-26-1056')?.lead, 'DOKAFOR');
});

test('in-progress work, still-active alarms and the export edge are stated, not hidden', () => {
  const b = brief('2026-11-08T18:00');
  assert.deepEqual(b.work.filter((w) => w.when === 'in-progress').map((w) => w.assessment.workOrder.wonum), ['WO-26-1259']);
  assert.deepEqual(b.alarms.recent, []);
  assert.deepEqual(b.alarms.standing.map((e) => [e.source, e.text]), [['DFW1.Bldg1.DH-1.CRAH-07.Fan2_Status', 'EC Fan 2 Fault']]);
  assert.match(b.text, /the BMS export ends Tue 2026-11-03 09:58, so this window is not covered by it/);
});

test('watch lists the chilled-water 50 °F and cold aisle alarm limits', () => {
  const limits = brief('2026-11-08T18:00').watch.flatMap((w) => (w.kind === 'limit' ? [w.limit] : []));
  const aisle = [['hall:DH-1', 'high', 80.6], ['hall:DH-1', 'low', 64.4]];
  assert.deepEqual(limits.map((l) => [l.entity, l.bound, l.value]), [
    ['chiller:CH-1', 'high', 50], ['chiller:CH-2', 'high', 50], ['chiller:CH-3', 'high', 50], ['loop:CHW-LOOP-1', 'high', 50], ...aisle, ...aisle, ...aisle,
  ]);
});

test('who to call names the vendor Maximo lists for the PDU-3A job', () => {
  const call = brief('2026-11-09T18:00').calls.find((c) => c.workOrder.wonum === 'WO-26-1230');
  assert.deepEqual([call?.vendor, call?.lead], ['VERTIV-ERS', 'DOKAFOR']);
});
