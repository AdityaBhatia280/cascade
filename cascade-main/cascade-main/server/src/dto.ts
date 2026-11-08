// Wire forms of the server-owned records (proposals, messages). Domain DTOs come from core's toWire.

import { toWire } from '@cascade/core';
import type { MessageDto, ProposalDto } from '@cascade/core/contract';
import { actorDto } from './actors.js';
import type { Proposal } from './proposals.js';
import type { SentMessage } from './workspace.js';

export function messageDto(m: SentMessage): MessageDto {
  return { ...m, approvedBy: actorDto(m.approvedBy), delivery: { ...m.delivery } };
}

export function proposalDto(p: Proposal): ProposalDto {
  return {
    id: p.id,
    plan: toWire.plan(p.plan),
    rationale: p.rationale,
    submittedBy: actorDto(p.submittedBy),
    status: p.state.status,
    staleReason: p.state.status === 'stale' ? p.state.reason : null,
    history: p.history.map((h) => ({ status: h.status, by: actorDto(h.by), at: h.at, note: h.note })),
  };
}
