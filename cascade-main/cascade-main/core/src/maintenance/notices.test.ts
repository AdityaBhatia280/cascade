import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { assemble } from '../facility/assemble.js';
import { siteId } from '../facility/ids.js';
import { loadDfw1 } from '../testing/dfw1.js';
import { assessWorkOrders } from './assessment.js';
import { maintenanceNotices, type MaintenanceNotice } from './notices.js';
import { workOrdersOf } from './work-orders.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const all = workOrdersOf(docs.documents, facility);

function noticesFor(wonum: string, issuedOn = '2026-11-08T18:00'): MaintenanceNotice[] {
  const set = maintenanceNotices(an, assessWorkOrders(an, all.filter((o) => o.wonum === wonum), all)[0]!, all, issuedOn);
  assert.ok(set.assessed, `${wonum} was not assessed`);
  return [...set.notices];
}
const of = (ns: MaintenanceNotice[], customer: string) => ns.find((n) => n.customer === `customer:${customer}`)!;

test('PDU-3A: every customer of the site gets exactly one notice', () => {
  assert.deepEqual(noticesFor('WO-26-1230').map((n) => n.id), ['C1041', 'C1077', 'C1102', 'C1129', 'C1156', 'C1183'].map((c) => `WO-26-1230/${c}`));
});

test("PDU-3A: Halcyon's notice is blocked because RPP-4B, labelled B, is fed from PDU-3A, and never says a feed remains", () => {
  const n = of(noticesFor('WO-26-1230'), 'C1156');
  assert.ok(n.blocked, 'the Halcyon notice must be blocked');
  assert.match(n.blocked.reason, /RPP-4B, which is labelled B but fed from PDU-3A-SF-3 on the A side/);
  assert.match(n.blocked.reason, /Re-feed RPP-4B from the B side before this work/);
  assert.match(n.blocked.reason, /WO-23-0499 RETURN RPP-4B TO PDU-3B SF-2 .* was cancelled/);
  assert.deepEqual(n.blocked.workOrders.map((o) => o.wonum), ['WO-23-0499']);
  assert.doesNotMatch(n.body, /remains/);
  assert.match(n.body, /Are you affected\? Yes\. E01–E05 would lose power\./);
  assert.match(n.body, /E01–E05: your A and B feeds would both be de-energized/);
});

test('PDU-3A: Lone Star, whose A feed goes, is told plainly that its B feed remains, and is not blocked', () => {
  const n = of(noticesFor('WO-26-1230'), 'C1183');
  assert.equal(n.blocked, null);
  assert.match(n.subject, /affects E06–E10$/);
  assert.match(n.body, /E06–E10: your A feed will be de-energized\. Your B feed remains\./);
});

test('PDU-3A: Trinity is blocked for D06, which has only its A cord, and names the waiting B-whip work order', () => {
  const n = of(noticesFor('WO-26-1230'), 'C1129');
  assert.ok(n.blocked);
  assert.match(n.blocked.reason, /D06 has power only through its A feed/);
  assert.ok(n.blocked.workOrders.some((o) => o.wonum === 'WO-26-1056'));
});

// An unaffected customer gets a notice that says so, rather than no notice: silence cannot be told
// apart from a lost email, and a notice that leaves "are we affected?" open is the complaint we fix.
test('PDU-3A: an unaffected customer gets a notice that says, first, that they are not affected', () => {
  const n = of(noticesFor('WO-26-1230'), 'C1041');
  assert.deepEqual(n.effects, []);
  assert.equal(n.blocked, null);
  assert.match(n.subject, /no impact to your cabinets$/);
  assert.match(n.body, /^Are you affected\? No\. None of your cabinets \(A01–A10, B01–B04\) loses power/m);
});

test('the notice period comes from the MSA notice clause and counts business days to the work', () => {
  const late = of(noticesFor('WO-26-1230', '2026-11-08T18:00'), 'C1041').period!;
  assert.deepEqual([late.requiredBusinessDays, late.givenBusinessDays], [10, 1]);
  assert.equal(late.clause, 'contract:DFW-MSA-1041#terms/maintenance-notice');
  assert.equal(of(noticesFor('WO-26-1230', '2026-10-26T09:00'), 'C1041').period!.givenBusinessDays, 10);
});

test('the content hash changes with the words, so an approval names exactly what was read', () => {
  const [a, b] = [of(noticesFor('WO-26-1230', '2026-11-08T18:00'), 'C1183'), of(noticesFor('WO-26-1230', '2026-11-09T08:00'), 'C1183')];
  assert.notEqual(a.contentHash, b.contentHash);
  assert.equal(a.contentHash, of(noticesFor('WO-26-1230', '2026-11-08T18:00'), 'C1183').contentHash);
});
