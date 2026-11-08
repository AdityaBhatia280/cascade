// Change proposals as typed patches to the model. Each op is one physical work step (which is also
// what a future MOP co-pilot will turn into procedure steps — the seam). Ops are compare-and-set:
// `from` must equal the current value, so a patch computed against an older model cannot apply
// silently to a newer one, and applying the same patch twice is detected (second apply: from ≠ current).

import type { EntityKind, Side } from '../contract.js';
import { canonical, sha256Hex } from '../hash.js';
import type { Cord, Entity } from './entities.js';
import { knownFact, type Fact } from './fact.js';
import { buildFacility, entitiesOf, type Facility } from './facility.js';
import type { AnyId, FactRef, Id, Revision } from './ids.js';
import { factRef, kindOf, mintId, revisionOf, tagOf } from './ids.js';

export type PatchOp =
  /** Unplug a cord and plug it into a different circuit. */
  | { readonly op: 'rehome-cord'; readonly cord: Id<'cord'>; readonly from: Id<'circuit'>; readonly to: Id<'circuit'> }
  /** Add a second cord to a single-corded cabinet (requires dualPsu known true). */
  | { readonly op: 'add-cord'; readonly cabinet: Id<'cabinet'>; readonly side: Side; readonly circuit: Id<'circuit'> }
  /** Re-feed a PDU/RPP from a different upstream breaker or UPS (feeder work; typically needs a shutdown window). */
  | { readonly op: 'refeed'; readonly device: Id<'pdu' | 'rpp'>; readonly from: Id<'ups' | 'breaker' | 'transformer'>; readonly to: Id<'ups' | 'breaker'> };

export interface Patch {
  readonly base: Revision;
  readonly ops: readonly PatchOp[];
}

export type PatchConflict =
  | { readonly kind: 'precondition'; readonly op: PatchOp; readonly ref: FactRef; readonly reason: 'value-changed' | 'fact-missing' }
  | { readonly kind: 'invalid'; readonly op: PatchOp; readonly reason: 'unknown-entity' | 'no-dual-psu' | 'cord-exists' | 'same-target' };

export type PatchResult =
  | { readonly ok: true; readonly facility: Facility }
  | { readonly ok: false; readonly conflicts: readonly PatchConflict[] };

/** One-line, code-generated description of an op. */
export function describeOp(op: PatchOp): string {
  switch (op.op) {
    case 'rehome-cord':
      return `Move cord ${tagOf(op.cord)} from circuit ${tagOf(op.from)} to circuit ${tagOf(op.to)}`;
    case 'add-cord':
      return `Add a side ${op.side} cord to cabinet ${tagOf(op.cabinet)} on circuit ${tagOf(op.circuit)}`;
    case 'refeed':
      return `Re-feed ${tagOf(op.device)} from ${tagOf(op.from)} to ${tagOf(op.to)}`;
  }
}

export function cordIdFor(cabinet: Id<'cabinet'>, side: Side): Id<'cord'> {
  return mintId('cord', `${tagOf(cabinet)}/${side}`);
}

/**
 * The one definition of what an op does to the model. Mutates `entities` in op order (later ops see
 * earlier ones). 'cas' mode checks every precondition (proposals); 'as-built' mode applies confirmed
 * field work and checks only that the entities still exist.
 */
export function applyOps(entities: Map<AnyId, Entity>, ops: readonly PatchOp[], mode: 'cas' | 'as-built'): PatchConflict[] {
  const conflicts: PatchConflict[] = [];
  const has = (id: AnyId, kinds: readonly string[]) => entities.has(id) && kinds.includes(kindOf(id));
  const cas = <T>(op: PatchOp, fact: Fact<T>, expected: T): boolean => {
    if (mode === 'as-built') return true;
    if (fact.kind === 'missing') {
      conflicts.push({ kind: 'precondition', op, ref: fact.ref, reason: 'fact-missing' });
      return false;
    }
    if (fact.value !== expected) {
      conflicts.push({ kind: 'precondition', op, ref: fact.ref, reason: 'value-changed' });
      return false;
    }
    return true;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'rehome-cord': {
        if (!has(op.cord, ['cord']) || !has(op.to, ['circuit'])) {
          conflicts.push({ kind: 'invalid', op, reason: 'unknown-entity' });
          continue;
        }
        if (op.from === op.to) {
          conflicts.push({ kind: 'invalid', op, reason: 'same-target' });
          continue;
        }
        const cord = entities.get(op.cord) as Cord;
        if (cas(op, cord.circuit, op.from)) entities.set(cord.id, { ...cord, circuit: knownFact(cord.circuit.ref, op.to) });
        continue;
      }
      case 'refeed': {
        const kinds = kindOf(op.device) === 'rpp' ? ['breaker'] : ['ups', 'breaker'];
        if (!has(op.device, ['pdu', 'rpp']) || !has(op.to, kinds)) {
          conflicts.push({ kind: 'invalid', op, reason: 'unknown-entity' });
          continue;
        }
        if (op.from === op.to) {
          conflicts.push({ kind: 'invalid', op, reason: 'same-target' });
          continue;
        }
        const device = entities.get(op.device) as Extract<Entity, { kind: 'pdu' | 'rpp' }>;
        if (cas<AnyId>(op, device.input, op.from)) entities.set(device.id, { ...device, input: knownFact(device.input.ref, op.to) } as Entity);
        continue;
      }
      case 'add-cord': {
        if (!has(op.cabinet, ['cabinet']) || !has(op.circuit, ['circuit'])) {
          conflicts.push({ kind: 'invalid', op, reason: 'unknown-entity' });
          continue;
        }
        const id = cordIdFor(op.cabinet, op.side);
        const sameSide = [...entities.values()].some((e) => e.kind === 'cord' && e.cabinet === op.cabinet && e.labelledSide.kind === 'known' && e.labelledSide.value === op.side);
        if (entities.has(id) || sameSide) {
          conflicts.push({ kind: 'invalid', op, reason: 'cord-exists' });
          continue;
        }
        if (mode === 'cas') {
          const { dualPsu } = entities.get(op.cabinet) as Extract<Entity, { kind: 'cabinet' }>;
          if (dualPsu.kind !== 'known' || dualPsu.value !== true) {
            conflicts.push({ kind: 'invalid', op, reason: 'no-dual-psu' });
            continue;
          }
        }
        const cord: Cord = {
          id,
          kind: 'cord',
          tag: tagOf(id),
          cabinet: op.cabinet,
          labelledSide: knownFact(factRef(id, 'labelledSide'), op.side),
          circuit: knownFact(factRef(id, 'circuit'), op.circuit),
        };
        entities.set(id, cord);
        continue;
      }
    }
  }
  return conflicts;
}

/** Pure. Returns a NEW facility with the patched facts set. Revision = hash(base revision, ops, proposalId). */
export function applyPatch(f: Facility, patch: Patch, proposalId: string): PatchResult {
  const entities = new Map<AnyId, Entity>(entitiesOf(f).map((e) => [e.id, e]));
  const conflicts = applyOps(entities, patch.ops, 'cas');
  if (conflicts.length > 0) return { ok: false, conflicts };
  const revision = revisionOf(sha256Hex(canonical([f.revision, patch.ops, proposalId])));
  return { ok: true, facility: buildFacility(f.site, revision, [...entities.values()]) };
}

/** Boundary parse of wire ops against a facility (ids validated, kinds checked). */
export function parsePatchOps(raw: unknown, f: Facility): PatchOp[] | { readonly error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'ops must be a non-empty array' };
  const out: PatchOp[] = [];
  for (const [i, item] of raw.entries()) {
    const o = (item ?? {}) as Partial<Record<'op' | 'cord' | 'from' | 'to' | 'cabinet' | 'side' | 'circuit' | 'device', unknown>>;
    const parse = <K extends EntityKind>(v: unknown, kinds: readonly K[]) => (typeof v === 'string' ? f.parseId(v, kinds) : null);
    if (o.op === 'rehome-cord') {
      const cord = parse(o.cord, ['cord']);
      const from = parse(o.from, ['circuit']);
      const to = parse(o.to, ['circuit']);
      if (!cord || !from || !to) return { error: `ops[${i}]: unknown cord or circuit` };
      out.push({ op: 'rehome-cord', cord, from, to });
    } else if (o.op === 'add-cord') {
      const cabinet = parse(o.cabinet, ['cabinet']);
      const circuit = parse(o.circuit, ['circuit']);
      if (!cabinet || !circuit || (o.side !== 'A' && o.side !== 'B')) return { error: `ops[${i}]: unknown cabinet/circuit or bad side` };
      out.push({ op: 'add-cord', cabinet, side: o.side, circuit });
    } else if (o.op === 'refeed') {
      const device = parse(o.device, ['pdu', 'rpp']);
      const from = parse(o.from, ['ups', 'breaker', 'transformer']);
      const to = parse(o.to, ['ups', 'breaker']);
      if (!device || !from || !to) return { error: `ops[${i}]: unknown device or feeder` };
      out.push({ op: 'refeed', device, from, to });
    } else return { error: `ops[${i}]: unknown op` };
  }
  return out;
}
