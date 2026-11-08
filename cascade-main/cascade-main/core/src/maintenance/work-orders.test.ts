import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../facility/assemble.js';
import { siteId } from '../facility/ids.js';
import { sourceDocument } from '../ingest/documents.js';
import { parserFor } from '../ingest/sources.js';
import { loadDfw1 } from '../testing/dfw1.js';
import { addBusinessDays, addDays, upcomingWorkOrders, workOrdersOf } from './work-orders.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const orders = workOrdersOf(docs.documents, facility);
const exportDoc = docs.documents.find((d) => d.path === 'maximo_workorders.csv')!;
const rows = exportDoc.text!.trimEnd().split('\n').length - 1;

test('the Maximo export parses: no unparsed documents, every row a work order, none skipped', () => {
  assert.deepEqual(docs.unparsed, []);
  const r = parserFor(exportDoc)!.parse(exportDoc);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.workOrders.length, rows);
  assert.equal(orders.length, rows);
});

test("the week's planned work is five work orders in schedule order, each on a model entity", () => {
  const week = upcomingWorkOrders(orders, '2026-11-08T00:00');
  assert.deepEqual(
    week.map((o) => [o.scheduledStart, o.asset?.resolved ? o.asset.entity : null]),
    [
      ['2026-11-09T08:00', 'crah:CRAH-5'],
      ['2026-11-10T14:00', 'pdu:PDU-3A'],
      ['2026-11-11T07:00', 'chiller:CH-2'],
      ['2026-11-12T22:00', 'ups:UPS-A'],
      ['2026-11-13T09:00', 'generator:GEN-1'],
    ],
  );
  assert.deepEqual(upcomingWorkOrders(orders, '2026-11-08T00:00', '2026-11-11T00:00').map((o) => o.wonum), ['WO-26-1227', 'WO-26-1230']);
  assert.equal(addDays('2026-11-28T22:00', 7), '2026-12-05T22:00');
  assert.deepEqual(upcomingWorkOrders(orders, '2026-11-11T00:00').map((o) => o.asset?.resolved && o.asset.entity), ['chiller:CH-2', 'ups:UPS-A', 'generator:GEN-1']);
});

test('the MOP-0117 return-to-normal work order was cancelled, and the temporary re-feed closed', () => {
  const step = (n: number) => orders.find((o) => o.description.includes(`MOP-0117 STEP ${n}`));
  assert.equal(step(12)?.status, 'CLOSE');
  assert.equal(step(31)?.status, 'CAN');
  assert.deepEqual([step(12), step(31)].map((o) => o?.asset?.resolved && o.asset.entity), ['rpp:RPP-4B', 'rpp:RPP-4B']);
});

test('assets the model does not include are reported with the reason, not dropped', () => {
  const xfmr = orders.find((o) => o.description.startsWith('INSTALL XFMR-5B'));
  assert.ok(xfmr?.asset && !xfmr.asset.resolved);
  assert.deepEqual([xfmr.asset.resolved, xfmr.asset.assetNum], [false, 'EQ-010377']);
  assert.match(xfmr.asset.why, /Transformer/);
  const unknown = workOrdersOf(
    [sourceDocument({ path: 'wo.csv', format: 'csv', text: 'WONUM,STATUS,WORKTYPE,REPORTDATE,ASSETNUM\nWO-1,APPR,CM,11/02/2026 09:00 AM,EQ-999999\n' })],
    facility,
  );
  const asset = unknown[0]?.asset;
  assert.ok(asset && !asset.resolved);
  assert.deepEqual([asset.resolved, asset.assetNum], [false, 'EQ-999999']);
  assert.match(asset.why, /register/);
});

test('rows the parser cannot read are skipped with the reason', () => {
  const text = 'WONUM,STATUS,WORKTYPE,REPORTDATE,SCHEDSTART\nWO-1,APPR,PM,11/02/2026 09:00 AM,13/40/2026 09:00 AM\nWO-2,DONE,PM,11/02/2026 09:00 AM,\nWO-3,APPR,PM,11/02/2026 09:00 AM,11/10/26 2:00 PM\n';
  const doc = sourceDocument({ path: 'wo.csv', format: 'csv', text });
  const r = parserFor(doc)!.parse(doc);
  assert.deepEqual(r.skipped.map((s) => s.where), ['line 2', 'line 3']);
  assert.deepEqual(r.workOrders.map((o) => [o.wonum, o.scheduledStart]), [['WO-3', '2026-11-10T14:00']]);
});

test('business days skip weekends both ways', () => {
  assert.equal(addBusinessDays('2026-11-10', -10), '2026-10-27');
  assert.equal(addBusinessDays('2026-11-08', 10), '2026-11-20');
  assert.equal(addBusinessDays('2026-11-13', 1), '2026-11-16');
});
