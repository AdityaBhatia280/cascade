// A model's reading of one contract document, checked against that document before it counts.
// Each field is kept only when its value literally appears in the text, next to what it is about
// (a fee as a dollar amount, a committed kW on its cabinet's line, a redundancy level on its
// clause), and when it does not contradict what the deterministic parser read from the same text.
// A kept field only adds what the parser missed: the parser stays the authority on what it reads.

import type { SourceDocument, Statement } from './documents.js';
import { expandCabinets, normalizeTag, parseDocument } from './sources.js';

export type PowerLevel = '2N' | 'A+B' | 'N+1' | 'N';
export type CoolingLevel = 'N+1' | 'N';

export interface CommittedKw {
  readonly cabinet: string;
  readonly kw: number;
}

/** What a model says one contract document states. An absent field was not read, or was dropped. */
export interface ContractReading {
  /** The master services agreement number the document is, or is issued under. */
  readonly agreementNumber?: string;
  readonly account?: string;
  readonly customerName?: string;
  readonly monthlyFeeUsd?: number;
  readonly cabinets?: readonly string[];
  readonly committedKw?: readonly CommittedKw[];
  readonly powerRedundancy?: PowerLevel;
  readonly coolingRedundancy?: CoolingLevel;
  readonly noticeBusinessDays?: number;
}
export type ReadingField = keyof ContractReading;

export interface CheckedReading {
  readonly reading: ContractReading;
  /** Fields the model gave that did not survive the check, with why. */
  readonly dropped: readonly { readonly field: ReadingField; readonly why: string }[];
}

const POWER_LEVELS = ['2N', 'A+B', 'N+1', 'N'] as const;
const COOLING_LEVELS = ['N+1', 'N'] as const;

/** JSON Schema for the model's answer; every field may be null when the document does not state it. */
export const CONTRACT_READING_SCHEMA = {
  type: 'object',
  properties: {
    agreementNumber: { type: ['string', 'null'], description: 'The master services agreement number this document is or is issued under, e.g. DFW-MSA-1156' },
    account: { type: ['string', 'null'], description: "The customer's account number, e.g. C1156" },
    customerName: { type: ['string', 'null'], description: 'The customer (not the provider) as named in the document' },
    monthlyFeeUsd: { type: ['number', 'null'], description: 'Monthly recurring charge in US dollars' },
    cabinets: { type: ['array', 'null'], items: { type: 'string' }, description: 'Every licensed cabinet, one tag each (expand ranges)' },
    committedKw: {
      type: ['array', 'null'],
      items: { type: 'object', properties: { cabinet: { type: 'string' }, kw: { type: 'number' } }, required: ['cabinet', 'kw'] },
      description: 'Committed power per cabinet in kW',
    },
    powerRedundancy: { type: ['string', 'null'], enum: [...POWER_LEVELS, null], description: 'Power redundancy promised' },
    coolingRedundancy: { type: ['string', 'null'], enum: [...COOLING_LEVELS, null], description: 'Cooling redundancy promised' },
    noticeBusinessDays: { type: ['integer', 'null'], description: 'Business days of written notice owed before scheduled maintenance' },
  },
  required: ['agreementNumber', 'account', 'customerName', 'monthlyFeeUsd', 'cabinets', 'committedKw', 'powerRedundancy', 'coolingRedundancy', 'noticeBusinessDays'],
} as const;

// ───────────────────────────── the document's text ─────────────────────────────

interface Text {
  readonly lines: readonly string[];
  readonly flat: string;
  readonly money: ReadonlySet<number>;
  readonly cabinets: ReadonlySet<string>;
}

const squash = (s: string) => s.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasToken = (line: string, token: string) => new RegExp(`(^|[^A-Za-z0-9+])${escape(token)}($|[^A-Za-z0-9+])`, 'i').test(line);
const kwOn = (line: string) => [...line.matchAll(/(\d+(?:\.\d+)?)\s*kW\b/gi)].map((m) => Number(m[1]));

function textOf(doc: SourceDocument): Text {
  const lines = doc.text.split(/\r?\n/).map(squash).filter(Boolean);
  const money = new Set([...doc.text.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replace(/,/g, ''))));
  const cabinets = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/\b[A-Z]\d{2,3}(?:\s*(?:-|through|to)\s*[A-Z]\d{2,3})?\b/g)) for (const c of expandCabinets(m[0]) ?? []) cabinets.add(c);
  }
  return { lines, flat: lines.join(' ').toLowerCase(), money, cabinets };
}

// ───────────────────────────── one table row per field ─────────────────────────────

type ValueOf<F extends ReadingField> = NonNullable<ContractReading[F]>;

interface FieldRule<F extends ReadingField> {
  /** The model's raw value in the domain shape, or undefined when it has the wrong shape. */
  readonly shape: (raw: unknown) => ValueOf<F> | undefined;
  /** Where in the text the value must appear. */
  readonly inText: (v: ValueOf<F>, t: Text) => boolean;
  /** What the value says about the contract, as parser-shaped statements (none for display-only fields). */
  readonly says: (v: ValueOf<F>) => readonly { readonly field: string; readonly value: unknown }[];
}

const str = (raw: unknown) => (typeof raw === 'string' && raw.trim() !== '' ? squash(raw) : undefined);
const finite = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined);
const oneOf = <T extends string>(levels: readonly T[]) => (raw: unknown) => (levels as readonly unknown[]).includes(raw) ? (raw as T) : undefined;
const levelOn = (line: string, level: string) => new RegExp(`(^|[^\\w+])${escape(level)}($|[^\\w+])`).test(line);

const RULES: { readonly [F in ReadingField]: FieldRule<F> } = {
  agreementNumber: {
    shape: str,
    inText: (v, t) => t.lines.some((l) => /agreement/i.test(l) && hasToken(l, v)),
    says: () => [],
  },
  account: {
    shape: str,
    inText: (v, t) => t.lines.some((l) => /account/i.test(l) && hasToken(l, v)),
    says: (v) => [{ field: 'customer', value: normalizeTag(v) }],
  },
  customerName: {
    shape: str,
    inText: (v, t) => t.flat.includes(v.toLowerCase()),
    says: () => [],
  },
  monthlyFeeUsd: {
    shape: finite,
    inText: (v, t) => t.money.has(v),
    says: (v) => [{ field: 'monthlyFeeUsd', value: v }],
  },
  cabinets: {
    shape: (raw) => {
      if (!Array.isArray(raw) || raw.length === 0 || !raw.every((c) => typeof c === 'string' && /^[A-Z]\d{2,3}$/i.test(c.trim()))) return undefined;
      return raw.map((c: string) => normalizeTag(c));
    },
    inText: (v, t) => v.every((c) => t.cabinets.has(c)),
    says: (v) => [{ field: 'cabinets', value: v }],
  },
  committedKw: {
    shape: (raw) => {
      if (!Array.isArray(raw) || raw.length === 0) return undefined;
      const out: CommittedKw[] = [];
      for (const r of raw as unknown[]) {
        const o = r as { cabinet?: unknown; kw?: unknown } | null;
        const cabinet = str(o?.cabinet);
        const kw = finite(o?.kw);
        if (!cabinet || kw === undefined || !/^[A-Z]\d{2,3}$/i.test(cabinet)) return undefined;
        out.push({ cabinet: normalizeTag(cabinet), kw });
      }
      return out;
    },
    inText: (v, t) => v.every((c) => t.lines.some((l) => hasToken(l, c.cabinet) && kwOn(l).includes(c.kw))),
    says: (v) => v.map((c) => ({ field: 'terms', value: { term: 'committed-kw', cabinet: c.cabinet, kw: c.kw } })),
  },
  powerRedundancy: {
    shape: oneOf(POWER_LEVELS),
    inText: (v, t) => t.lines.some((l) => /power/i.test(l) && /redundan/i.test(l) && levelOn(l, v)),
    says: (v) => [{ field: 'terms', value: { term: 'power-redundancy', level: v } }],
  },
  coolingRedundancy: {
    shape: oneOf(COOLING_LEVELS),
    inText: (v, t) => t.lines.some((l) => /cooling/i.test(l) && levelOn(l, v)),
    says: (v) => [{ field: 'terms', value: { term: 'cooling-redundancy', level: v } }],
  },
  noticeBusinessDays: {
    shape: (raw) => (Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : undefined),
    inText: (v, t) => t.lines.some((l) => /business days/i.test(l) && /notice/i.test(l) && hasToken(l, String(v))),
    says: (v) => [{ field: 'terms', value: { term: 'maintenance-notice', businessDays: v } }],
  },
};

const FIELDS = Object.keys(RULES) as ReadingField[];

// ───────────────────────────── slots: one value per contract fact ─────────────────────────────

type Said = { readonly field: string | null; readonly value: unknown };

/** The fact a statement speaks to: `terms` statements name their term (and cabinet). */
function slotOf(s: Said): string {
  if (s.field !== 'terms') return s.field ?? '(exists)';
  const t = s.value as { term?: unknown; cabinet?: unknown };
  return t.term === 'committed-kw' ? `terms/committed-kw/${String(t.cabinet)}` : `terms/${String(t.term)}`;
}

const canon = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...(v as unknown[])].map(String).sort() : v);

const contractTagOf = (statements: readonly Statement[]) => statements.find((s) => s.subject.kind === 'contract')?.subject.tag ?? null;

// ───────────────────────────── the public functions ─────────────────────────────

/**
 * Checks a model's raw answer for a contract document (already text-extracted). Keeps each field that
 * has the right shape, appears in the text where it belongs, and agrees with the parser's reading.
 */
export function checkReading(doc: SourceDocument, raw: unknown): CheckedReading {
  const answer = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = textOf(doc);
  const parsed = parseDocument(doc)?.statements ?? [];
  const parsedTag = contractTagOf(parsed);
  const parserSays = new Map(parsed.map((s) => [slotOf(s), canon(s.value)]));
  const reading: Record<string, unknown> = {};
  const dropped: { field: ReadingField; why: string }[] = [];
  for (const field of FIELDS) {
    const rawValue = answer[field];
    if (rawValue === undefined || rawValue === null) continue;
    const rule = RULES[field] as FieldRule<ReadingField>;
    const value = rule.shape(rawValue);
    if (value === undefined) {
      dropped.push({ field, why: 'not in the expected form' });
      continue;
    }
    if (!rule.inText(value, text)) {
      dropped.push({ field, why: 'not found in the document' });
      continue;
    }
    const disagrees =
      field === 'agreementNumber'
        ? parsedTag !== null && parsedTag !== normalizeTag(value as string)
        : rule.says(value).some((s) => parserSays.has(slotOf(s)) && parserSays.get(slotOf(s)) !== canon(s.value));
    if (disagrees) {
      dropped.push({ field, why: 'contradicts what the parser read' });
      continue;
    }
    reading[field] = value;
  }
  return { reading: reading as ContractReading, dropped };
}

/** What a contract document states: the parser's statements, plus what a checked reading adds. */
export function contractStatements(doc: SourceDocument, reading: ContractReading | null): readonly Statement[] {
  const parsed = parseDocument(doc)?.statements ?? [];
  if (!reading) return parsed;
  const tag = contractTagOf(parsed) ?? (reading.agreementNumber ? normalizeTag(reading.agreementNumber) : null);
  if (!tag) return parsed;
  const subject = { kind: 'contract', tag } as const;
  const have = new Set(parsed.map(slotOf));
  const added: Statement[] = [];
  for (const field of FIELDS) {
    const value = reading[field];
    if (value === undefined) continue;
    for (const s of (RULES[field] as FieldRule<ReadingField>).says(value as never)) {
      if (!have.has(slotOf(s))) added.push({ subject, field: s.field, value: s.value, source: 'contract-clauses' });
    }
  }
  if (added.length === 0) return parsed;
  return parsed.length > 0 ? [...parsed, ...added] : [{ subject, field: null, value: null, source: 'contract-clauses' }, ...added];
}
