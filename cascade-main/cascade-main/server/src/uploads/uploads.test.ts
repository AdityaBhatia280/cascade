import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { findingEntities, type Analysis } from '@cascade/core';
import type { AuditDto, ServerEventDto, UploadBatchDto, UploadKind, WorkAssessmentDto } from '@cascade/core/contract';
import type { LlmClient, LlmRequest } from '../agent/llm.js';
import { apiRouter } from '../api.js';
import { bundle, dfw1, dfw1Truth, emptySite, human, logLines, testUploads, truthId } from '../testing.js';
import type { Workspace } from '../workspace.js';
import { modelReader } from './reader.js';
import type { UploadedFile } from './uploads.js';

const KIND_BY_NAME: readonly (readonly [RegExp, UploadKind])[] = [
  [/^equipment_register\.csv$/, 'equipment-register'],
  [/^bms_points\.json$/, 'bms-points'],
  [/^circuit_roster\.csv$/, 'circuit-roster'],
  [/^maximo_workorders\.csv$/, 'maximo-workorders'],
  [/^desigo_event_log_/, 'bms-event-log'],
  [/^desigo_trend_/, 'bms-trend'],
  [/^pme_event_history_/, 'pme-event-history'],
  [/^pme_data_export_/, 'pme-export'],
  [/-msa\.pdf$/, 'contract-msa'],
  [/-order-form\.pdf$/, 'contract-order-form'],
];
const expectedKind = (name: string) => KIND_BY_NAME.find(([re]) => re.test(name))?.[1];
const WEEK_OF = '2026-11-08T00:00';

async function serve(ws: Workspace, uploads = testUploads(ws)) {
  const server = express().use(express.json()).use('/api', apiRouter(ws, uploads, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const get = async <T>(p: string) => {
    const r = await fetch(`${base}${p}`);
    return { status: r.status, body: (await r.json()) as T };
  };
  const post = async <T>(p: string, body: unknown, key?: string) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  };
  const upload = async (files: readonly UploadedFile[]): Promise<UploadBatchDto> => {
    const form = new FormData();
    for (const f of files) form.append('files', new Blob([f.bytes]), f.name);
    const r = await fetch(`${base}/uploads`, { method: 'POST', body: form });
    assert.equal(r.status, 200);
    const started = (await r.json()) as UploadBatchDto;
    assert.ok(started.files.every((f) => f.status === 'queued'), 'the batch comes back queued');
    for (;;) {
      const b = await get<UploadBatchDto>(`/uploads/${started.batchId}`);
      if (b.body.done) return b.body;
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const close = async () => {
    server.closeAllConnections();
    server.close();
    await ws.close();
  };
  return { base, get, post, upload, close };
}

/** Planted defects found and decoys flagged, as the core accuracy test counts them. */
function accuracy(an: Analysis): { found: number; flagged: number } {
  const findings = an.audit().findings;
  const hits = (rule: string, subjects: readonly { kind: string; tag: string }[]) =>
    findings.some((x) => x.rule === rule && subjects.some((s) => findingEntities(x).includes(truthId(s) as never)));
  return {
    found: dfw1Truth.defects.filter((d) => hits(d.rule, d.subjects)).length,
    flagged: dfw1Truth.decoys.filter((d) => (d.looksLike === 'conflict' ? d.subjects.some((s) => an.facility.parseId(truthId(s)) === null) : hits(d.looksLike, d.subjects))).length,
  };
}

const auditKey = (a: AuditDto) => a.findings.map((f) => `${f.id} ${f.severity} ${f.title} ${f.revenueExposedUsd}`).sort();
const grades = (xs: WorkAssessmentDto[]) => xs.map((x) => `${x.workOrder.wonum} ${x.assessed ? x.grade : 'unassessed'}`);

test('without a model, every bundle file is classified by its parser and ingested, register first and work orders last', async () => {
  const { ws } = await emptySite();
  const uploads = testUploads(ws);
  const events: ServerEventDto[] = [];
  uploads.subscribe((e) => events.push(e));
  const files = bundle();
  const started = await uploads.start(files, human(), 'bundle-1');
  const done = await uploads.settled(started.batchId)!;
  assert.equal(done.files.length, 22);
  for (const f of done.files) {
    assert.equal(f.kind, expectedKind(f.name), f.name);
    assert.equal(f.status, 'ingested', `${f.name}: ${f.reason}`);
    assert.notEqual(f.detail, '', f.name);
  }
  assert.equal(done.files[0]!.kind, 'equipment-register');
  assert.equal(done.files.at(-1)!.kind, 'maximo-workorders');
  const byName = new Map(done.files.map((f) => [f.name, f]));
  assert.equal(byName.get('equipment_register.csv')!.detail, '68 assets');
  const halcyon = byName.get('C1156-halcyon-order-form.pdf')!;
  assert.deepEqual([halcyon.title, halcyon.detail, halcyon.customer], ['Contract · Halcyon Health Partners', '$7,850/mo · E01–E05 · A+B power', 'Halcyon Health Partners']);
  assert.equal(byName.get('C1156-halcyon-msa.pdf')!.detail, '99.999% availability · 10 business days notice');
  assert.equal(events.filter((e) => e.type === 'upload-file').length, 22 * 3, 'reading, classified, ingested for each file');
  assert.equal(events.at(-1)?.type, 'upload-done');
  assert.deepEqual(await uploads.start(files, human(), 'bundle-1'), done, 'a repeated key returns the first batch');
  await ws.close();
});

test('reset, then upload the bundle over HTTP: the same audit and week grades as a normal boot', async () => {
  const boot = await serve((await dfw1()).ws);
  const site = await dfw1();
  const s = await serve(site.ws);
  try {
    const bootAudit = (await boot.get<AuditDto>('/audit?view=documented')).body;
    const bootGrades = grades((await boot.get<WorkAssessmentDto[]>(`/work-orders/assessment?asOf=${WEEK_OF}`)).body);

    const reset = await s.post<{ revision: string }>('/site/reset', {}, 'reset-1');
    assert.equal(reset.status, 200);
    assert.deepEqual((await s.get('/site/status')).body, { empty: true, documents: 0, revision: reset.body.revision });
    assert.deepEqual((await s.post('/site/reset', {}, 'reset-1')).body, reset.body, 'a repeated Idempotency-Key replays the reset');
    assert.equal((await s.get<AuditDto>('/audit')).body.findings.length, 0);

    const done = await s.upload(bundle());
    assert.ok(done.files.every((f) => f.status === 'ingested'), done.files.filter((f) => f.status !== 'ingested').map((f) => `${f.name}: ${f.reason}`).join('; '));
    assert.deepEqual((await s.get<{ documents: number }>('/site/status')).body.documents, 22);

    const audit = (await s.get<AuditDto>('/audit?view=documented')).body;
    assert.deepEqual(auditKey(audit), auditKey(bootAudit));
    assert.deepEqual(grades((await s.get<WorkAssessmentDto[]>(`/work-orders/assessment?asOf=${WEEK_OF}`)).body), bootGrades);
    assert.equal(bootGrades.length, 5);
    const { found, flagged } = accuracy(site.ws.analysis('documented'));
    console.log(`upload bundle: ${audit.findings.length} findings, defects ${found}/${dfw1Truth.defects.length}, decoys flagged ${flagged}/${dfw1Truth.decoys.length}; week ${bootGrades.join(', ')}`);
    assert.deepEqual([found, flagged], [dfw1Truth.defects.length, 0]);
  } finally {
    await boot.close();
    await s.close();
  }
});

/** An OpenAI-compatible model stand-in that answers each tool by file name. */
function scriptedModel(answers: { kind: (name: string) => string; contract: (name: string) => Record<string, unknown> }): LlmClient {
  return {
    model: 'scripted',
    async complete(req: LlmRequest) {
      const tool = req.tools[0]!.name;
      const content = req.messages[0]!.role === 'user' ? req.messages[0]!.content : '';
      const name = /^File name: (.*)$/m.exec(content)![1]!;
      const args = tool === 'file_kind' ? { kind: answers.kind(name) } : answers.contract(name);
      return { text: null, toolCalls: [{ id: 'c1', name: tool, arguments: JSON.stringify(args) }], model: 'scripted', latencyMs: 0 };
    },
  };
}

test('with a model: a wrong contract value is dropped and the parser value stands; a wrong kind is overruled by the parser', async () => {
  const { ws, file } = await emptySite();
  const model = scriptedModel({
    kind: (name) => (name === 'circuit_roster.csv' ? 'bms-trend' : expectedKind(name)!),
    contract: (name) =>
      name === 'C1156-halcyon-order-form.pdf'
        ? { agreementNumber: 'DFW-MSA-1156', account: 'C1156', customerName: 'Halcyon Health Partners', monthlyFeeUsd: 7580, cabinets: ['E01', 'E02', 'E03', 'E04', 'E05'], powerRedundancy: 'A+B', coolingRedundancy: 'N+1' }
        : { customerName: 'Halcyon Health Partners', noticeBusinessDays: 10 },
  });
  const uploads = testUploads(ws, modelReader(model));
  const files = bundle().filter((f) => /^(equipment_register|circuit_roster)|C1156-halcyon/.test(f.name));
  const done = await uploads.settled((await uploads.start(files, human(), 'k')).batchId)!;
  const byName = new Map(done.files.map((f) => [f.name, f]));
  assert.equal(byName.get('circuit_roster.csv')!.kind, 'circuit-roster');
  assert.equal(byName.get('C1156-halcyon-order-form.pdf')!.detail, '$7,850/mo · E01–E05 · A+B power');
  const contract = ws.analysis('documented').facility.list('contract').find((c) => c.tag === 'DFW-MSA-1156')!;
  assert.deepEqual(contract.monthlyFeeUsd, { kind: 'known', ref: 'contract:DFW-MSA-1156#monthlyFeeUsd', value: 7850 });
  const logged = (await logLines(file)).map((l) => l.payload.event).find((e) => e.type === 'document-registered' && e.path === 'C1156-halcyon-order-form.pdf');
  assert.ok(logged?.type === 'document-registered' && logged.reading, 'the checked reading is logged with the document');
  assert.equal(logged.reading.monthlyFeeUsd, undefined, 'the wrong fee is not recorded');
  assert.equal(logged.reading.customerName, 'Halcyon Health Partners');
  await ws.close();
});

test('every read endpoint answers on an empty site and on each partial model while the bundle arrives', async () => {
  const { ws } = await emptySite();
  const s = await serve(ws);
  const all = bundle();
  const pick = (re: RegExp) => all.filter((f) => re.test(f.name));
  const steps = [pick(/^equipment_register/), pick(/^maximo/), pick(/^bms_points/), pick(/^circuit_roster/), pick(/\.pdf$/), pick(/^(desigo|pme)/)];
  const probe = async (stage: string) => {
    for (const p of ['/model', '/scene', '/audit', '/exposure', '/work-orders', `/work-orders/assessment?asOf=${WEEK_OF}`, `/handoff?at=${WEEK_OF}`, '/proposals', '/messages', '/site/status']) {
      assert.equal((await s.get(p)).status, 200, `${stage}: GET ${p}`);
    }
    assert.equal((await s.post('/plans', { clear: 'all-fixable', maxMoves: 4, alternatives: 1 })).status, 200, `${stage}: POST /plans`);
    const scene = (await s.get<{ nodes: { id: string }[] }>('/scene')).body;
    for (const n of scene.nodes.slice(0, 3)) {
      const id = encodeURIComponent(n.id);
      for (const p of [`/entities/${id}`, `/history?entity=${id}`, `/scenario?e=${encodeURIComponent(`fails:${n.id}@0`)}`]) assert.equal((await s.get(p)).status, 200, `${stage}: GET ${p}`);
    }
    const orders = (await s.get<{ wonum: string }[]>(`/work-orders?status=upcoming&asOf=${WEEK_OF}`)).body;
    for (const o of orders.slice(0, 2)) {
      for (const p of [`/work-orders/${o.wonum}/mop?asOf=${WEEK_OF}`, `/work-orders/${o.wonum}/notices?asOf=${WEEK_OF}`]) assert.ok((await s.get(p)).status < 500, `${stage}: GET ${p}`);
    }
  };
  try {
    await probe('empty');
    for (const files of steps) {
      await s.upload(files);
      await probe(`after ${files.map((f) => f.name).join(', ').slice(0, 60)}`);
    }
  } finally {
    await s.close();
  }
});
