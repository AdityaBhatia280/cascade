// ONE table per entity kind. A mapped type over EntityKind (from the contract), so adding a kind to
// the contract fails the build here until it has a layer, a geometry hint and a field schema; and
// adding a Fact field to an entity interface fails the build until its codec exists.
//
// Raw values accepted by the codecs (what parsers emit):
//   references   a tag string ("PDU-3B"), "kind:tag", or { kind, tag }; null/"none" for nullable refs
//   ratings      { unit:'kw', kw } | { unit:'kva', kva } | { unit:'amps', amps, volts, phases }, or text
//                ("500 kW", "750 kVA", "30A 208V 3ph")
//   numbers      a number or a numeric string with an optional unit suffix ("10 min")
//   intents      { scheme } or "N" | "N+1" | "2N"
//   placement    { at:'row-end', row: tag, end } | { at:'grid', hall: tag, x, z } | { at:'room', room }
//   contract terms (field "terms") { term:'power-redundancy', level } | { term:'cooling-redundancy', level }
//                | { term:'committed-kw', cabinet: tag, kw } | { term:'availability', pct, excludesMaintenance }
//                | { term:'maintenance-notice', businessDays }

import type { EntityKind, Layer, Side } from '../contract.js';
import type { ContractTerm, EntityOf, FactField, Placement, Rating, RedundancyIntent } from './entities.js';
import type { Fact, FactValue } from './fact.js';
import type { AnyId, Id } from './ids.js';
import { kindOf, refParts, tagOf } from './ids.js';

/**
 * Parses one raw value (as a parser emitted it) into the field's domain type.
 * Returns undefined when the value is not acceptable; assembly then reports an AssemblyIssue. (`null` is a legitimate value for nullable fields: a documented "no bypass".)
 * Reference codecs resolve tags to Ids against the set of known subjects (dangling → rejected).
 */
export interface Codec<T> {
  readonly parse: (raw: unknown, refs: RefResolver) => T | undefined;
  readonly render: (v: T) => string;
}

export interface RefResolver {
  resolve<K extends EntityKind>(kinds: readonly K[], tag: string): Id<K> | null;
}

export type FieldSchema<K extends EntityKind> = {
  readonly [F in FactField<EntityOf<K>>]: Codec<FactValue<EntityOf<K>[F]>>;
};

export interface KindSpec<K extends EntityKind> {
  readonly layer: Layer;
  /** Box size in metres for the 3D scene, and the band it is placed in when no Placement fact exists. */
  readonly geometry: { readonly size: readonly [number, number, number]; readonly band: 'yard' | 'electrical' | 'hall' | 'plant' | 'none' };
  readonly fields: FieldSchema<K>;
}

// ───────────────────────────── Codecs ─────────────────────────────

/** Wraps a parser whose null means "rejected" (every non-nullable codec). */
const strict =
  <T>(parse: (raw: unknown, refs: RefResolver) => T | null) =>
  (raw: unknown, refs: RefResolver): T | undefined => {
    const v = parse(raw, refs);
    return v === null ? undefined : v;
  };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const m = /^\s*(-?\d[\d,]*(?:\.\d+)?)\s*[a-zA-Z%°/ ]*$/.exec(raw);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

const number = (min: number, unit = ''): Codec<number> => ({
  parse: strict((raw) => {
    const n = toNumber(raw);
    return n !== null && n >= min ? n : null;
  }),
  render: (v) => `${fmt(v)}${unit}`,
});

const text: Codec<string> = {
  parse: strict((raw) => (typeof raw === 'string' && raw.trim() ? raw.trim() : typeof raw === 'number' ? String(raw) : null)),
  render: (v) => v,
};

const bool: Codec<boolean> = {
  parse: strict((raw) => {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return null;
    const s = raw.trim().toLowerCase();
    if (['true', 'yes', 'y', 'dual'].includes(s)) return true;
    if (['false', 'no', 'n', 'single'].includes(s)) return false;
    return null;
  }),
  render: (v) => (v ? 'yes' : 'no'),
};

function parseSide(raw: unknown): Side | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(?:side\s*)?([ab])(?:[\s-]*side)?\s*$/i.exec(raw);
  return m ? (m[1]!.toUpperCase() as Side) : null;
}

const side: Codec<Side> = { parse: strict(parseSide), render: (v) => v };

const isNone = (raw: unknown) => raw === null || (typeof raw === 'string' && /^\s*(none|n\/a|-)?\s*$/i.test(raw));

const nullableSide: Codec<Side | null> = {
  parse: (raw) => (isNone(raw) ? null : (parseSide(raw) ?? undefined)),
  render: (v) => v ?? 'none',
};

function resolveRef<K extends EntityKind>(raw: unknown, kinds: readonly K[], refs: RefResolver): Id<K> | null {
  if (typeof raw === 'string') {
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const k = raw.slice(0, colon) as K;
      if (kinds.includes(k)) return refs.resolve([k], raw.slice(colon + 1));
    }
    return refs.resolve(kinds, raw);
  }
  if (raw !== null && typeof raw === 'object') {
    const { kind, tag } = raw as { kind?: unknown; tag?: unknown };
    if (typeof tag !== 'string') return null;
    if (typeof kind === 'string') return kinds.includes(kind as K) ? refs.resolve([kind as K], tag) : null;
    return refs.resolve(kinds, tag);
  }
  return null;
}

const ref = <K extends EntityKind>(kinds: readonly K[]): Codec<Id<K>> => ({
  parse: strict((raw, refs) => resolveRef(raw, kinds, refs)),
  render: (v) => tagOf(v),
});

const nullableRef = <K extends EntityKind>(kinds: readonly K[]): Codec<Id<K> | null> => ({
  parse: (raw, refs) => (isNone(raw) ? null : (resolveRef(raw, kinds, refs) ?? undefined)),
  render: (v) => (v === null ? 'none' : tagOf(v)),
});

const refList = <K extends EntityKind>(kinds: readonly K[]): Codec<readonly Id<K>[]> => ({
  parse: strict((raw, refs) => {
    const items = typeof raw === 'string' ? raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : Array.isArray(raw) ? raw : null;
    if (!items || items.length === 0) return null;
    const out: Id<K>[] = [];
    for (const item of items) {
      const id = resolveRef(item, kinds, refs);
      if (!id) return null;
      if (!out.includes(id)) out.push(id);
    }
    return out.sort();
  }),
  render: (v) => v.map(tagOf).join(', '),
});

function parseRating(raw: unknown): Rating | null {
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const pos = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    if (r['unit'] === 'kw' && pos(r['kw'])) return { unit: 'kw', kw: r['kw'] as number };
    if (r['unit'] === 'kva' && pos(r['kva'])) return { unit: 'kva', kva: r['kva'] as number };
    if (r['unit'] === 'amps' && pos(r['amps']) && pos(r['volts']) && (r['phases'] === 1 || r['phases'] === 3)) {
      return { unit: 'amps', amps: r['amps'] as number, volts: r['volts'] as number, phases: r['phases'] };
    }
    return null;
  }
  if (typeof raw !== 'string') return null;
  const n = (s: string) => Number(s.replace(/,/g, ''));
  const kva = /^\s*(\d[\d,]*(?:\.\d+)?)\s*kva\s*$/i.exec(raw);
  if (kva) return { unit: 'kva', kva: n(kva[1]!) };
  const kw = /^\s*(\d[\d,]*(?:\.\d+)?)\s*kw\s*$/i.exec(raw);
  if (kw) return { unit: 'kw', kw: n(kw[1]!) };
  const amps = /^\s*(\d[\d,]*)\s*a\b[^\d]*(\d{3})\s*v\b[^\d]*([13])\s*-?\s*(?:ph|p|phase|ø)/i.exec(raw);
  if (amps) return { unit: 'amps', amps: n(amps[1]!), volts: n(amps[2]!), phases: amps[3] === '1' ? 1 : 3 };
  return null;
}

const rating: Codec<Rating> = {
  parse: strict(parseRating),
  render: (v) => (v.unit === 'kw' ? `${fmt(v.kw)} kW` : v.unit === 'kva' ? `${fmt(v.kva)} kVA` : `${fmt(v.amps)} A ${fmt(v.volts)} V ${v.phases}ph`),
};

function parseIntent(raw: unknown): RedundancyIntent | null {
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r['scheme'] === 'N' || r['scheme'] === '2N') return { scheme: r['scheme'] };
    if (r['scheme'] === 'N+K' && typeof r['k'] === 'number' && Number.isInteger(r['k']) && r['k'] >= 1) return { scheme: 'N+K', k: r['k'] };
    return null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s === 'N' || s === '2N') return { scheme: s };
  const m = /^N\s*\+\s*(\d+)$/.exec(s);
  return m && Number(m[1]) >= 1 ? { scheme: 'N+K', k: Number(m[1]) } : null;
}

export const renderIntent = (v: RedundancyIntent) => (v.scheme === 'N+K' ? `N+${v.k}` : v.scheme);

const intent: Codec<RedundancyIntent> = { parse: strict(parseIntent), render: renderIntent };

const placement: Codec<Placement> = {
  parse: strict((raw, refs): Placement | null => {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r['at'] === 'row-end' && (r['end'] === 'start' || r['end'] === 'end')) {
      const row = resolveRef(r['row'], ['row'], refs);
      return row ? { at: 'row-end', row, end: r['end'] } : null;
    }
    if (r['at'] === 'grid' && typeof r['x'] === 'number' && typeof r['z'] === 'number') {
      const hall = resolveRef(r['hall'], ['hall'], refs);
      return hall ? { at: 'grid', hall, x: r['x'], z: r['z'] } : null;
    }
    if (r['at'] === 'room' && typeof r['room'] === 'string' && r['room'].trim()) return { at: 'room', room: r['room'].trim() };
    return null;
  }),
  render: (v) => (v.at === 'row-end' ? `${tagOf(v.row)} ${v.end}` : v.at === 'grid' ? `${tagOf(v.hall)} grid (${v.x}, ${v.z})` : v.room),
};

const dimensions: Codec<{ readonly width: number; readonly depth: number }> = {
  parse: strict((raw): { readonly width: number; readonly depth: number } | null => {
    if (raw !== null && typeof raw === 'object') {
      const { width, depth } = raw as Record<string, unknown>;
      return typeof width === 'number' && typeof depth === 'number' && width > 0 && depth > 0 ? { width, depth } : null;
    }
    if (typeof raw !== 'string') return null;
    const m = /(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(raw);
    return m ? { width: Number(m[1]), depth: Number(m[2]) } : null;
  }),
  render: (v) => `${fmt(v.width)} m × ${fmt(v.depth)} m`,
};

const role: Codec<'duty' | 'standby'> = {
  parse: strict((raw) => (raw === 'duty' || raw === 'standby' ? raw : typeof raw === 'string' && /^(lead|duty)$/i.test(raw.trim()) ? 'duty' : typeof raw === 'string' && /^standby$/i.test(raw.trim()) ? 'standby' : null)),
  render: (v) => v,
};

/** Contract terms are a list of facts (one per clause), so their codec lives outside FieldSchema. */
const TERM_CODEC: Codec<ContractTerm> = {
  parse: strict((raw, refs): ContractTerm | null => {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    switch (r['term']) {
      case 'power-redundancy':
        return r['level'] === '2N' || r['level'] === 'A+B' || r['level'] === 'N+1' || r['level'] === 'N' ? { term: 'power-redundancy', level: r['level'] } : null;
      case 'cooling-redundancy':
        return r['level'] === 'N+1' || r['level'] === 'N' ? { term: 'cooling-redundancy', level: r['level'] } : null;
      case 'committed-kw': {
        const cabinet = resolveRef(r['cabinet'], ['cabinet'], refs);
        const kw = toNumber(r['kw']);
        return cabinet && kw !== null && kw > 0 ? { term: 'committed-kw', cabinet, kw } : null;
      }
      case 'availability': {
        const pct = toNumber(r['pct']);
        return pct !== null && pct > 0 && pct <= 100 && typeof r['excludesMaintenance'] === 'boolean'
          ? { term: 'availability', pct, excludesMaintenance: r['excludesMaintenance'] }
          : null;
      }
      case 'maintenance-notice': {
        const days = toNumber(r['businessDays']);
        return days !== null && Number.isInteger(days) && days >= 0 ? { term: 'maintenance-notice', businessDays: days } : null;
      }
      default:
        return null;
    }
  }),
  render: renderTerm,
};

export function renderTerm(t: ContractTerm): string {
  switch (t.term) {
    case 'power-redundancy':
      return `power ${t.level}`;
    case 'cooling-redundancy':
      return `cooling ${t.level}`;
    case 'committed-kw':
      return `${tagOf(t.cabinet)} committed ${fmt(t.kw)} kW`;
    case 'availability':
      return `${t.pct}% availability${t.excludesMaintenance ? ' excluding maintenance' : ''}`;
    case 'maintenance-notice':
      return `${t.businessDays} business days' notice of scheduled maintenance`;
  }
}

/** The fact-field name a term is stored under: one fact per (term kind[, cabinet]). */
export function termField(t: ContractTerm): string {
  return t.term === 'committed-kw' ? `terms/committed-kw/${tagOf(t.cabinet)}` : `terms/${t.term}`;
}

// ───────────────────────────── The table ─────────────────────────────

const ELECTRICAL_SOURCE = ['breaker', 'circuit'] as const;

export const KINDS: { readonly [K in EntityKind]: KindSpec<K> } = {
  utility: { layer: 'power', geometry: { size: [3, 2.5, 3], band: 'yard' }, fields: { rating } },
  generator: {
    layer: 'power',
    geometry: { size: [6, 3, 2.5], band: 'yard' },
    fields: { rating, startDelaySec: number(0, ' s') },
  },
  ats: {
    layer: 'power',
    geometry: { size: [1.2, 2.2, 0.8], band: 'electrical' },
    fields: { normal: ref(['utility', 'breaker']), alternate: ref(['generator', 'breaker']), rating },
  },
  switchgear: {
    layer: 'power',
    geometry: { size: [4, 2.4, 1], band: 'electrical' },
    fields: { input: ref(['ats', 'utility', 'breaker']), rating, labelledSide: nullableSide },
  },
  breaker: {
    layer: 'power',
    geometry: { size: [0.4, 0.6, 0.3], band: 'electrical' },
    fields: { bus: ref(['switchgear', 'ups', 'pdu']), rating },
  },
  ups: {
    layer: 'power',
    geometry: { size: [2.4, 2, 1], band: 'electrical' },
    fields: {
      input: ref(['breaker']),
      bypass: nullableRef(['breaker']),
      batteryMin: number(0, ' min'),
      rating,
      labelledSide: nullableSide,
    },
  },
  pdu: {
    layer: 'power',
    geometry: { size: [1.2, 2, 0.8], band: 'electrical' },
    fields: { input: ref(['ups', 'breaker']), rating, labelledSide: nullableSide, placement },
  },
  rpp: {
    layer: 'power',
    geometry: { size: [0.8, 2, 0.6], band: 'electrical' },
    fields: { input: ref(['breaker']), rating, labelledSide: nullableSide, placement },
  },
  circuit: {
    layer: 'power',
    geometry: { size: [0.15, 0.15, 0.1], band: 'electrical' },
    fields: { panel: ref(['pdu', 'rpp']), position: text, rating, measuredKw: number(0, ' kW') },
  },
  cord: { layer: 'power', geometry: { size: [0.05, 0.05, 0.05], band: 'hall' }, fields: { labelledSide: side, circuit: ref(['circuit']) } },
  hall: {
    layer: 'space',
    geometry: { size: [0, 0, 0], band: 'hall' },
    fields: { dimensionsM: dimensions, coolingIntent: intent, maxInletC: number(0, ' °C') },
  },
  row: { layer: 'space', geometry: { size: [0, 0, 0], band: 'hall' }, fields: { hall: ref(['hall']), index: number(0) } },
  cabinet: {
    layer: 'it',
    geometry: { size: [0.6, 2.2, 1.2], band: 'hall' },
    fields: {
      row: ref(['row']),
      slot: number(0),
      customer: ref(['customer']),
      measuredKw: number(0, ' kW'),
      dualPsu: bool,
    },
  },
  chiller: {
    layer: 'cooling',
    geometry: { size: [6, 2.5, 2.5], band: 'plant' },
    fields: { header: ref(['header']), power: ref(ELECTRICAL_SOURCE), capacityKw: number(0, ' kW'), role },
  },
  header: { layer: 'cooling', geometry: { size: [4, 0.4, 0.4], band: 'plant' }, fields: { loop: ref(['loop']) } },
  loop: { layer: 'cooling', geometry: { size: [1, 0.3, 1], band: 'plant' }, fields: { intent } },
  pump: {
    layer: 'cooling',
    geometry: { size: [1.2, 1, 0.8], band: 'plant' },
    fields: { loop: ref(['loop']), power: ref(ELECTRICAL_SOURCE), capacityKw: number(0, ' kW') },
  },
  crah: {
    layer: 'cooling',
    geometry: { size: [1, 2, 2.5], band: 'hall' },
    fields: {
      loop: ref(['loop']),
      hall: ref(['hall']),
      power: ref(ELECTRICAL_SOURCE),
      capacityKw: number(0, ' kW'),
      placement,
    },
  },
  customer: { layer: 'tenant', geometry: { size: [0, 0, 0], band: 'none' }, fields: { name: text } },
  contract: {
    layer: 'tenant',
    geometry: { size: [0, 0, 0], band: 'none' },
    fields: { customer: ref(['customer']), monthlyFeeUsd: number(0, ' USD/mo'), cabinets: refList(['cabinet']) },
  },
};

/** Untyped view of a kind's field codecs (assembly and display iterate fields by name). */
export function fieldCodecs(kind: EntityKind): Readonly<Record<string, Codec<unknown>>> {
  return KINDS[kind].fields as unknown as Readonly<Record<string, Codec<unknown>>>;
}

/** A fact rendered for people; null when it is missing. */
export function displayFact(fact: Fact<unknown>): string | null {
  if (fact.kind === 'missing') return null;
  const { entity, field } = refParts(fact.ref);
  return codecFor(kindOf(entity as AnyId), field)!.render(fact.value);
}

/** The codec for a fact field name, including contract `terms/...` fields. */
export function codecFor(kind: EntityKind, field: string): Codec<unknown> | null {
  if (kind === 'contract' && (field === 'terms' || field.startsWith('terms/'))) return TERM_CODEC as unknown as Codec<unknown>;
  return fieldCodecs(kind)[field] ?? null;
}
