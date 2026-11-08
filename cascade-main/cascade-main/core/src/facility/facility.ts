// Facility: the immutable, typed model of one site at one revision.
//
// Data-structure decisions (traced against the dominant access patterns):
//   - entity by id, typed            → `get(id)` returns EntityOf<K> from the id's brand. O(1).
//   - upstream walk (cord → source)  → reference facts on the entities themselves. O(depth).
//   - downstream ("what it feeds")   → reverse index built ONCE at construction from every known
//                                      reference value. Because the facility is immutable the index
//                                      cannot go stale; it is part of the value, not a cache beside it.
//   - cords of a cabinet             → identity index (cord.cabinet is identity, not a fact).
//   - all of a kind                  → per-kind arrays, built at construction, id-sorted (deterministic).
//   - all facts                      → iterated from entities.
// Loads, capacity and supply semantics are NOT here: that is physics/supply.ts, compiled inside an Analysis.

import { ENTITY_KINDS, type EntityKind } from '../contract.js';
import type { Entity, EntityOf } from './entities.js';
import type { Fact } from './fact.js';
import type { AnyId, FactRef, Id, Revision, SiteId } from './ids.js';
import { kindOf, refParts } from './ids.js';
import { fieldCodecs } from './kinds.js';

export interface Facility {
  readonly site: SiteId;
  readonly revision: Revision;

  get<K extends EntityKind>(id: Id<K>): EntityOf<K>;
  list<K extends EntityKind>(kind: K): readonly EntityOf<K>[];
  /** Boundary parse of an id from a request / tool call. */
  parseId(raw: string): AnyId | null;
  parseId<K extends EntityKind>(raw: string, kinds: readonly K[]): Id<K> | null;
  /** Boundary parse of a fact address ("cord:R12/B#circuit") from a request / tool call. */
  parseRef(raw: string): FactRef | null;

  /** Entities that reference `id` through a reference fact. */
  dependents(id: AnyId): readonly AnyId[];
  cordsOf(cabinet: Id<'cabinet'>): readonly EntityOf<'cord'>[];

  fact(ref: FactRef): Fact<unknown> | null;
  facts(): Iterable<{ readonly entity: AnyId; readonly field: string; readonly fact: Fact<unknown> }>;
}

/** Every fact an entity carries, in field-table order (contract terms last). */
export function factsOf(e: Entity): readonly { readonly field: string; readonly fact: Fact<unknown> }[] {
  const record = e as unknown as Readonly<Record<string, Fact<unknown>>>;
  const out = Object.keys(fieldCodecs(e.kind)).map((field) => ({ field, fact: record[field]! }));
  if (e.kind === 'contract') for (const t of e.terms) out.push({ field: refParts(t.ref).field, fact: t });
  return out;
}

/** All entities of a facility, kind-major then id order. Internal (patch, assembly, analysis). */
export function entitiesOf(f: Facility): readonly Entity[] {
  return ENTITY_KINDS.flatMap((k) => f.list(k) as readonly Entity[]);
}

function collectIds(value: unknown, known: ReadonlyMap<string, Entity>, out: Set<AnyId>): void {
  if (typeof value === 'string') {
    if (known.has(value)) out.add(value as AnyId);
  } else if (Array.isArray(value)) {
    for (const v of value) collectIds(v, known, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectIds(v, known, out);
  }
}

/**
 * Internal constructor (used by assemble.ts and patch.ts only; not re-exported from index.ts).
 * Validates referential integrity (every Id inside every known value resolves), freezes, builds indices.
 */
export function buildFacility(site: SiteId, revision: Revision, entities: readonly Entity[]): Facility {
  const byId = new Map<string, Entity>();
  for (const e of entities) {
    if (byId.has(e.id)) throw new Error(`duplicate entity ${e.id}`);
    byId.set(e.id, Object.freeze(e));
  }
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byKind = new Map<EntityKind, Entity[]>(ENTITY_KINDS.map((k) => [k, []]));
  const factIndex = new Map<string, { entity: AnyId; field: string; fact: Fact<unknown> }>();
  const deps = new Map<AnyId, Set<AnyId>>();
  const cords = new Map<AnyId, EntityOf<'cord'>[]>();
  const addDep = (target: AnyId, dependent: AnyId) => {
    if (target === dependent) return;
    let s = deps.get(target);
    if (!s) deps.set(target, (s = new Set()));
    s.add(dependent);
  };

  for (const e of sorted) {
    byKind.get(e.kind)!.push(e);
    for (const { field, fact } of factsOf(e)) {
      factIndex.set(fact.ref, { entity: e.id, field, fact });
      if (fact.kind === 'missing') continue;
      const ids = new Set<AnyId>();
      collectIds(fact.value, byId, ids);
      for (const target of ids) addDep(target, e.id);
      const v = fact.value;
      if (ids.size === 0 && typeof v === 'string' && /^[a-z]+:/.test(v) && (ENTITY_KINDS as readonly string[]).includes(v.slice(0, v.indexOf(':')))) {
        throw new Error(`dangling reference ${v} in ${fact.ref}`);
      }
    }
    if (e.kind === 'cord') {
      if (!byId.has(e.cabinet)) throw new Error(`cord ${e.id} belongs to unknown cabinet ${e.cabinet}`);
      let list = cords.get(e.cabinet);
      if (!list) cords.set(e.cabinet, (list = []));
      list.push(e);
      addDep(e.id, e.cabinet);
      deps.get(e.cabinet)?.delete(e.id);
    }
  }
  const depLists = new Map<AnyId, readonly AnyId[]>([...deps].map(([k, v]) => [k, Object.freeze([...v].sort())]));

  const parseId = (raw: string, kinds?: readonly EntityKind[]): AnyId | null => {
    if (typeof raw !== 'string' || !byId.has(raw)) return null;
    const id = raw as AnyId;
    return !kinds || kinds.includes(kindOf(id)) ? id : null;
  };

  return Object.freeze({
    site,
    revision,
    get<K extends EntityKind>(id: Id<K>): EntityOf<K> {
      const e = byId.get(id);
      if (!e) throw new Error(`unknown entity ${id}`);
      return e as EntityOf<K>;
    },
    list<K extends EntityKind>(kind: K): readonly EntityOf<K>[] {
      return (byKind.get(kind) ?? []) as unknown as readonly EntityOf<K>[];
    },
    parseId: parseId as Facility['parseId'],
    parseRef: (raw: string) => (typeof raw === 'string' && factIndex.has(raw) ? (raw as FactRef) : null),
    dependents: (id: AnyId) => depLists.get(id) ?? [],
    cordsOf: (cabinet: Id<'cabinet'>) => cords.get(cabinet) ?? [],
    fact: (ref: FactRef) => factIndex.get(ref)?.fact ?? null,
    *facts() {
      yield* factIndex.values();
    },
  });
}
