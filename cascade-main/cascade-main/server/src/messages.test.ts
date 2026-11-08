import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import type { HandoffDto, MessageDto, NoticeSetDto } from '@cascade/core/contract';
import { apiRouter } from './api.js';
import { resendMailer, type Mailer } from './mail.js';
import { dfw1, logLines } from './testing.js';

const AS_OF = '2026-11-08T18:00';

async function serve(mailer?: (file: string) => Mailer) {
  const { ws, file } = await dfw1(mailer);
  const server = express().use(express.json()).use('/api', apiRouter(ws, null)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const get = async <T>(p: string) => (await fetch(`${base}${p}`)).json() as Promise<T>;
  const post = async <T>(p: string, body: unknown, key: string) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cascade-user': 'night-lead', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  };
  const notice = async (customer: string) => {
    const set = await get<NoticeSetDto>(`/work-orders/WO-26-1230/notices?asOf=${AS_OF}`);
    assert.ok(set.assessed);
    const n = set.notices.find((x) => x.customer === customer)!;
    return { n, send: { kind: 'customer-notice', wonum: 'WO-26-1230', customer, asOf: AS_OF, contentHash: n.contentHash } };
  };
  const close = async () => {
    server.close();
    await ws.close();
  };
  return { file, outbox: path.join(path.dirname(file), 'outbox'), get, post, notice, close };
}

const emls = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.eml'));

test('without an email key, approving a notice writes exactly one .eml, reports it not sent, and logs who approved it', async () => {
  const s = await serve();
  try {
    const { send } = await s.notice('customer:C1183');
    const first = await s.post<MessageDto>('/messages', send, 'click-1');
    assert.equal(first.status, 200);
    assert.equal(first.body.delivery.status, 'not-sent');
    assert.equal(first.body.delivery.status === 'not-sent' && first.body.delivery.reason, 'no email key');
    const files = await emls(s.outbox);
    assert.equal(files.length, 1);
    const eml = await readFile(path.join(s.outbox, files[0]!), 'utf8');
    assert.match(eml, /^Subject: DFW1 scheduled maintenance Tue 2026-11-10 14:00 \(WO-26-1230\): affects E06–E10\r$/m);
    assert.match(eml, /Intended recipient: Lone Star Genomics \(account C1183\)\./);
    assert.match(eml, /E06–E10: your A feed will be de-energized\. Your B feed remains\./);

    const again = await s.post<MessageDto>('/messages', send, 'click-2');
    assert.equal(again.body.id, first.body.id, 'the same words already in the outbox are not written twice');
    assert.equal((await emls(s.outbox)).length, 1);

    const logged = (await logLines(s.file)).filter((l) => l.payload.event.type === 'message-sent');
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0]!.payload.actor, { kind: 'human', name: 'night-lead' });
    assert.deepEqual((await s.get<MessageDto[]>('/messages')).map((m) => [m.ref, m.approvedBy]), [['WO-26-1230/C1183', { kind: 'human', name: 'night-lead' }]]);
  } finally {
    await s.close();
  }
});

test('with an email key, sending twice with the same Idempotency-Key calls Resend once, to the demo inbox only', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 're_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const s = await serve(() => resendMailer({ apiKey: 're_test_key', from: 'cascade@demo.test', to: 'demo-inbox@demo.test' }, stub));
  try {
    const { send } = await s.notice('customer:C1183');
    const a = await s.post<MessageDto>('/messages', send, 'click-1');
    const b = await s.post<MessageDto>('/messages', send, 'click-1');
    assert.equal(a.status, 200);
    assert.deepEqual(b.body, a.body);
    assert.equal(calls.length, 1);
    assert.deepEqual(a.body.delivery, { status: 'sent', via: 'resend', providerId: 're_123', deliveredTo: 'demo-inbox@demo.test' });
    const req = calls[0]!;
    assert.equal(req.url, 'https://api.resend.com/emails');
    assert.equal((req.init.headers as Record<string, string>)['authorization'], 'Bearer re_test_key');
    const payload = JSON.parse(req.init.body as string) as { from: string; to: string[]; subject: string; text: string };
    assert.deepEqual(payload.to, ['demo-inbox@demo.test']);
    assert.match(payload.text, /Intended recipient: Lone Star Genomics \(account C1183\)/);
    assert.equal(JSON.stringify(a.body).includes('re_test_key'), false, 'the key never reaches a response');

    await s.post<MessageDto>('/messages', send, 'click-2');
    assert.equal(calls.length, 1, 'a new click on words already sent does not send them again');
  } finally {
    await s.close();
  }
});

test("Halcyon's PDU-3A notice is refused with the RPP-4B reason, and nothing is written or sent", async () => {
  const s = await serve();
  try {
    const { n, send } = await s.notice('customer:C1156');
    assert.match(n.blocked!.reason, /RPP-4B/);
    const r = await s.post<{ error: string }>('/messages', send, 'click-1');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Re-feed RPP-4B from the B side before this work/);
    assert.deepEqual(await emls(s.outbox), []);
    assert.equal((await logLines(s.file)).some((l) => l.payload.event.type === 'message-sent'), false);
  } finally {
    await s.close();
  }
});

test('a send naming words other than the current ones is refused', async () => {
  const s = await serve();
  try {
    const { send } = await s.notice('customer:C1183');
    const r = await s.post<{ error: string }>('/messages', { ...send, contentHash: '0000000000000000' }, 'click-1');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /prepare it again/);
    assert.deepEqual(await emls(s.outbox), []);
  } finally {
    await s.close();
  }
});

test('GET /handoff serves the brief, and emailing it goes through the same gate', async () => {
  const s = await serve();
  try {
    const brief = await s.get<HandoffDto>('/handoff?at=2026-11-09T18:00');
    assert.ok(brief.work.some((w) => w.assessment.workOrder.wonum === 'WO-26-1230'));
    assert.deepEqual(brief.waiting.map((o) => o.wonum), ['WO-26-1056']);
    const sent = await s.post<MessageDto>('/messages', { kind: 'handoff-brief', at: brief.at, contentHash: brief.contentHash }, 'click-1');
    assert.equal(sent.status, 200);
    assert.equal(sent.body.ref, 'handoff/2026-11-09T18:00');
    assert.equal(sent.body.delivery.status, 'not-sent');
    const eml = await readFile(path.join(s.outbox, (await emls(s.outbox))[0]!), 'utf8');
    assert.match(eml, /WO-26-1056 PULL D06 B WHIP TO RPP-3B CB31 - TICKET 88213: waiting on materials/);
  } finally {
    await s.close();
  }
});
