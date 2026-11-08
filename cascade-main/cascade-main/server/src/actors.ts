// Who did what. `HumanActor` is a capability: Workspace's human-only commands (decide, send) take one, and `humanFrom(req)` is the only function that mints one. The agent
// code never receives a request object, so it cannot reach those commands. The brand stops it at
// compile time; the registry of minted actors stops a cast at run time.

import type { ActorDto } from '@cascade/core/contract';

export type HumanName = { readonly kind: 'human'; readonly name: string };
export type AgentActor = { readonly kind: 'agent'; readonly runId: string; readonly model: string };
export type PlaybookActor = { readonly kind: 'playbook'; readonly name: string };
/** Boot-time document sync. Never submits or decides, so it has no wire form. */
export type SystemActor = { readonly kind: 'system'; readonly name: string };

/** Actors that appear in proposal history (persisted, JSON-shaped). */
export type Actor = HumanName | AgentActor | PlaybookActor;

declare const HUMAN: unique symbol;
export type HumanActor = HumanName & { readonly [HUMAN]: true };

const minted = new WeakSet<object>();

/** Slice 1 has no auth: the operator names themselves with X-Cascade-User. */
export function humanFrom(req: { header(name: string): string | undefined }): HumanActor {
  const raw = req.header('x-cascade-user')?.trim();
  const actor = { kind: 'human', name: raw && raw.length > 0 ? raw.slice(0, 80) : 'operator' } as HumanActor;
  minted.add(actor);
  return actor;
}

export function isMintedHuman(a: unknown): a is HumanActor {
  return typeof a === 'object' && a !== null && minted.has(a);
}

/** Strips the capability so the persisted record is plain data. */
export function nameOf(a: HumanActor): HumanName {
  return { kind: 'human', name: a.name };
}

export function actorDto(a: Actor): ActorDto {
  switch (a.kind) {
    case 'human':
      return { kind: 'human', name: a.name };
    case 'agent':
      return { kind: 'agent', runId: a.runId, model: a.model };
    case 'playbook':
      return { kind: 'playbook', name: a.name };
  }
}
