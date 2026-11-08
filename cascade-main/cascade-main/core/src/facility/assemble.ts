// assemble: (statements from current documents, completed changes) → Facility + issues.
// The one function that turns parsed values into a typed model. Deterministic and pure: the same
// inputs always give the same Facility and the same Revision (content hash), so the server can
// re-fold from its event log at boot.

import { ENTITY_KINDS, type EntityKind } from '../contract.js';
import { canonical, sha256Hex } from '../hash.js';
import type { Statement } from '../ingest/documents.js';
import { normalizeTag, SOURCE_PRECEDENCE } from '../ingest/sources.js';
import type { ContractTerm, Entity } from './entities.js';
import { knownFact, missingFact } from './fact.js';
import { buildFacility, type Facility } from './facility.js';
import type { AnyId, Id, SiteId } from './ids.js';
import { factRef, mintId, revisionOf } from './ids.js';
import { codecFor, fieldCodecs, termField, type RefResolver } from './kinds.js';
import { applyOps, type PatchConflict, type PatchOp } from './patch.js';

/** A proposal whose physical work was confirmed done: its ops become the as-built values. */
export interface CompletedChange {
  readonly proposalId: string;
  readonly ops: readonly PatchOp[];
  readonly at: string;
}

export interface AssemblyInput {
  readonly site: SiteId;
  /** What the current version of each document says, in document order. */
  readonly statements: readonly Statement[];
  readonly completed: readonly CompletedChange[];
}

export type AssemblyIssue =
  | { readonly kind: 'unknown-field'; readonly statement: Statement }
  | { readonly kind: 'bad-value'; readonly statement: Statement }
  | { readonly kind: 'dangling-ref'; readonly statement: Statement; readonly target: { readonly kind: EntityKind; readonly tag: string } }
  | { readonly kind: 'stale-change'; readonly change: CompletedChange; readonly conflict: PatchConflict };

export interface Assembly {
  readonly facility: Facility;
  readonly issues: readonly AssemblyIssue[];
}

/** The cabinet tag a cord tag belongs to ("D03/B" → "D03"). */
const cabinetTagOfCord = (cordTag: string) => (cordTag.includes('/') ? cordTag.slice(0, cordTag.lastIndexOf('/')) : null);

const rankOf = (s: Statement) => SOURCE_PRECEDENCE.indexOf(s.source);

/** Field names of the entity an id string names; none when it is not an entity id. */
function fieldNames(id: string): readonly string[] {
  const kind = id.slice(0, Math.max(0, id.indexOf(':')));
  return (ENTITY_KINDS as readonly string[]).includes(kind) ? Object.keys(fieldCodecs(kind as EntityKind)) : [];
}

export function assemble(input: AssemblyInput): Assembly {
  const issues: AssemblyIssue[] = [];

  // 1. Subjects: every (kind, normalized tag) a statement speaks about. A cord exists only with its cabinet.
  const displayTag = new Map<string, string>();
  for (const s of input.statements) {
    const id = mintId(s.subject.kind, normalizeTag(s.subject.tag));
    const prev = displayTag.get(id);
    if (prev === undefined || s.subject.tag < prev) displayTag.set(id, s.subject.tag);
  }
  const cordCabinet = new Map<string, Id<'cabinet'>>();
  for (const id of [...displayTag.keys()]) {
    if (!id.startsWith('cord:')) continue;
    const cab = cabinetTagOfCord(id.slice('cord:'.length));
    const cabId = cab === null ? null : mintId('cabinet', normalizeTag(cab));
    if (cabId && displayTag.has(cabId)) cordCabinet.set(id, cabId);
    else displayTag.delete(id);
  }

  // 2. Resolve references, parse values through the kind's codecs, and keep the highest-precedence value per field.
  const miss: { last: { kind: EntityKind; tag: string } | null } = { last: null };
  const resolver: RefResolver = {
    resolve<K extends EntityKind>(kinds: readonly K[], tag: string): Id<K> | null {
      const key = normalizeTag(tag);
      for (const k of kinds) {
        const id = mintId(k, key);
        if (displayTag.has(id)) return id;
      }
      miss.last = { kind: kinds[0]!, tag };
      return null;
    },
  };
  const chosen = new Map<string, { readonly value: unknown; readonly rank: number }>();
  const candidates = new Map<string, { readonly value: unknown; readonly rank: number }[]>();
  for (const s of input.statements) {
    const id = mintId(s.subject.kind, normalizeTag(s.subject.tag));
    if (!displayTag.has(id)) {
      const cab = cabinetTagOfCord(normalizeTag(s.subject.tag)) ?? s.subject.tag;
      issues.push({ kind: 'dangling-ref', statement: s, target: { kind: 'cabinet', tag: cab } });
      continue;
    }
    if (s.field === null) continue;
    const codec = codecFor(s.subject.kind, s.field);
    if (!codec || (s.field.startsWith('terms/') && s.field !== 'terms')) {
      issues.push({ kind: 'unknown-field', statement: s });
      continue;
    }
    miss.last = null;
    const value = codec.parse(s.value, resolver);
    if (value === undefined) {
      issues.push(miss.last ? { kind: 'dangling-ref', statement: s, target: miss.last } : { kind: 'bad-value', statement: s });
      continue;
    }
    const field = s.subject.kind === 'contract' && s.field === 'terms' ? termField(value as ContractTerm) : s.field;
    const key = `${id}#${field}`;
    const rank = rankOf(s);
    const cur = chosen.get(key);
    if (!cur || rank < cur.rank) chosen.set(key, { value, rank });
    (candidates.get(key) ?? candidates.set(key, []).get(key)!).push({ value, rank });
  }
  // A lower-ranked reference to a device that is itself fed from the chosen one names the same route
  // in more detail ("CHWP-1 from SWGR-A CB-3" and "CHWP-1 from MCC-A", MCC-A fed from SWGR-A CB-3), so it is kept.
  const feeds = (via: unknown, target: unknown) =>
    typeof via === 'string' && fieldNames(via).some((field) => chosen.get(`${via}#${field}`)?.value === target);
  for (const [key, said] of candidates) {
    const win = chosen.get(key)!;
    const finer = said.find((c) => c.rank > win.rank && feeds(c.value, win.value));
    if (finer) chosen.set(key, finer);
  }

  // 3. Build entities. A field no document states is a missing fact.
  const entities = new Map<AnyId, Entity>();
  for (const [rawId, tag] of [...displayTag].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const id = rawId as AnyId;
    const kind = id.slice(0, id.indexOf(':')) as EntityKind;
    const record: Record<string, unknown> = { id, kind, tag };
    for (const field of Object.keys(fieldCodecs(kind))) {
      const c = chosen.get(`${id}#${field}`);
      record[field] = c ? knownFact(factRef(id, field), c.value) : missingFact(factRef(id, field));
    }
    if (kind === 'contract') {
      const termFields = [...chosen.keys()].filter((k) => k.startsWith(`${id}#terms/`)).map((k) => k.slice(id.length + 1)).sort();
      record['terms'] = termFields.map((field) => knownFact(factRef(id, field), chosen.get(`${id}#${field}`)!.value));
    }
    if (kind === 'cord') record['cabinet'] = cordCabinet.get(id)!;
    entities.set(id, record as unknown as Entity);
  }

  // 4. As-built changes, in the order they were confirmed.
  for (const c of [...input.completed].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    for (const conflict of applyOps(entities, c.ops, 'as-built')) issues.push({ kind: 'stale-change', change: c, conflict });
  }

  // 5. Revision: content hash of every input that shaped the model.
  const revision = revisionOf(sha256Hex(canonical({ site: input.site, entities: [...displayTag.keys()].sort(), facts: [...chosen].sort(([a], [b]) => (a < b ? -1 : 1)), completed: input.completed })));

  return { facility: buildFacility(input.site, revision, [...entities.values()]), issues };
}
