import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { HumanActor } from './actors.js';
import type { ProposalId } from './proposals.js';
import { D06, DFW1_SITE_DIR, dfw1, human, logLines, openAt, planFor, tempLogPath } from './testing.js';

test('first boot from an empty log registers every DFW1 document and the audit finds defects', async () => {
  const file = await tempLogPath();
  const ws = await openAt(file);
  const lines = await logLines(file);
  const docsOnDisk = (await readdir(path.join(DFW1_SITE_DIR, 'docs'), { recursive: true })).filter((f) => /\.(csv|json|txt)$/.test(f));
  assert.equal(lines.length, docsOnDisk.length);
  assert.ok(lines.every((l) => l.payload.event.type === 'document-registered'));
  assert.ok(!lines.some((l) => l.payload.event.type === 'document-registered' && l.payload.event.path.includes('ground_truth')), 'ground truth is never loaded');
  const an = ws.analysis();
  assert.ok(an.audit().findings.length > 0);
  assert.ok(an.facility.list('cabinet').length > 0);
  assert.deepEqual(ws.issues(), []);
  const revision = ws.revision();
  await ws.close();

  const again = await openAt(file);
  assert.equal((await logLines(file)).length, lines.length, 'a second boot registers nothing new');
  assert.equal(again.revision(), revision, 're-folding the log reproduces the same model');
  await again.close();
});

test('approve is idempotent: same key replays, a repeat approve is a noop, the patch applies once', async () => {
  const { ws, file } = await dfw1();
  const sub = await ws.submit(planFor(ws, D06), 'add the missing B cord', { kind: 'playbook', name: 'test' }, 'k-submit');
  assert.ok(sub.ok);
  const before = ws.revision();

  const first = await ws.decide(sub.value.id, { type: 'approve' }, human(), 'k-approve');
  assert.ok(first.ok && first.value.state.status === 'applied');
  const afterApprove = ws.revision();
  assert.notEqual(afterApprove, before);
  assert.ok(!ws.analysis().audit().findings.some((x) => x.id === D06[0]), 'planned model no longer has the finding');
  const linesAfterApprove = (await logLines(file)).length;

  const replay = await ws.decide(sub.value.id, { type: 'approve' }, human(), 'k-approve');
  assert.deepEqual(replay, first);
  const repeat = await ws.decide(sub.value.id, { type: 'approve' }, human(), 'k-approve-again');
  assert.ok(repeat.ok && repeat.value.state.status === 'applied');
  assert.equal((await logLines(file)).length, linesAfterApprove, 'neither repeat appended to the log');
  assert.equal(ws.revision(), afterApprove);
  assert.equal((await logLines(file)).filter((l) => l.payload.event.type === 'proposal-applied').length, 1);

  const resubmit = await ws.submit(sub.value.plan, 'same ops again', { kind: 'playbook', name: 'test' }, 'k-other');
  assert.ok(resubmit.ok && resubmit.value.id === sub.value.id, 'resubmitting the ops of an applied proposal returns it');

  const reused = await ws.decide(sub.value.id, { type: 'reject', reason: 'no' }, human(), 'k-approve');
  assert.ok(!reused.ok && reused.code === 'idempotency-key-reused');
  await ws.close();
});

test('approve re-verifies against the planned model and marks the proposal stale when the base changed', async () => {
  const { ws } = await dfw1();
  const actor = { kind: 'playbook', name: 'test' } as const;
  const small = await ws.submit(planFor(ws, D06), 'D06 only', actor, 'k1');
  const big = await ws.submit(planFor(ws, 'all-fixable'), 'everything', actor, 'k2');
  assert.ok(small.ok && big.ok);
  assert.ok((await ws.decide(small.value.id, { type: 'approve' }, human(), 'k3')).ok);

  const r = await ws.decide(big.value.id, { type: 'approve' }, human(), 'k4');
  assert.ok(!r.ok && r.code === 'stale', 'the second plan also adds cord D06/B, which now exists');
  assert.equal(ws.proposal(big.value.id)?.state.status, 'stale');
  const again = await ws.decide(big.value.id, { type: 'approve' }, human(), 'k5');
  assert.ok(!again.ok && again.code === 'not-pending');
  await ws.close();
});

test('reject and complete follow the gate table; complete moves the change into the documented model', async () => {
  const { ws } = await dfw1();
  const actor = { kind: 'playbook', name: 'test' } as const;
  const a = await ws.submit(planFor(ws, D06), 'D06', actor, 'a');
  assert.ok(a.ok);
  const id = a.value.id;
  const early = await ws.decide(id, { type: 'complete' }, human(), 'c0');
  assert.ok(!early.ok && early.code === 'not-applied');

  const rej = await ws.decide(id, { type: 'reject', reason: 'needs a shutdown window' }, human(), 'r1');
  assert.ok(rej.ok && rej.value.state.status === 'rejected');
  assert.ok((await ws.decide(id, { type: 'reject', reason: 'again' }, human(), 'r2')).ok, 'reject on rejected is a noop');
  const approveRejected = await ws.decide(id, { type: 'approve' }, human(), 'r3');
  assert.ok(!approveRejected.ok && approveRejected.code === 'not-pending');

  const b = await ws.submit(planFor(ws, D06), 'D06 again', actor, 'b');
  assert.ok(b.ok && b.value.id !== id, 'a rejected plan can be resubmitted as a new proposal');
  const documentedBefore = ws.analysis('documented').facility.revision;
  assert.ok((await ws.decide(b.value.id, { type: 'approve' }, human(), 'b1')).ok);
  assert.equal(ws.analysis('documented').facility.revision, documentedBefore, 'approval changes only the planned model');
  const done = await ws.decide(b.value.id, { type: 'complete' }, human('field-tech'), 'b2');
  assert.ok(done.ok && done.value.state.status === 'completed');
  assert.deepEqual(done.value.history.map((h) => h.status), ['pending', 'applied', 'completed']);
  const documented = ws.analysis('documented');
  assert.notEqual(documented.facility.revision, documentedBefore);
  assert.ok(!documented.audit().findings.some((x) => x.id === D06[0]), 'as-built: the documented model has the new cord');
  assert.ok((await ws.decide(b.value.id, { type: 'complete' }, human(), 'b3')).ok, 'complete on completed is a noop');
  await ws.close();
});

test('human-only commands refuse an actor that humanFrom did not mint', async () => {
  const { ws } = await dfw1();
  const sub = await ws.submit(planFor(ws, D06), 'x', { kind: 'playbook', name: 'test' }, 's');
  assert.ok(sub.ok);
  const forged = { kind: 'human', name: 'agent pretending' } as HumanActor;
  const r = await ws.decide(sub.value.id, { type: 'approve' }, forged, 'f1');
  assert.ok(!r.ok && r.code === 'forbidden');
  // @ts-expect-error a plain object is not a HumanActor: only humanFrom(req) mints one
  void (() => ws.decide(sub.value.id as ProposalId, { type: 'approve' }, { kind: 'human', name: 'x' }, 'f2'));
  assert.equal(ws.proposal(sub.value.id)?.state.status, 'pending');
  await ws.close();
});

test('a torn final log line is dropped and the workspace keeps working', async () => {
  const { ws, file } = await dfw1();
  const revision = ws.revision();
  const count = (await logLines(file)).length;
  await ws.close();
  await appendFile(file, '{"seq":999,"at":"2026-01-01T00:00:00Z","payload":{"actor":');

  const reopened = await openAt(file);
  assert.equal(reopened.revision(), revision);
  const sub = await reopened.submit(planFor(reopened, D06), 'after crash', { kind: 'playbook', name: 'test' }, 'after');
  assert.ok(sub.ok);
  const lines = await logLines(file);
  assert.equal(lines.length, count + 1);
  assert.equal(lines.at(-1)?.seq, count + 1);
  await reopened.close();
});

test('a malformed line before the end fails boot instead of being skipped', async () => {
  const { ws, file } = await dfw1();
  await ws.close();
  await appendFile(file, 'not json\n{"seq":1,"at":"x","payload":{}}\n');
  await assert.rejects(openAt(file), /malformed event log/);
});
