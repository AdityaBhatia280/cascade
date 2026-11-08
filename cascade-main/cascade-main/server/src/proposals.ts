// The approval gate as a pure state machine. No I/O: Workspace feeds it the current proposal and a
// lazy re-verification, and appends whatever event it returns.
//
//                approve (re-verify ok)            complete (field work confirmed)
//   pending ─────────────────────────────▶ applied ─────────────────────────────▶ completed
//      │  approve (patch no longer applies │
//      │  or re-audit introduces findings) │
//      ├────────────────▶ stale            │
//      │ reject
//      └────────────────▶ rejected
//
// Repeating the command that produced the current state is a noop (no event, no effect). Only the
// pending→applied edge emits `proposal-applied`, and `applyEvent` ignores events that do not fit
// the current state, so a patch is never applied twice. Only humans decide: every command arrives
// with a HumanName taken from a minted HumanActor.

import type { FixPlan, PatchVerification } from '@cascade/core';
import type { ProposalStatus } from '@cascade/core/contract';
import type { Actor, HumanName } from './actors.js';

declare const PRID: unique symbol;
export type ProposalId = string & { readonly [PRID]: true };

export type ProposalState =
  | { readonly status: 'pending' }
  | { readonly status: 'applied'; readonly by: HumanName; readonly at: string }
  | { readonly status: 'rejected'; readonly by: HumanName; readonly at: string; readonly reason: string }
  | { readonly status: 'stale'; readonly at: string; readonly reason: string }
  | { readonly status: 'completed'; readonly by: HumanName; readonly at: string };

export interface HistoryEntry {
  readonly status: ProposalStatus;
  readonly by: Actor;
  readonly at: string;
  readonly note: string;
}

export interface Proposal {
  readonly id: ProposalId;
  /** Planner output, with cleared/introduced replaced by the re-verification at submit time. */
  readonly plan: FixPlan;
  readonly rationale: string;
  readonly submittedBy: Actor;
  readonly submittedAt: string;
  readonly state: ProposalState;
  readonly history: readonly HistoryEntry[];
}

export type ProposalCommand =
  | { readonly type: 'approve' }
  | { readonly type: 'reject'; readonly reason: string }
  | { readonly type: 'complete' };

export type ProposalEvent =
  | { readonly type: 'proposal-applied'; readonly id: ProposalId }
  | { readonly type: 'proposal-rejected'; readonly id: ProposalId; readonly reason: string }
  | { readonly type: 'proposal-stale'; readonly id: ProposalId; readonly reason: string }
  | { readonly type: 'proposal-completed'; readonly id: ProposalId };

export type GateRefusal = { readonly code: 'stale' | 'introduces-findings' | 'not-pending' | 'not-applied'; readonly message: string };

export type GateResult =
  | { readonly kind: 'noop' }
  | { readonly kind: 'append'; readonly event: ProposalEvent; readonly refuse: null }
  /** Approving a patch that no longer verifies marks it stale for everyone and still refuses. */
  | { readonly kind: 'append'; readonly event: ProposalEvent; readonly refuse: GateRefusal }
  | { readonly kind: 'refuse'; readonly refuse: GateRefusal };

const refuse = (code: GateRefusal['code'], message: string): GateResult => ({ kind: 'refuse', refuse: { code, message } });

const notPending = (p: Proposal, cmd: ProposalCommand) => refuse('not-pending', `cannot ${cmd.type} proposal ${p.id}: it is ${p.state.status}`);

export function gate(p: Proposal, cmd: ProposalCommand, reverify: () => PatchVerification): GateResult {
  switch (p.state.status) {
    case 'pending':
      switch (cmd.type) {
        case 'approve': {
          const v = reverify();
          if (!v.ok) {
            const reason = `patch no longer applies: ${v.conflicts.join('; ')}`;
            return { kind: 'append', event: { type: 'proposal-stale', id: p.id, reason }, refuse: { code: 'stale', message: reason } };
          }
          const introduced = v.delta?.introduced ?? [];
          if (introduced.length > 0) {
            const reason = `re-audit introduces findings: ${introduced.join(', ')}`;
            return { kind: 'append', event: { type: 'proposal-stale', id: p.id, reason }, refuse: { code: 'introduces-findings', message: reason } };
          }
          return { kind: 'append', event: { type: 'proposal-applied', id: p.id }, refuse: null };
        }
        case 'reject':
          return { kind: 'append', event: { type: 'proposal-rejected', id: p.id, reason: cmd.reason }, refuse: null };
        case 'complete':
          return refuse('not-applied', `cannot complete proposal ${p.id}: it has not been approved`);
      }
    case 'applied':
      switch (cmd.type) {
        case 'approve':
          return { kind: 'noop' };
        case 'reject':
          return notPending(p, cmd);
        case 'complete':
          return { kind: 'append', event: { type: 'proposal-completed', id: p.id }, refuse: null };
      }
    case 'rejected':
      return cmd.type === 'reject' ? { kind: 'noop' } : notPending(p, cmd);
    case 'stale':
      return notPending(p, cmd);
    case 'completed':
      return cmd.type === 'complete' ? { kind: 'noop' } : notPending(p, cmd);
  }
}

/** Folds one event into a proposal; an event that does not fit the current state is ignored. */
export function applyEvent(p: Proposal, e: ProposalEvent, at: string, by: HumanName): Proposal {
  const next = (state: ProposalState, note: string): Proposal => ({
    ...p,
    state,
    history: [...p.history, { status: state.status, by, at, note }],
  });
  switch (e.type) {
    case 'proposal-applied':
      return p.state.status === 'pending' ? next({ status: 'applied', by, at }, 'approved; re-verified against the current planned model') : p;
    case 'proposal-rejected':
      return p.state.status === 'pending' ? next({ status: 'rejected', by, at, reason: e.reason }, e.reason) : p;
    case 'proposal-stale':
      return p.state.status === 'pending' ? next({ status: 'stale', at, reason: e.reason }, e.reason) : p;
    case 'proposal-completed':
      return p.state.status === 'applied' ? next({ status: 'completed', by, at }, 'field work confirmed; now as-built') : p;
  }
}
