import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { AuditDto, EntityDto, EntityHistoryDto, FixOutcomeDto, ModelSummaryDto, MopDto, ProposalDto, ReplanDto, ScenarioResultDto, SceneDto, WorkAssessmentDto, WorkOrderDto } from '@cascade/core/contract';
import { apiRouter } from './api.js';
import { dfw1 } from './testing.js';

/** Reads SSE frames until `done` says stop (or the stream ends). */
async function readSse(url: string, done: (events: { event: string; data: unknown }[]) => boolean, timeoutMs = 10_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal });
  const events: { event: string; data: unknown }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (!done(events)) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return events;
}

test('HTTP: model, scene, audit, scenario, plans → proposal → idempotent approval, SSE', async () => {
  const { ws } = await dfw1();
  const app = express().use(express.json()).use('/api', apiRouter(ws, null));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const get = async <T>(p: string) => {
    const r = await fetch(`${base}${p}`);
    return { status: r.status, body: (await r.json()) as T };
  };
  const post = async <T>(p: string, body: unknown, key?: string) => {
    const r = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cascade-user': 'smoke', ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as T };
  };

  try {
    const model = await get<ModelSummaryDto>('/model');
    assert.equal(model.status, 200);
    assert.equal(model.body.site, 'dfw1');
    assert.equal(model.body.counts.cabinet, 52);

    const scene = await get<SceneDto>('/scene?view=documented');
    assert.equal(scene.status, 200);
    assert.ok(scene.body.nodes.length > 0 && scene.body.links.length > 0);
    assert.equal((await get<{ error: string }>('/scene?view=nope')).status, 400);

    const audit = await get<AuditDto>('/audit');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.findings.some((f) => f.id === 'ab-convergence:pdu:PDU-3A'));

    const ups = scene.body.nodes.find((n) => n.kind === 'ups')!;
    const scenario = await get<ScenarioResultDto>(`/scenario?e=${encodeURIComponent(`fails:${ups.id}@0`)}&e=${encodeURIComponent(`fails:${ups.id}@5`)}`);
    assert.equal(scenario.status, 200);
    assert.ok(scenario.body.timeline.some((t) => t.entity === ups.id && t.state === 'down' && t.tMin === 0), `${ups.id} is not down at t=0`);
    assert.equal((await get<{ error: string }>('/scenario?e=fails:ups:NOPE@0')).status, 400);
    assert.equal((await get<{ error: string }>(`/entities/${encodeURIComponent('cabinet:NOPE')}`)).status, 404);
    const cord = await get<EntityDto>(`/entities/${encodeURIComponent('cord:D03/B')}`);
    assert.equal(cord.status, 200);
    assert.equal(cord.body.id, 'cord:D03/B');
    assert.equal(cord.body.facts.find((f) => f.field === 'circuit')?.display, 'RPP-3A/26', 'the BMS placement wins over the roster');

    const oldBase = await post<{ error: string }>('/proposals', { base: 'not-the-current-revision', ops: [{ op: 'add-cord', cabinet: 'cabinet:D06', side: 'B', circuit: 'circuit:RPP-3B/31' }], rationale: 'hand-written' });
    assert.equal(oldBase.status, 409, 'a hand edit made on another revision is refused');
    const worse = await post<{ error: string }>('/proposals', { base: model.body.revision, ops: [{ op: 'rehome-cord', cord: 'cord:E01/B', from: 'circuit:RPP-4B/1', to: 'circuit:RPP-4A/1' }], rationale: 'hand-written' });
    assert.equal(worse.status, 409, 'a hand edit that puts both cords on one circuit introduces a finding and is refused');
    assert.equal((await get<ProposalDto[]>('/proposals')).body.length, 0);

    const plans = await post<FixOutcomeDto>('/plans', { clear: ['single-corded:cabinet:D06'], maxMoves: 2, alternatives: 3 });
    assert.equal(plans.status, 200);
    assert.deepEqual(plans.body.unplanned, []);
    const plan = plans.body.plans[0]!;
    const submitted = await post<ProposalDto>('/proposals', { base: model.body.revision, ops: plan.ops, rationale: 'add the B cord' }, 'sub-1');
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.status, 'pending');

    const changed = readSse(`${base}/events`, (es) => es.some((e) => e.event === 'proposal-changed'));
    const approve1 = await post<ProposalDto>(`/proposals/${submitted.body.id}/decision`, { type: 'approve' }, 'approve-1');
    const approve2 = await post<ProposalDto>(`/proposals/${submitted.body.id}/decision`, { type: 'approve' }, 'approve-1');
    assert.equal(approve1.status, 200);
    assert.equal(approve1.body.status, 'applied');
    assert.deepEqual(approve2.body, approve1.body, 'same Idempotency-Key replays the same body');
    assert.equal(approve1.body.history.at(-1)?.by.kind, 'human');
    const sse = await changed;
    assert.ok(sse.some((e) => e.event === 'model-changed'));
    assert.ok(sse.some((e) => e.event === 'proposal-changed'));

    const rejectApplied = await post<{ error: string }>(`/proposals/${submitted.body.id}/decision`, { type: 'reject', reason: 'late' }, 'rej-1');
    assert.equal(rejectApplied.status, 409);
    assert.equal((await get<ProposalDto[]>('/proposals')).body.length, 1);

    const now = await get<{ revision: string }>('/model');
    const refeed = { op: 'refeed', device: 'rpp:RPP-4B', from: 'breaker:PDU-3A-SF-3', to: 'breaker:PDU-3B-SF-2' };
    const hand = await post<ProposalDto>('/proposals', { base: now.body.revision, ops: [refeed], rationale: 'edited on the floor' }, 'hand-1');
    assert.equal(hand.status, 200, 'a hand edit on the current revision that introduces nothing is accepted');
    assert.equal(hand.body.status, 'pending');
    assert.deepEqual(hand.body.plan.ops, [refeed]);
    assert.ok(hand.body.plan.cleared.includes('ab-convergence:pdu:PDU-3A'), 'the re-audit, not the caller, says what it clears');
  } finally {
    server.closeAllConnections();
    server.close();
    await ws.close();
  }
});

test("HTTP: the week's work orders come back in schedule order, each linked to an entity", async () => {
  const { ws } = await dfw1();
  const server = express().use('/api', apiRouter(ws, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const res = await fetch(`${base}/work-orders?status=upcoming&asOf=2026-11-08`);
    assert.equal(res.status, 200);
    const week = (await res.json()) as WorkOrderDto[];
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
    const all = (await (await fetch(`${base}/work-orders`)).json()) as WorkOrderDto[];
    assert.ok(all.length > week.length && all.some((o) => o.status === 'CAN'));
    assert.equal((await fetch(`${base}/work-orders?asOf=11/08/2026`)).status, 400);
    assert.equal((await fetch(`${base}/work-orders?status=done`)).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
    await ws.close();
  }
});

test("HTTP: this week's assessment is five work orders in schedule order with engine risk grades; PDU-3A explains the RPP-4B feed", async () => {
  const { ws } = await dfw1();
  const server = express().use('/api', apiRouter(ws, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const res = await fetch(`${base}/work-orders/assessment?asOf=2026-11-08`);
    assert.equal(res.status, 200);
    const week = (await res.json()) as WorkAssessmentDto[];
    assert.deepEqual(
      week.map((x) => [x.workOrder.wonum, x.workOrder.scheduledStart, x.assessed && x.grade]),
      [
        ['WO-26-1227', '2026-11-09T08:00', 'medium'],
        ['WO-26-1230', '2026-11-10T14:00', 'highest'],
        ['WO-26-1235', '2026-11-11T07:00', 'medium'],
        ['WO-26-1241', '2026-11-12T22:00', 'high'],
        ['WO-26-1242', '2026-11-13T09:00', 'high'],
      ],
    );
    const pdu = week[1]!;
    assert.ok(pdu.assessed);
    assert.deepEqual(pdu.scenario, ['fails:pdu:PDU-3A@0']);
    const stop = pdu.reasons[0]!;
    assert.deepEqual([stop.grade, stop.customers[0]!.customerName, stop.customers[0]!.before?.label, stop.customers[0]!.after?.label], ['highest', 'Halcyon Health Partners', 'A+B', 'none']);
    const c = stop.contradictions.find((x) => x.entity === 'rpp:RPP-4B')!;
    assert.deepEqual([c.labelledSide, c.tracedSide, c.fedFrom], ['B', 'A', 'breaker:PDU-3A-SF-3']);
    assert.ok(c.workOrders.some((o) => o.wonum === 'WO-23-0499' && o.status === 'CAN'));
    assert.equal(stop.customers[0]!.promise?.display, 'power A+B');
    assert.equal((await fetch(`${base}/work-orders/assessment?asOf=tuesday`)).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
    await ws.close();
  }
});

test("HTTP: CH-2's history on 2026-08-24 puts the BMS alarm, the feeder event and the work order on one timeline", async () => {
  const { ws } = await dfw1();
  const server = express().use('/api', apiRouter(ws, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const res = await fetch(`${base}/history?entity=chiller:CH-2&from=2026-08-24T16:00&to=2026-08-24T16:30`);
    assert.equal(res.status, 200);
    const h = (await res.json()) as EntityHistoryDto;
    const kinds = h.timeline.map((t) => (t.kind === 'event' ? `${t.event.system}:${t.event.phase}:${t.event.text}` : `wo:${t.workOrder.wonum}`));
    const order = ['bms:active:High Discharge Pressure', 'epms:active:Under Current', 'wo:WO-26-0971'].map((k) => kinds.indexOf(k));
    assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]!)), kinds.join(' | '));
    const pme = h.timeline.find((t) => t.kind === 'event' && t.event.system === 'epms')!;
    assert.equal(pme.entity, 'breaker:SWGR-B-CB-3');
    assert.ok(pme.kind === 'event' && pme.event.source === 'DFW1.SWGR-B-CB3');
    const kw = h.trends.find((s) => s.source === 'DFW1.Bldg1.CHW_Plant.CH-2.kW')!;
    assert.deepEqual(kw.samples.map((x) => x.at), ['2026-08-24T16:00:00', '2026-08-24T16:15:00']);
    assert.ok(kw.samples[1]!.value! < 1, 'CH-2 is off at 16:15');

    assert.equal((await fetch(`${base}/history`)).status, 400);
    assert.equal((await fetch(`${base}/history?entity=chiller:CH-9`)).status, 404);
    assert.equal((await fetch(`${base}/history?entity=chiller:CH-2&from=08/24/2026`)).status, 400);
    assert.equal((await fetch(`${base}/history?entity=chiller:CH-2&from=2026-08-25&to=2026-08-24`)).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
    await ws.close();
  }
});

test('HTTP: the PDU-3A MOP re-feeds RPP-4B first and flags the late Halcyon notice; the CH-2 replan counts down to 80.6 °F', async () => {
  const { ws } = await dfw1();
  const server = express().use('/api', apiRouter(ws, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const res = await fetch(`${base}/work-orders/WO-26-1230/mop?asOf=2026-11-08`);
    assert.equal(res.status, 200);
    const mop = (await res.json()) as MopDto;
    assert.deepEqual(mop.prerequisite?.ops.find((o) => o.op === 'refeed'), { op: 'refeed', device: 'rpp:RPP-4B', from: 'breaker:PDU-3A-SF-3', to: 'breaker:PDU-3B-SF-2' });
    const sf3 = mop.steps.find((s) => s.text.startsWith('Open PDU-3A-SF-3'))!;
    assert.deepEqual([sf3.phase, sf3.state, sf3.customers[0]?.cabinetsLabel, sf3.customers[0]?.before, sf3.customers[0]?.after], ['prerequisite', ['fails:breaker:PDU-3A-SF-3@0'], 'E01–E05', 'A+B', 'A']);
    const halcyon = mop.notifications.find((n) => n.customer === 'customer:C1156')!;
    assert.deepEqual([halcyon.deadline, halcyon.status], ['2026-10-26', 'deadline-passed']);
    assert.ok([mop.header, mop.approvals, mop.scope, mop.affected, mop.prechecks, mop.stopConditions, mop.verification].every((ls) => ls.length > 0 && ls.every((l) => l.trim() !== '')));

    const ch2 = (await (await fetch(`${base}/work-orders/WO-26-1235/mop?asOf=2026-11-08`)).json()) as MopDto;
    assert.ok(ch2.contingencies.some((c) => c.id === 'chiller:CH-1'));
    const rp = await fetch(`${base}/work-orders/WO-26-1235/replan?fault=chiller:CH-1&asOf=2026-11-08`);
    assert.equal(rp.status, 200);
    const r = (await rp.json()) as ReplanDto;
    assert.deepEqual(r.scenario, ['fails:chiller:CH-2@0', 'fails:chiller:CH-1@0']);
    const running = r.countdown!.phases.at(-1)!;
    assert.deepEqual([running.deficitKw, running.minutes], [30.7, 37.3]);
    const temp = r.parameters.find((x) => x.name === 'Starting cold-aisle temperature')!;
    assert.deepEqual([temp.value, temp.basis], ['71.7 °F', 'record']);

    assert.equal((await fetch(`${base}/work-orders/WO-26-1235/replan?fault=pdu:PDU-3A`)).status, 400);
    assert.equal((await fetch(`${base}/work-orders/WO-26-1235/replan`)).status, 400);
    assert.equal((await fetch(`${base}/work-orders/WO-99-0000/mop`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
    await ws.close();
  }
});
