import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, type Analysis } from '../analysis/analysis.js';
import { assemble } from '../facility/assemble.js';
import { siteId, type AnyId } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import { historyOf } from '../history/history.js';
import { DFW1_DIR, loadDfw1 } from '../testing/dfw1.js';
import { draftMop, type Mop, type MopStep } from './mop.js';
import { replan } from './replan.js';
import { upcomingWorkOrders, workOrdersOf } from './work-orders.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const all = workOrdersOf(docs.documents, facility);
const site = historyOf(docs.documents, facility);
const asOf = '2026-11-08T00:00';
const truth = JSON.parse(readFileSync(path.join(DFW1_DIR, 'ground_truth.json'), 'utf8')) as { numbers: { hallMeasuredKw: number; chillerCapacityKwEach: number } };
const order = (wonum: string) => all.find((o) => o.wonum === wonum)!;
const mopOf = (wonum: string): Mop => {
  const m = draftMop({ an, order: order(wonum), history: all, site, asOf });
  assert.ok(!('why' in m), `${wonum} has no MOP`);
  return m;
};
const week = upcomingWorkOrders(all, asOf, '2026-11-15T00:00').map((o) => mopOf(o.wonum));
const pdu3a = week.find((m) => m.workOrder.wonum === 'WO-26-1230')!;

test('the PDU-3A MOP re-feeds RPP-4B onto spare PDU-3B SF-2 before PDU-3A is opened', () => {
  const ops = pdu3a.prerequisite?.patch.ops ?? [];
  assert.deepEqual(
    ops.filter((o) => o.op === 'refeed'),
    [{ op: 'refeed', device: 'rpp:RPP-4B', from: 'breaker:PDU-3A-SF-3', to: 'breaker:PDU-3B-SF-2' }],
  );
  assert.ok(pdu3a.prechecks.some((l) => /re-feed RPP-4B from PDU-3A-SF-3 to PDU-3B-SF-2/i.test(l) && /Before opening anything on PDU-3A/.test(l)));

  const closeSf2 = pdu3a.steps.find((s) => s.action.op === 'close' && s.action.device === 'breaker:PDU-3B-SF-2');
  const openPdu = pdu3a.steps.find((s) => s.action.op === 'open' && s.action.device === 'breaker:UPS-A-OB-3');
  assert.ok(closeSf2 && openPdu && closeSf2.n < openPdu.n, 'RPP-4B is back on the B side before PDU-3A is de-energized');
  assert.equal(closeSf2.phase, 'prerequisite');

  const openSf3 = pdu3a.steps.find((s) => s.action.op === 'open' && s.action.device === 'breaker:PDU-3A-SF-3')!;
  assert.match(openSf3.text, /^Open PDU-3A-SF-3 → RPP-4B de-energized → Halcyon Health Partners E01–E05 A\+B → A$/);
  assert.ok(!pdu3a.steps.some((s) => s.phase === 'work' && s.effect.customers.some((c) => c.customer === 'customer:C1156' && c.after.length === 0)), 'with the re-feed made, Halcyon never loses both feeds');
});

test('the PDU-3A MOP notifies Halcyon, whose 10-business-day notice deadline has already passed', () => {
  const halcyon = pdu3a.notifications.find((n) => n.customer === 'customer:C1156');
  assert.ok(halcyon, 'Halcyon is notified');
  assert.deepEqual([...halcyon.cabinets], ['cabinet:E01', 'cabinet:E02', 'cabinet:E03', 'cabinet:E04', 'cabinet:E05']);
  assert.equal(halcyon.noticeDays, 10);
  // Ten whole business days between notice and Tue 10 Nov 2026, counted by hand: 9, 6, 5, 4, 3, 2 Nov; 30, 29, 28, 27 Oct.
  // The notice goes out the business day before them, as the customer notices count it.
  assert.equal(halcyon.deadline, '2026-10-26');
  assert.equal(halcyon.status, 'deadline-passed');
  assert.ok(pdu3a.prechecks.some((l) => /notice is late/.test(l) && l.includes('Halcyon Health Partners')));
});

/** Per cabinet, the labelled sides of its cords still energized, read through the public what-if API. */
function sidesUnder(model: Analysis, events: MopStep['state']): Map<string, string> {
  const r = model.whatIf({ events });
  const last = new Map<string, string>();
  for (const t of r.timeline) last.set(t.id, t.state);
  const dead = (id: string) => last.get(id) === 'down' || last.get(id) === 'unknown';
  const out = new Map<string, string>();
  for (const cab of model.facility.list('cabinet')) {
    const live = dead(cab.id) ? [] : model.facility.cordsOf(cab.id).filter((c) => !dead(c.id));
    out.set(cab.id, [...new Set(live.map((c) => displayFact(c.labelledSide)))].sort().join('+') || 'none');
  }
  return out;
}

test("every switching step's effect is what propagate gives for that step's plant state", () => {
  for (const m of week) {
    const ops = m.prerequisite?.patch.ops ?? [];
    const models = [an, ...ops.map((_, i) => an.verify({ base: m.prerequisite!.patch.base, ops: ops.slice(0, i + 1) }, `test#${i}`).after!)];
    let before = sidesUnder(an, []);
    for (const s of [...m.steps, ...m.backout]) {
      const after = sidesUnder(models[s.applied]!, s.state);
      const changed = [...after].filter(([cab, x]) => (before.get(cab) ?? 'none') !== x).map(([cab]) => cab).sort();
      const claimed = s.effect.customers.flatMap((c) => c.cabinets).sort();
      assert.deepEqual(claimed, changed, `${m.workOrder.wonum} step ${s.n}: ${s.text}`);
      for (const c of s.effect.customers) {
        for (const cab of c.cabinets) {
          assert.equal(c.after.join('+') || 'none', after.get(cab), `${m.workOrder.wonum} step ${s.n} ${cab} after`);
          assert.equal(c.before.join('+') || 'none', before.get(cab), `${m.workOrder.wonum} step ${s.n} ${cab} before`);
        }
      }
      before = after;
    }
  }
});

test("the last work step leaves customers exactly where the assessment's scenario does, and the back-out restores them", () => {
  for (const m of week) {
    const ops = m.prerequisite?.patch.ops ?? [];
    const model = ops.length ? an.verify({ base: m.prerequisite!.patch.base, ops }, 'test').after! : an;
    const work = m.steps.filter((s) => s.phase === 'work').at(-1)!;
    const scenario = (m.prepared ?? m.assessment).work.events;
    assert.deepEqual(sidesUnder(model, work.state), sidesUnder(model, scenario), m.workOrder.wonum);
    assert.deepEqual(sidesUnder(model, m.backout.at(-1)!.state), sidesUnder(model, []), `${m.workOrder.wonum} back-out`);
  }
});

test('CH-2 offline: start standby CH-3 first, never open the MCC CH-2 shares with it, and stop on any chiller trip', () => {
  const m = week.find((x) => x.workOrder.wonum === 'WO-26-1235')!;
  assert.ok(m.prechecks.some((l) => /Start standby CH-3/.test(l)));
  assert.ok(m.prechecks.some((l) => /Do not open MCC-B: it also feeds CH-3/.test(l)));
  assert.ok(m.stopConditions.some((l) => /CH-1, CH-3/.test(l)));
  assert.ok(m.stopConditions.some((l) => /80\.6 °F/.test(l)));
  assert.deepEqual(m.steps.map((s) => s.text), ['Take CH-2 out of service (offline) and lock out → Chillers N+1 → N']);
  assert.deepEqual(m.backout.map((s) => s.text), ['Remove lockout and return CH-2 to service → Chillers N → N+1']);
  assert.ok(m.contingencies.includes('chiller:CH-1' as AnyId));
});

test('CH-1 tripping during the CH-2 job: the hall crosses 80.6 °F within the hand-computed window', () => {
  const r = replan({ an, order: order('WO-26-1235'), history: all, site, asOf, fault: 'chiller:CH-1' as AnyId });
  assert.ok(!('why' in r));
  const c = r.countdown!;
  // Hand derivation (06-cooling-physics §4.3): t = ΔT · c · P / deficit, c in [30, 50] MJ/K per MW.
  // P = 347.2 kW of measured IT load; CH-3 alone gives 316.5 kW; start 71.7 °F (Row C cold aisle,
  // 2026-11-07 23:45 trend); limit 27 °C = 80.6 °F, so ΔT = 8.9 °F = 4.944 K.
  const P = truth.numbers.hallMeasuredKw;
  const deficit = Math.round((P - truth.numbers.chillerCapacityKwEach) * 10) / 10;
  const dT = ((80.6 - 71.7) * 5) / 9;
  const at = (cap: number, d: number) => (dT * cap * P) / d / 60;
  assert.deepEqual([c.heatKw, c.startF, c.limitF], [P, 71.7, 80.6]);

  const [cold, running] = c.phases;
  assert.equal(running!.deficitKw, deficit);
  assert.ok(running!.countdown.minutes! >= at(30, deficit) && running!.countdown.minutes! <= at(50, deficit), `${running!.countdown.minutes} min in [${at(30, deficit)}, ${at(50, deficit)}]`);
  assert.ok(Math.abs(running!.countdown.minutes! - at(40, deficit)) < 0.1);
  assert.equal(cold!.deficitKw, P, 'before CH-3 carries load no chiller is running');
  assert.ok(cold!.countdown.minutes! >= at(30, P) && cold!.countdown.minutes! <= at(50, P));

  assert.match(r.actions[0]!, /^Start CH-3 now/);
  assert.ok(r.actions.some((a) => /return CH-2 to service: with it running, DH-1 has no cooling deficit/.test(a)));
  assert.ok(r.actions.some((a) => /without opening MCC-B: CH-3 is on the same feed/.test(a)));
  const who = r.affected;
  assert.equal(who.length, 6, 'all six DH-1 customers lose cooling margin');
  assert.ok(r.parameters.some((p) => p.basis === 'modeled' && /06-cooling-physics/.test(p.source)));
});

test('a power second fault reports who loses power and how to back out; a fault the engine did not list is refused', () => {
  const r = replan({ an, order: order('WO-26-1241'), history: all, site, asOf, fault: 'breaker:SWGR-A-CB-2' as AnyId });
  assert.ok(!('why' in r));
  assert.equal(r.countdown, null);
  assert.ok(r.affected.some((l) => /Halcyon Health Partners E01–E05 lose power/.test(l)));
  const refused = replan({ an, order: order('WO-26-1235'), history: all, site, asOf, fault: 'pdu:PDU-3A' as AnyId });
  assert.ok('why' in refused);
  assert.match(refused.why, /not one of the engine's second faults/);
});

test('a cooling MOP stops on the chilled-water high alarm the BMS point list sets', () => {
  const cooling = week.flatMap((m) => m.stopConditions).filter((l) => /supply water rises above/.test(l));
  assert.ok(cooling.length > 0, 'some MOP this week works on cooling');
  for (const l of cooling) {
    assert.match(l, /rises above 50 °F \(BMS high alarm\)/);
  }
});
