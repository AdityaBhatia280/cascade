import type { EntityKind } from '../contract.js';

declare const KIND: unique symbol;

/**
 * Typed entity id. Runtime shape `${kind}:${tag}` (e.g. "pdu:PDU-3B", "cord:R12/B"), so the kind is
 * recoverable from the string. The brand makes `Id<'circuit'>` unassignable to `Id<'pdu'>`, and
 * reference fields declare exactly which kinds they may point at (`Fact<Id<'pdu' | 'rpp'>>`).
 *
 * Minted only by assembly (validated references), patch application (new cords) and
 * `Facility.parseId` (boundary parse of request input). Inside core, an `Id` always resolves in the
 * facility it came from.
 */
export type Id<K extends EntityKind = EntityKind> = string & { readonly [KIND]: K };
export type AnyId = Id<EntityKind>;

/** Content hash of everything the facility was folded from (claims, decisions, applied patches). */
declare const REV: unique symbol;
export type Revision = string & { readonly [REV]: true };

declare const SITE: unique symbol;
export type SiteId = string & { readonly [SITE]: true };

/**
 * Stable address of one fact: `${entityId}#${field}` (e.g. "cord:R12/B#circuit").
 * Used by verification questions, findings' `because`, conflicts, patches and the evidence UI.
 */
declare const FREF: unique symbol;
export type FactRef = string & { readonly [FREF]: true };

export function kindOf<K extends EntityKind>(id: Id<K>): K {
  return id.slice(0, id.indexOf(':')) as K;
}

export function tagOf(id: AnyId): string {
  return id.slice(id.indexOf(':') + 1);
}

export function mintId<K extends EntityKind>(kind: K, normalizedTag: string): Id<K> {
  return `${kind}:${normalizedTag}` as Id<K>;
}

export function factRef(id: AnyId, field: string): FactRef {
  return `${id}#${field}` as FactRef;
}

export function refParts(ref: FactRef): { readonly entity: string; readonly field: string } {
  const at = ref.indexOf('#');
  return { entity: ref.slice(0, at), field: ref.slice(at + 1) };
}

export function siteId(raw: string): SiteId {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(raw)) throw new Error(`invalid site id: ${raw}`);
  return raw as SiteId;
}

export function revisionOf(hex: string): Revision {
  return hex as Revision;
}
