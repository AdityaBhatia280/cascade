import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assemble } from '../facility/assemble.js';
import { siteId, type AnyId } from '../facility/ids.js';
import { sourceDocument } from '../ingest/documents.js';
import { parseDocument } from '../ingest/sources.js';
import { workOrdersOf } from '../maintenance/work-orders.js';
import { DFW1_DIR, loadDfw1 } from '../testing/dfw1.js';
import { entityHistory, historyOf, type TimelineEntry } from './history.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const site = historyOf(docs.documents, facility);
const orders = workOrdersOf(docs.documents, facility);
const exportsOf = (prefix: string) => docs.documents.filter((d) => d.path.startsWith(prefix));
const historyDocs = ['desigo_', 'pme_'].flatMap(exportsOf);
const id = (raw: string) => facility.parseId(raw)!;
const window = (from: string, to: string) => ({ from, to });
const describe = (t: TimelineEntry) => (t.kind === 'event' ? `${t.event.system} ${t.event.phase} ${t.event.text}` : `work-order ${t.workOrder.wonum}`);

test('the BMS and power monitoring exports parse: every row a record, none skipped', () => {
  assert.deepEqual(docs.unparsed, []);
  assert.equal(historyDocs.length, 6);
  for (const d of historyDocs) {
    const r = parseDocument(d)!;
    assert.deepEqual(r.skipped, [], d.path);
    const rows = d.text!.trimEnd().split('\n').length - 1;
    assert.equal(r.events.length + r.trends.reduce((n, s) => n + s.samples.length, 0), rows, d.path);
  }
});

test("on 2026-08-24 CH-2's history shows the BMS alarm, then the PME feeder event, then the Maximo emergency work order", () => {
  const h = entityHistory(site, orders, facility, id('chiller:CH-2'), window('2026-08-24T15:00', '2026-08-24T20:00'));
  const alarm = h.timeline.findIndex((t) => t.kind === 'event' && t.event.system === 'bms' && t.event.phase === 'active' && t.event.text === 'High Discharge Pressure');
  const feeder = h.timeline.findIndex((t) => t.kind === 'event' && t.event.system === 'epms' && t.event.phase === 'active' && t.entity === 'breaker:SWGR-B-CB-3');
  const wo = h.timeline.findIndex((t) => t.kind === 'work-order' && t.workOrder.wonum === 'WO-26-0971');
  assert.ok(alarm >= 0 && feeder >= 0 && wo >= 0, h.timeline.map(describe).join('\n'));
  assert.ok(alarm < feeder && feeder < wo, `order: alarm ${alarm}, feeder ${feeder}, work order ${wo}`);
  const [a, f] = [h.timeline[alarm]!, h.timeline[feeder]!];
  assert.ok(a.at.startsWith('2026-08-24T16:04') && f.at.startsWith('2026-08-24T16:04'), `${a.at} ${f.at}`);
  assert.equal(h.timeline[wo]!.at, '2026-08-24T16:15');
  assert.ok(h.timeline.some((t) => t.kind === 'event' && t.event.text === 'Running' && t.at.startsWith('2026-08-24T18:40')), 'CH-2 back by the work order finish');
  assert.ok(h.timeline.every((t) => t.at >= '2026-08-24T15:00' && t.at < '2026-08-24T20:00'));
});

test('every event and trend source resolves to a model entity through the register, or is reported with the reason', () => {
  const sources = new Set(historyDocs.flatMap((d) => [...parseDocument(d)!.events.map((e) => e.source), ...parseDocument(d)!.trends.map((s) => s.source)]));
  const resolved = new Set([...site.events.map((e) => e.source), ...site.trends.map((s) => s.source)]);
  const reported = new Set(site.unresolved.map((u) => u.source));
  assert.deepEqual([...sources].filter((s) => resolved.has(s) === reported.has(s)), []);
  assert.deepEqual(site.unresolved.map((u) => u.source), ['DFW1.Bldg1.CHW_Plant.OAT']);
  assert.match(site.unresolved[0]!.why, /register/);
  const entityOf = (source: string) => [...site.events, ...site.trends].find((r) => r.source === source)?.entity;
  assert.equal(entityOf('DFW1.Bldg1.DH-1.CRAH-5.SAT'), 'crah:CRAH-5');
  assert.equal(entityOf('DFW1.SWGR-A-MAIN'), 'switchgear:SWGR-A');
  assert.equal(entityOf('DFW1.SWGR-B-CB3'), 'breaker:SWGR-B-CB-3');
  assert.equal(entityOf('DFW1.Bldg1.DH-1.Row_C.Cold_Aisle_Temp'), 'hall:DH-1');
  assert.equal(entityOf('DFW1.Bldg1.CHW_Plant.CHW-LOOP-1.CHWS_Temp'), 'loop:CHW-LOOP-1');

  const unmodeled = historyOf([...docs.documents, sourceDocument({ path: 'x.csv', format: 'csv', text: 'Timestamp UTC,Timestamp,Value,Source,Measurement,Unit\n8/1/2026 5:00:00 PM,8/1/2026 12:00:00 PM,1.5,DFW1.MCC-B,Active Power,kW\n' })], facility);
  const mcc = unmodeled.unresolved.find((u) => u.source === 'DFW1.MCC-B');
  assert.deepEqual(mcc && { system: mcc.system, source: mcc.source, records: mcc.records }, { system: 'epms', source: 'DFW1.MCC-B', records: 1 });
  assert.match(mcc!.why, /Motor Control Center/);
});

test('outdoor air in the trend export is NOAA KDFW interpolated between the :53 observations, LST moved to site time', () => {
  // LCD times are local standard time (UTC-6); the site clock is CDT (UTC-5) through 2026-11-01 02:00.
  const noaa = readFileSync(path.join(DFW1_DIR, 'external/noaa_kdfw_lcd_2026-06-01_2026-11-07.csv'), 'utf8')
    .split('\n').filter((l) => /^\d{4}-/.test(l))
    .map((l) => { const [t, c] = l.split(','); return { utc: Date.parse(`${t}Z`) + 6 * 3_600_000, f: (Number(c) * 9) / 5 + 32 }; });
  const cdtToUtc = (local: string) => Date.parse(`${local}Z`) + 5 * 3_600_000;
  const oat = parseDocument(exportsOf('desigo_trend_2026-08-22')[0]!)!.trends.find((s) => s.source === 'DFW1.Bldg1.CHW_Plant.OAT')!;
  assert.equal(oat.samples.length, 480);
  for (const s of oat.samples) {
    const t = cdtToUtc(s.at);
    const before = noaa.filter((o) => o.utc <= t).at(-1)!, after = noaa.find((o) => o.utc >= t)!;
    const expected = before.utc === after.utc ? before.f : before.f + ((after.f - before.f) * (t - before.utc)) / (after.utc - before.utc);
    assert.ok(Math.abs(s.value! - expected) <= 0.05 + 1e-9, `${s.at}: ${s.value} vs NOAA ${expected.toFixed(2)}`);
  }
  assert.equal(oat.samples.find((s) => s.at === '2026-08-24T16:00:00')!.value, 108);
});

test('the heat event stays physical: CHWS crosses the 50 F limit and recovers, cold aisles stay inside ASHRAE recommended', () => {
  const series = (source: string) => site.trends.filter((s) => s.source === source).flatMap((s) => s.samples);
  const day = (source: string) => series(source).filter((x) => x.at.startsWith('2026-08-24T'));
  const chws = day('DFW1.Bldg1.CHW_Plant.CHW-LOOP-1.CHWS_Temp');
  assert.ok(Math.max(...chws.map((x) => x.value!)) >= 50 && Math.max(...chws.map((x) => x.value!)) < 52);
  assert.ok(chws.filter((x) => x.at >= '2026-08-24T17:00').every((x) => x.value! < 45));
  for (const row of ['A', 'C', 'E']) assert.ok(series(`DFW1.Bldg1.DH-1.Row_${row}.Cold_Aisle_Temp`).every((x) => x.value! >= 64.4 && x.value! < 80.6), row);
  const chwsAlarm = site.events.filter((e) => e.source === 'DFW1.Bldg1.CHW_Plant.CHW-LOOP-1.CHWS_Temp' && e.phase === 'active');
  assert.deepEqual(chwsAlarm.map((e) => e.at.slice(0, 13)), ['2026-08-24T16']);
});

test('generator load runs, ATS transfers and the UPS-A maintenance bypass happen inside their Maximo actuals', () => {
  const spans = orders.filter((o) => /^(GEN-\d MONTHLY LOAD RUN|UPS-A EATON 9395P SEMI-ANNUAL)/.test(o.description) && o.actualStart! >= '2026-05-01' && o.actualFinish && o.actualFinish < '2026-11-08');
  assert.equal(spans.length, 13);
  for (const o of spans) {
    assert.ok(o.asset?.resolved, o.wonum);
    const entity = o.asset.entity;
    const ats = o.description.startsWith('GEN-1') ? id('ats:ATS-A') : o.description.startsWith('GEN-2') ? id('ats:ATS-B') : null;
    const inside = (e: AnyId) => entityHistory(site, orders, facility, e, window(o.actualStart!, o.actualFinish!)).timeline.filter((t) => t.kind === 'event').map(describe);
    if (ats) {
      assert.deepEqual(inside(entity).filter((d) => d.includes('Backup Power')), ['epms active Backup Power', 'epms normal Backup Power'], o.wonum);
      assert.deepEqual(inside(ats).filter((d) => /transfer to/i.test(d)), [`epms instant ${ats.slice(4)} Transfer to Emergency`, `epms instant ${ats.slice(4)} Retransfer to Normal`], o.wonum);
    } else {
      assert.deepEqual(inside(entity).filter((d) => d.includes('Bypass') && d.startsWith('epms')), ['epms active On Bypass', 'epms active On Maintenance Bypass', 'epms normal On Maintenance Bypass', 'epms normal On Bypass'], o.wonum);
    }
  }
});

test('a window clips trends and the timeline; the fall-back hour on 11/01 keeps both readings', () => {
  const h = entityHistory(site, orders, facility, id('ups:UPS-A'), window('2026-11-01T01:00', '2026-11-01T02:00'));
  const load = h.trends.find((s) => s.source === 'DFW1.UPS-A' && s.label === 'Active Power')!;
  assert.equal(load.samples.length, 8);
  assert.deepEqual([...new Set(load.samples.map((x) => x.at))], ['2026-11-01T01:00:00', '2026-11-01T01:15:00', '2026-11-01T01:30:00', '2026-11-01T01:45:00']);
  assert.equal(entityHistory(site, orders, facility, id('ups:UPS-A'), window('2026-06-01T00:00', '2026-06-02T00:00')).trends.length, 0);
});

test('rows the parsers cannot read are skipped with the reason', () => {
  const doc = (text: string) => sourceDocument({ path: 'x.csv', format: 'csv', text });
  const desigo = doc('Date/Time,Record Type,Event Message Text,Source Designation,Event Cause\n13/40/2026 10:00:00,Event,X,DFW1.CH-1.A,To Offnormal\n08/24/2026 10:00:00,Alarm,X,DFW1.CH-1.A,To Offnormal\n08/24/2026 10:00:00,Event,High,DFW1.CH-1.A,To Offnormal\n');
  const r1 = parseDocument(desigo)!;
  assert.deepEqual(r1.skipped.map((s) => s.where), ['line 2', 'line 3']);
  assert.deepEqual(r1.events.map((e) => [e.at, e.phase, e.text]), [['2026-08-24T10:00:00', 'active', 'High']]);
  const pme = doc('ID,Source,Timestamp,Timestamp UTC,Event,Condition,Measurement,Value,Type,Priority\n1,DFW1.UPS-A,8/24/2026 4:04:17.3 PM,,On Battery,,,,Pick up,192\n2,DFW1.UPS-A,8/24/2026 4:04:17 PM,,On Battery,,,,Picked,192\n3,DFW1.UPS-A,8/24/2026 4:04:17 PM,,On Battery,,,,Drop out,300\n');
  const r2 = parseDocument(pme)!;
  assert.deepEqual(r2.skipped.map((s) => s.where), ['line 3', 'line 4']);
  assert.deepEqual(r2.events.map((e) => [e.at, e.phase, e.category]), [['2026-08-24T16:04:17.300', 'active', 'High']]);
  const trend = doc('Date/Time,Source Designation,Source Description,Value,Unit,Quality\n08/24/2026 10:00:00,DFW1.CH-1.kW,CH-1 Power,n/a,kW,Good\n08/24/2026 10:15:00,DFW1.CH-1.kW,CH-1 Power,0.0,kW,Bad\n');
  const r3 = parseDocument(trend)!;
  assert.deepEqual(r3.skipped.map((s) => s.where), ['line 2']);
  assert.deepEqual(r3.trends[0]!.samples, [{ at: '2026-08-24T10:15:00', value: null }]);
});
