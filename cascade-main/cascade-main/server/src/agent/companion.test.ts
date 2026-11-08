import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { CompanionAction, CompanionReply, MessageDto, ProposalDto } from '@cascade/core/contract';
import { apiRouter } from '../api.js';
import { dfw1 } from '../testing.js';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';
import { TOOLS } from './tools.js';

/** Sunday 2026-11-08 00:00 site time: the week holds the PDU-3A shutdown on Tuesday. */
const SUNDAY = () => new Date(2026, 10, 8, 0, 0);

async function serve(llm: LlmClient | null = null) {
  const { ws } = await dfw1();
  const server = express().use(express.json()).use('/api', apiRouter(ws, llm, { now: SUNDAY })).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const ask = async (text: string, opts: { key?: string; off?: string[]; selected?: string | null } = {}) => {
    const r = await fetch(`${base}/companion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.key ? { 'idempotency-key': opts.key } : {}) },
      body: JSON.stringify({ messages: [{ role: 'user', content: text }], context: { selected: opts.selected ?? null, off: opts.off ?? [] } }),
    });
    return { status: r.status, body: (await r.json()) as CompanionReply & { error?: string } };
  };
  const get = async <T>(p: string) => (await (await fetch(`${base}${p}`)).json()) as T;
  const close = async () => {
    server.closeAllConnections();
    server.close();
    await ws.close();
  };
  return { ask, get, base, close };
}

const has = (actions: readonly CompanionAction[], a: CompanionAction) => actions.some((x) => JSON.stringify(x) === JSON.stringify(a));
const highlighted = (actions: readonly CompanionAction[]) => actions.flatMap((a) => (a.kind === 'highlight' ? a.ids : []));

/** What the manager must never read: entity or rule ids ("ab-convergence:pdu:PDU-3A"), file names, markdown. */
function assertPlain(reply: string) {
  assert.doesNotMatch(reply, /\b[a-z][a-z-]*:[A-Za-z]/, `no internal ids: ${reply}`);
  assert.doesNotMatch(reply, /\.(csv|json|txt|eml)\b/i, `no file names: ${reply}`);
  assert.doesNotMatch(reply, /[*`#]/, `no markdown: ${reply}`);
  assert.ok(reply.length > 0 && reply.length <= 480, `short: ${reply.length} chars`);
}

test('no key: "is this week safe" names the riskiest job and switches its equipment off', async () => {
  const s = await serve();
  try {
    const r = await s.ask('Is this week safe?');
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /not safe/);
    assert.match(r.body.reply, /PDU-3A shut down on Tue 14:00/);
    assert.match(r.body.reply, /Halcyon Health Partners E01 to E05/);
    assert.ok(has(r.body.actions, { kind: 'switch-off', id: 'pdu:PDU-3A' }), JSON.stringify(r.body.actions));
    assert.ok(highlighted(r.body.actions).includes('cabinet:E01'), 'the cabinets that go dark are highlighted');
    assertPlain(r.body.reply);
  } finally {
    await s.close();
  }
});

test('no key: "fix PDU-3A" submits exactly one pending proposal, replays its key, and never approves', async () => {
  const s = await serve();
  try {
    const r = await s.ask('fix PDU-3A', { key: 'fix-1' });
    assert.equal(r.status, 200);
    const proposal = r.body.actions.find((a) => a.kind === 'proposal');
    assert.ok(proposal && proposal.kind === 'proposal', JSON.stringify(r.body.actions));
    assert.ok(has(r.body.actions, { kind: 'switch-off', id: 'pdu:PDU-3A' }));
    assert.ok(highlighted(r.body.actions).includes('rpp:RPP-4B'), 'the re-fed panel is highlighted');
    assert.match(r.body.reply, /feed RPP-4B from PDU-3B/);
    assert.match(r.body.reply, /PDU-3A can go off without any cabinet losing power/);
    assertPlain(r.body.reply);

    const proposals = await s.get<ProposalDto[]>('/proposals');
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.id, proposal.proposalId);
    assert.equal(proposals[0]!.status, 'pending', 'submitted for approval, not approved');
    assert.ok(proposals[0]!.plan.ops.some((o) => o.op === 'refeed' && o.device === 'rpp:RPP-4B'));

    const replay = await s.ask('fix PDU-3A', { key: 'fix-1' });
    assert.deepEqual(replay.body, r.body, 'the same Idempotency-Key replays the same reply');
    const again = await s.ask('fix PDU-3A', { key: 'fix-2' });
    assert.ok(has(again.body.actions, proposal), 'asking again returns the pending proposal');
    assert.equal((await s.get<ProposalDto[]>('/proposals')).length, 1, 'still exactly one proposal');

    const reused = await s.ask('what if UPS-A fails', { key: 'fix-1' });
    assert.equal(reused.status, 409, 'a key reused for a different request is refused');
  } finally {
    await s.close();
  }
});

test('no key: "what if PDU-3A fails" switches it off and says who loses power', async () => {
  const s = await serve();
  try {
    const r = await s.ask('what if PDU-3A fails?');
    assert.ok(has(r.body.actions, { kind: 'switch-off', id: 'pdu:PDU-3A' }));
    assert.match(r.body.reply, /Halcyon Health Partners E01 to E05/);
    assert.match(r.body.reply, /lose power/);
    assertPlain(r.body.reply);

    const both = await s.ask('what if UPS-B fails too', { off: ['pdu:PDU-3A'] });
    assert.ok(has(both.body.actions, { kind: 'switch-off', id: 'ups:UPS-B' }));
    assert.match(both.body.reply, /PDU-3A and UPS-B off/, 'the view\'s switched-off equipment stays off in the simulation');
  } finally {
    await s.close();
  }
});

test('no key: "draft notice for Halcyon" names who is affected and sends nothing', async () => {
  const s = await serve();
  try {
    const r = await s.ask('draft a notice for Halcyon');
    assert.match(r.body.reply, /Halcyon Health Partners/);
    assert.match(r.body.reply, /WO-26-1230/);
    assert.ok(highlighted(r.body.actions).includes('cabinet:E01'));
    assertPlain(r.body.reply);

    const job = await s.ask('draft notices for WO-26-1230');
    for (const name of ['Halcyon Health Partners', 'Trinity Logistics Group', 'Lone Star Genomics']) assert.match(job.body.reply, new RegExp(name));
    assertPlain(job.body.reply);
    assert.deepEqual(await s.get<MessageDto[]>('/messages'), [], 'drafting sends nothing');
  } finally {
    await s.close();
  }
});

test('no key: anything else gets a short helpful answer; bad bodies are refused', async () => {
  const s = await serve();
  try {
    const r = await s.ask('hello');
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /this week/);
    assert.deepEqual(r.body.actions, []);
    for (const q of ['give me the shift handoff', 'run the audit']) assertPlain((await s.ask(q)).body.reply);

    const post = (body: unknown) => fetch(`${s.base}/companion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ messages: [] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'assistant', content: 'hi' }] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }], context: { selected: 'pdu:NOPE', off: [] } })).status, 400);
  } finally {
    await s.close();
  }
});

test('the model has no tool to approve, reject, complete or send', () => {
  for (const name of Object.keys(TOOLS)) assert.doesNotMatch(name, /approve|reject|complete|decide|send/);
});

/** A scripted model: each step sees the request and returns the next reply. */
function scripted(steps: ((req: LlmRequest) => Partial<LlmResponse>)[]): LlmClient & { readonly requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    model: 'fake-model',
    requests,
    async complete(req) {
      requests.push(req);
      const step = steps[requests.length - 1];
      if (!step) throw new Error('script exhausted');
      return { text: null, toolCalls: [], model: 'fake-model', latencyMs: 1, ...step(req) };
    },
  };
}

test('with a model: the model picks tools, the tools set the actions, and the reply is kept plain', async () => {
  const llm = scripted([
    () => ({ toolCalls: [{ id: 'c1', name: 'submit_fix', arguments: '{"equipment":"PDU-3A"}' }] }),
    (req) => {
      const last = req.messages.at(-1)!;
      assert.ok(last.role === 'tool' && !/[a-z]+:[A-Z]/.test(last.content), `tool results carry tags, not ids: ${last.role === 'tool' ? last.content : ''}`);
      return { text: 'Queued the **fix** for rpp:RPP-4B; see circuit_roster.csv.' };
    },
  ]);
  const s = await serve(llm);
  try {
    const r = await s.ask('make PDU-3A safe to work on');
    assert.equal(r.body.reply, 'Queued the fix for RPP-4B; see the site records.');
    assert.ok(r.body.actions.some((a) => a.kind === 'proposal'));
    const [p] = await s.get<ProposalDto[]>('/proposals');
    assert.ok(p && p.status === 'pending' && p.submittedBy.kind === 'agent');
  } finally {
    await s.close();
  }
});

test('with a model that fails, the intent table answers instead', async () => {
  const s = await serve(scripted([]));
  try {
    const r = await s.ask('Is this week safe?');
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /not safe/);
    assert.ok(has(r.body.actions, { kind: 'switch-off', id: 'pdu:PDU-3A' }));
  } finally {
    await s.close();
  }
});
