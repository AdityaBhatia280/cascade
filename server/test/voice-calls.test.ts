import './env.js';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { store } from '../src/db/store.js';
import { config } from '../src/config.js';
import type { Action, Incident } from '../src/db/schema.js';
import { seedPortfolio } from '../src/services/portfolio.js';
import { createAction, getRetellCallStatus, handleRetellWebhook, syncLatestRetellCalls } from '../src/services/actions.js';
import { streamAgent } from '../src/services/agent.js';
import type { Request, Response } from 'express';

type Line = { role: 'agent' | 'user'; content: string };
type FakeCall = {
  call_id: string;
  call_status: string;
  transcript_object: Line[];
  retell_llm_dynamic_variables?: Record<string, string>;
};

const dbPath = process.env['CASCADE_DB_PATH']!;
const realFetch = globalThis.fetch;
let retellCalls: FakeCall[] = [];
let resendSubjects: string[] = [];

const GREETING: Line = {
  role: 'agent',
  content:
    'Hello, this is Cascade AI for Cascade Tower. Active status for INC-1001: UPS Panel B power feed loss — Chiller 1 & CRAH-4 offline. Are you calling to review and approve pending mitigations, or to report a new facility incident?',
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  fs.rmSync(dbPath, { force: true });
  await seedPortfolio();
  retellCalls = [];
  resendSubjects = [];
  config.resend.apiKey = 'test-resend-key';
  config.resend.demoInbox = 'ops@example.com';
  config.retell.apiKey = 'test-retell-key';
  config.retell.agentId = 'agent_test';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      resendSubjects.push((JSON.parse(String(init?.body)) as { subject: string }).subject);
      return json({ id: 're_test_message' });
    }
    if (url.startsWith('https://api.retellai.com/v2/get-call/')) {
      const id = decodeURIComponent(url.split('/').pop()!);
      return json(retellCalls.find((c) => c.call_id === id));
    }
    if (url === 'https://api.retellai.com/v3/list-calls') return json({ items: retellCalls.map(({ transcript_object: _t, transcript: _s, ...summary }) => summary), has_more: false });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

function call(id: string, lines: Line[], status = 'ended', vars?: Record<string, string>): FakeCall {
  const c: FakeCall = { call_id: id, call_status: status, transcript_object: lines, retell_llm_dynamic_variables: vars };
  retellCalls = [...retellCalls.filter((x) => x.call_id !== id), c];
  return c;
}

const voiceIncidents = () => store.incidents.filter((i) => i.title.startsWith('[Voice Intake]'));
const voiceWorkOrders = () => store.actions.filter((a) => a.run_id.startsWith('VOICE-'));
const sentFor = (a: Action) => resendSubjects.filter((s) => s.includes(a.id)).length;

test('a reported fault opens one incident and work order, emails it and fails the unit in the graph', async () => {
  const c = call('call_report_ch2', [
    GREETING,
    { role: 'user', content: 'Chiller 2 is down. It tripped about five minutes ago.' },
    { role: 'agent', content: 'Understood. Chiller 2 fault reported. I am opening a new incident ticket and work order.' },
  ]);
  await handleRetellWebhook({ event: 'call_ended', call: c });

  const [inc, ...moreIncidents] = voiceIncidents();
  const [wo, ...moreWorkOrders] = voiceWorkOrders();
  assert.equal(moreIncidents.length, 0);
  assert.equal(moreWorkOrders.length, 0);
  assert.equal(inc!.root_node, 'CH-2');
  assert.equal(wo!.tool, 'create_work_order');
  assert.match(wo!.content, new RegExp(inc!.id));
  assert.equal(wo!.status, 'pending', 'a report without approval is not executed');
  assert.equal(sentFor(wo!), 1, 'work order emailed once');
  assert.ok(store.injectedFaults.has('CH-2'));
  assert.equal(store.getNode('CH-2')!.status, 'failed');
  assert.deepEqual(store.voiceCalls.get(c.call_id)!.ticket, { incident_id: inc!.id, action_id: wo!.id, node_id: 'CH-2' });
});

test('the same ended call seen by poll, sync loop, webhook and after a restart yields one ticket', async () => {
  const c = call('call_dupe', [GREETING, { role: 'user', content: 'Reporting a fault: the CRAH unit is overheating.' }]);

  await Promise.all([
    getRetellCallStatus(c.call_id),
    syncLatestRetellCalls(),
    handleRetellWebhook({ event: 'call_ended', call: c }),
  ]);
  await handleRetellWebhook({ event: 'call_analyzed', call: c });
  await getRetellCallStatus(c.call_id);

  store.voiceCalls.clear();
  store.loadFromDisk();
  await syncLatestRetellCalls();
  await handleRetellWebhook({ event: 'call_analyzed', call: c });

  assert.equal(voiceIncidents().length, 1);
  assert.equal(voiceWorkOrders().length, 1);
  assert.equal(voiceIncidents()[0]!.root_node, 'CRAH-4');
  assert.equal(sentFor(voiceWorkOrders()[0]!), 1);
});

test('approving on a report call executes only that call\'s work order', async () => {
  const unrelated = createAction({ run_id: 'manual', tool: 'send_email', recipient_display: 'tenant@acme.example', content: 'Unrelated notice' });
  const c = call('call_report_approve', [
    GREETING,
    { role: 'user', content: 'Yeah, UPS b just tripped.' },
    { role: 'agent', content: 'UPS-B fault reported. I am opening a new incident ticket. Shall I dispatch the work order now?' },
    { role: 'user', content: 'Yes.' },
  ]);
  await handleRetellWebhook({ event: 'call_ended', call: c });

  const wo = voiceWorkOrders()[0]!;
  assert.equal(voiceIncidents()[0]!.root_node, 'UPS-B', 'unit comes from the caller, not the greeting');
  assert.equal(wo.status, 'executed');
  assert.equal(sentFor(wo), 1, 'approved work order emailed once, not forwarded and then dispatched');
  assert.equal(store.getAction(unrelated.id)!.status, 'pending');
  assert.deepEqual(store.voiceCalls.get(c.call_id)!.approved_action_ids, [wo.id]);
});

test('approving on a briefing call executes only the briefed incident\'s pending actions', async () => {
  const briefed: Incident = { id: 'INC-1050', title: 'Briefed', root_node: 'UPS-B', status: 'open', opened_at: new Date().toISOString(), simulation_id: null, agent_run_id: 'RUN-briefed' };
  const other: Incident = { ...briefed, id: 'INC-1051', title: 'Other', agent_run_id: 'RUN-other' };
  store.addIncident(briefed);
  store.addIncident(other);
  const mine = createAction({ run_id: 'RUN-briefed', tool: 'send_email', recipient_display: 'acme@example.com', content: 'SLA notice' });
  const theirs = createAction({ run_id: 'RUN-other', tool: 'send_email', recipient_display: 'acme@example.com', content: 'Other notice' });
  const manual = createAction({ run_id: 'manual', tool: 'create_work_order', recipient_display: 'ops@example.com', content: 'Manual work order' });

  const c = call(
    'call_briefing',
    [
      { role: 'agent', content: 'Incident INC-1050 has one pending action. Would you like me to approve and dispatch it now?' },
      { role: 'agent', content: 'Agent said approve, go ahead, confirm.' },
      { role: 'user', content: 'Go ahead and approve it.' },
    ],
    'ended',
    { incident_id: briefed.id },
  );
  await getRetellCallStatus(c.call_id);

  assert.equal(store.getAction(mine.id)!.status, 'executed');
  assert.equal(store.getAction(theirs.id)!.status, 'pending');
  assert.equal(store.getAction(manual.id)!.status, 'pending');
  assert.equal(voiceIncidents().length, 0, 'an approval is not a fault report');
});

test('the agent saying "approve" does not count as the caller approving', async () => {
  const pending = createAction({ run_id: 'manual', tool: 'send_email', recipient_display: 'acme@example.com', content: 'Notice' });
  const c = call('call_agent_only', [
    { role: 'agent', content: 'I can approve and execute the pending actions. Confirm?' },
    { role: 'user', content: "Don't approve anything yet, I'll call back." },
  ]);
  await handleRetellWebhook({ event: 'call_ended', call: c });
  assert.equal(store.getAction(pending.id)!.status, 'pending');
  assert.deepEqual(store.voiceCalls.get(c.call_id)!.approved_action_ids, []);
});

test('a report that names no unit opens an unidentified ticket and injects nothing', async () => {
  const c = call('call_no_unit', [
    GREETING,
    { role: 'user', content: "You're to report a new facility incident. There's a loud grinding noise in the basement." },
  ]);
  await handleRetellWebhook({ event: 'call_ended', call: c });

  const inc = voiceIncidents()[0]!;
  const wo = voiceWorkOrders()[0]!;
  assert.equal(voiceIncidents().length, 1);
  assert.equal(inc.root_node, 'unidentified');
  assert.match(inc.title, /unit unidentified/);
  assert.match(wo.content, /unit unidentified/);
  assert.match(wo.content, /no fault was injected/);
  assert.equal(store.injectedFaults.size, 0);
  assert.equal(store.getNode('UPS-B')!.status, 'healthy', 'no silent UPS-B fallback');
  assert.equal(store.getNode('CH-1')!.status, 'healthy', 'greeting units are ignored');
  assert.equal(sentFor(wo), 1);
  assert.equal(store.voiceCalls.get(c.call_id)!.ticket!.node_id, null);
});

test('a question about problems is not a report', async () => {
  const c = call('call_question', [GREETING, { role: 'user', content: 'Is there a problem with chiller 1?' }]);
  await handleRetellWebhook({ event: 'call_ended', call: c });
  assert.equal(voiceIncidents().length, 0);
  assert.equal(store.voiceCalls.get(c.call_id)!.ticket, null);
});

test('nothing happens before the call ends', async () => {
  const pending = createAction({ run_id: 'manual', tool: 'send_email', recipient_display: 'acme@example.com', content: 'Notice' });
  const lines: Line[] = [
    GREETING,
    { role: 'user', content: 'Chiller 3 failed. Approve and dispatch.' },
  ];
  const c = call('call_live', lines, 'ongoing');

  await handleRetellWebhook({ event: 'call_started', call: c });
  const polled = await getRetellCallStatus(c.call_id);
  await syncLatestRetellCalls();

  assert.equal(polled.transcript.length, 2, 'live transcript still flows');
  assert.equal(polled.outcome, null);
  assert.equal(voiceIncidents().length, 0);
  assert.equal(store.getAction(pending.id)!.status, 'pending');
  assert.equal(resendSubjects.length, 0);
  assert.equal(store.injectedFaults.size, 0);

  call('call_live', lines, 'ended');
  const ended = await getRetellCallStatus(c.call_id);
  assert.equal(ended.outcome!.ticket!.node_id, 'CH-3');
});

test('ids continue past persisted records and unrelated open incidents stay open', async () => {
  const opened = new Date().toISOString();
  fs.writeFileSync(
    dbPath,
    JSON.stringify({
      incidents: [
        { id: 'INC-1001', title: 'Old UPS-B', root_node: 'UPS-B', status: 'mitigating', opened_at: opened, simulation_id: null, agent_run_id: 'RUN-old' },
        { id: 'INC-1003', title: 'Old CH-2', root_node: 'CH-2', status: 'open', opened_at: opened, simulation_id: null, agent_run_id: null },
        { id: 'INC-1004', title: 'Old SW-03', root_node: 'SW-03', status: 'open', opened_at: opened, simulation_id: null, agent_run_id: null },
      ],
      actions: [
        { id: 'ACT-2001', run_id: 'RUN-old', tool: 'create_work_order', recipient_display: 'ops@example.com', content: 'Old', usd_impact: 0, risk: 'normal', requires_approval: true, status: 'executed', decided_by: 'Demo operator', decided_at: opened, result: 'done' },
      ],
    }),
  );
  store.loadFromDisk();

  const c = call('call_after_restart', [GREETING, { role: 'user', content: 'UPS b is down.' }]);
  await handleRetellWebhook({ event: 'call_ended', call: c });

  const ticket = store.voiceCalls.get(c.call_id)!.ticket!;
  assert.equal(ticket.incident_id, 'INC-1005');
  assert.equal(ticket.action_id, 'ACT-2002');
  assert.equal(store.getAction('ACT-2001')!.result, 'done', 'old work order untouched');
  assert.equal(sentFor(store.getAction('ACT-2002')!), 1, 'new work order emailed');
  for (const id of ['INC-1001', 'INC-1003', 'INC-1004']) {
    assert.notEqual(store.getIncident(id)!.status, 'resolved', `${id} stays open`);
  }
});

test('"UPS panel B is down and needs a ticket" fails UPS-B and its cascade', async () => {
  const c = call('call_ups_panel_b', [
    GREETING,
    { role: 'user', content: 'UPS panel B is down and needs a ticket.' },
    { role: 'agent', content: 'Confirmed, UPS Panel B fault reported. That trips Chiller 1 and CRAH-4. I am opening a new incident ticket and work order now.' },
  ]);
  await handleRetellWebhook({ event: 'call_ended', call: c });

  assert.equal(voiceIncidents()[0]!.root_node, 'UPS-B');
  assert.deepEqual([...store.injectedFaults], ['UPS-B']);
  assert.equal(store.getNode('UPS-B')!.status, 'failed');
  assert.equal(store.getNode('CH-1')!.status, 'failed', 'cascade reaches Chiller 1');
  assert.equal(store.getNode('CRAH-4')!.status, 'failed', 'cascade reaches CRAH-4');
});

test('every observed call is streamed over SSE, including calls the page did not start', async () => {
  const events: Array<{ event: string; data: { call_id?: string; call_status?: string; outcome?: unknown } }> = [];
  const res = {
    writeHead: () => res,
    write: (chunk: string) => {
      const m = chunk.match(/^event: (\S+)\ndata: (.*)\n\n$/s);
      if (m) events.push({ event: m[1]!, data: JSON.parse(m[2]!) });
      return true;
    },
  } as unknown as Response;
  let close = () => {};
  streamAgent({ on: (_: string, fn: () => void) => { close = fn; } } as unknown as Request, res);

  const lines: Line[] = [GREETING, { role: 'user', content: 'Chiller 3 is leaking.' }];
  call('call_external', lines, 'ongoing');
  await syncLatestRetellCalls();
  await syncLatestRetellCalls();
  call('call_external', lines, 'ended');
  await syncLatestRetellCalls();
  close();

  const voice = events.filter((e) => e.event === 'voice_call' && e.data.call_id === 'call_external');
  assert.deepEqual(voice.map((e) => e.data.call_status), ['ongoing', 'ended'], 'one event per change');
  assert.equal(voice[0]!.data.outcome, null);
  assert.ok(voice[1]!.data.outcome, 'ended call carries its outcome');
  assert.ok(events.some((e) => e.event === 'voice_call_outcome'));
});
