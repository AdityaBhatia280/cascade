import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FixPlan, PatchVerification } from '@cascade/core';
import { applyEvent, gate, type Proposal, type ProposalCommand, type ProposalId, type ProposalState } from './proposals.js';

const by = { kind: 'human', name: 'op' } as const;
const at = '2026-11-07T00:00:00.000Z';
const states: Record<ProposalState['status'], ProposalState> = {
  pending: { status: 'pending' },
  applied: { status: 'applied', by, at },
  rejected: { status: 'rejected', by, at, reason: 'r' },
  stale: { status: 'stale', at, reason: 's' },
  completed: { status: 'completed', by, at },
};
const proposal = (state: ProposalState): Proposal => ({
  id: 'P-1' as ProposalId,
  plan: {} as FixPlan,
  rationale: '',
  submittedBy: by,
  submittedAt: at,
  state,
  history: [],
});
const commands: ProposalCommand[] = [{ type: 'approve' }, { type: 'reject', reason: 'no' }, { type: 'complete' }];
const verified: PatchVerification = { ok: true, conflicts: [], delta: { cleared: [], introduced: [], persisted: [] }, after: null };

const expected: Record<ProposalState['status'], Record<ProposalCommand['type'], string>> = {
  pending: { approve: 'append:proposal-applied', reject: 'append:proposal-rejected', complete: 'refuse:not-applied' },
  applied: { approve: 'noop', reject: 'refuse:not-pending', complete: 'append:proposal-completed' },
  rejected: { approve: 'refuse:not-pending', reject: 'noop', complete: 'refuse:not-pending' },
  stale: { approve: 'refuse:not-pending', reject: 'refuse:not-pending', complete: 'refuse:not-pending' },
  completed: { approve: 'refuse:not-pending', reject: 'refuse:not-pending', complete: 'noop' },
};

test('the gate table: every (state, command) pair', () => {
  for (const [status, state] of Object.entries(states) as [ProposalState['status'], ProposalState][]) {
    for (const cmd of commands) {
      const r = gate(proposal(state), cmd, () => verified);
      const got = r.kind === 'noop' ? 'noop' : r.kind === 'refuse' ? `refuse:${r.refuse.code}` : `append:${r.event.type}`;
      assert.equal(got, expected[status][cmd.type], `${status} + ${cmd.type}`);
    }
  }
});

test('approve re-verifies only on pending, and a failed re-verify marks the proposal stale', () => {
  let calls = 0;
  gate(proposal(states.applied), { type: 'approve' }, () => (calls++, verified));
  assert.equal(calls, 0);
  const broken = gate(proposal(states.pending), { type: 'approve' }, () => ({ ok: false, conflicts: ['add-cord: cord-exists'], delta: null, after: null }));
  assert.ok(broken.kind === 'append' && broken.event.type === 'proposal-stale' && broken.refuse?.code === 'stale');
  const worse = gate(proposal(states.pending), { type: 'approve' }, () => ({ ...verified, delta: { cleared: [], introduced: ['x' as never], persisted: [] } }));
  assert.ok(worse.kind === 'append' && worse.refuse?.code === 'introduces-findings');
});

test('the fold ignores an event that does not fit the current state, so a patch never applies twice', () => {
  const applied = applyEvent(proposal(states.pending), { type: 'proposal-applied', id: 'P-1' as ProposalId }, at, by);
  assert.equal(applied.state.status, 'applied');
  const again = applyEvent(applied, { type: 'proposal-applied', id: 'P-1' as ProposalId }, at, by);
  assert.deepEqual(again, applied);
  assert.equal(again.history.length, applied.history.length);
});
