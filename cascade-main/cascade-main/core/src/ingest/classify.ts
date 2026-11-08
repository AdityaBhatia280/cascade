// What kind of document an uploaded file is, and how to say what it holds. One table row per upload
// kind: the parser that reads it, its plain title, where it falls in the ingest order, the columns
// its export has, and the file names it usually goes by.

import type { UploadKind } from '../contract.js';
import type { Facility } from '../facility/facility.js';
import { sourceDocument, type SourceDocument, type Statement } from './documents.js';
import { contractStatements, type ContractReading } from './reading.js';
import { normalizeTag, parseDocument, parserFor, PARSERS, registerAssets, type ParserId } from './sources.js';

interface KindSpec {
  readonly parser: ParserId | null;
  readonly title: string;
  /** Ingest order: the register names the equipment, monitoring and the roster hang off it, contracts reference cabinets, work orders reference assets. */
  readonly order: number;
  /** The export's header row as the parser knows it (lowercase); null for documents without columns. */
  readonly columns: readonly string[] | null;
  readonly fileName: RegExp | null;
}

export const UPLOAD_KIND_SPECS: { readonly [K in UploadKind]: KindSpec } = {
  'equipment-register': {
    parser: 'equipment-register',
    title: 'Equipment register',
    order: 0,
    columns: ['asset_id', 'tag', 'asset_class', 'manufacturer_model', 'rating', 'fed_from', 'alt_source', 'system', 'location', 'status', 'notes'],
    fileName: /register|asset/i,
  },
  'bms-points': { parser: 'bms-points', title: 'BMS point list', order: 1, columns: null, fileName: /bms.*point|point.*list/i },
  'bms-event-log': {
    parser: 'desigo-event-log',
    title: 'BMS event log',
    order: 2,
    columns: ['system name', 'date/time', 'source description', 'record type', 'source property', 'event message text', 'event category', 'event time', 'event state', 'event cause', 'event id', 'log type', 'action', 'value', 'quality', 'previous value', 'previous quality', 'unit', 'source designation', 'discipline'],
    fileName: /desigo.*(event|log)|bms.*(event|alarm)/i,
  },
  'bms-trend': {
    parser: 'desigo-trend',
    title: 'BMS trend',
    order: 3,
    columns: ['date/time', 'source designation', 'source description', 'value', 'unit', 'quality'],
    fileName: /desigo.*trend|bms.*trend/i,
  },
  'pme-event-history': {
    parser: 'pme-event-history',
    title: 'Power monitoring events',
    order: 4,
    columns: ['id', 'source', 'timestamp', 'timestamp utc', 'event', 'condition', 'measurement', 'value', 'type', 'priority'],
    fileName: /pme.*event|power.*event/i,
  },
  'pme-export': {
    parser: 'pme-data-export',
    title: 'Power monitoring trend',
    order: 5,
    columns: ['timestamp utc', 'timestamp', 'value', 'source', 'measurement', 'unit'],
    fileName: /pme.*(data|export)/i,
  },
  'circuit-roster': {
    parser: 'circuit-roster',
    title: 'Circuit roster',
    order: 6,
    columns: ['acct', 'customer', 'cage', 'hall', 'row', 'cabinet', 'psu', 'cord', 'panel', 'ckt', 'poles', 'brkr_a', 'volts', 'phase', 'contract_kw', 'cab_kw_meas', 'ckt_kw_meas', 'notes'],
    fileName: /roster|circuit/i,
  },
  'contract-msa': { parser: 'contract-clauses', title: 'Master agreement', order: 7, columns: null, fileName: /msa|master.*agreement/i },
  'contract-order-form': { parser: 'contract-clauses', title: 'Contract', order: 8, columns: null, fileName: /order[\s_-]*form/i },
  'maximo-workorders': {
    parser: 'maximo-work-orders',
    title: 'Maximo work orders',
    order: 9,
    columns: ['wonum', 'description', 'location', 'assetnum', 'status', 'worktype', 'wopriority', 'schedstart', 'schedfinish', 'actstart', 'actfinish', 'reportdate', 'pmnum', 'jpnum', 'ownergroup', 'lead', 'vendor', 'siteid', 'orgid', 'statusdate'],
    fileName: /maximo|work[\s_-]*orders?/i,
  },
  unknown: { parser: null, title: 'Unrecognized file', order: 10, columns: null, fileName: null },
};

const KINDS = Object.keys(UPLOAD_KIND_SPECS) as UploadKind[];

const isOrderForm = (doc: SourceDocument) => doc.text.split(/\r?\n/, 12).some((l) => /^\s*ORDER FORM\b/i.test(l)) || /order[\s_-]*form/i.test(doc.path);

/** The kind whose parser reads this document as it is. */
function kindOfParser(doc: SourceDocument): UploadKind | null {
  const parser = parserFor(doc);
  if (!parser) return null;
  if (parser.id === 'contract-clauses') return isOrderForm(doc) ? 'contract-order-form' : 'contract-msa';
  return KINDS.find((k) => UPLOAD_KIND_SPECS[k].parser === parser.id) ?? null;
}

/** Without a model: the parser that accepts the document, else the file name, else unknown. */
export function classifyByRules(doc: SourceDocument): UploadKind {
  const byParser = kindOfParser(doc);
  if (byParser) return byParser;
  return KINDS.find((k) => UPLOAD_KIND_SPECS[k].fileName?.test(doc.path)) ?? 'unknown';
}

/** Whether the kind's parser reads this document as that kind. */
export function readsAs(kind: UploadKind, doc: SourceDocument): boolean {
  if (kind === 'unknown') return false;
  if (kind === 'contract-msa' || kind === 'contract-order-form') return kindOfParser(doc) === kind;
  return PARSERS.find((p) => p.id === UPLOAD_KIND_SPECS[kind].parser)?.accepts(doc) ?? false;
}

/**
 * Renames a CSV's header cells by `mapping` (expected column → the header the file uses). Null when a
 * mapped header is not in the file, or the mapping names a column the kind does not have.
 */
export function renameColumns(doc: SourceDocument, kind: UploadKind, mapping: Readonly<Record<string, string>>): SourceDocument | null {
  const expected = UPLOAD_KIND_SPECS[kind].columns;
  if (doc.format !== 'csv' || !expected) return null;
  const nl = doc.text.indexOf('\n');
  const headerLine = (nl < 0 ? doc.text : doc.text.slice(0, nl)).replace(/\r$/, '');
  const header = headerLine.split(',').map((h) => h.trim());
  const byActual = new Map<string, string>();
  for (const [want, actual] of Object.entries(mapping)) {
    if (!expected.includes(want.toLowerCase())) return null;
    const i = header.findIndex((h) => h.toLowerCase() === actual.trim().toLowerCase());
    if (i < 0) return null;
    byActual.set(header[i]!, want.toLowerCase());
  }
  const renamed = header.map((h) => byActual.get(h) ?? h).join(',');
  return sourceDocument({ path: doc.path, format: doc.format, text: `${renamed}${nl < 0 ? '' : doc.text.slice(nl).replace(/^\r?\n/, '\n')}` });
}

// ───────────────────────────── what a document holds, in plain words ─────────────────────────────

export interface UploadSummary {
  readonly title: string;
  readonly detail: string;
  readonly customer: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** ["E02", "E01", "E03", "B07"] → "B07, E01–E03". */
function cabinetRanges(tags: readonly string[]): string {
  const sorted = [...new Set(tags)].sort();
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    const letter = (t: string) => t.replace(/\d+$/, '');
    const n = (t: string) => Number(/(\d+)$/.exec(t)?.[1]);
    while (j + 1 < sorted.length && letter(sorted[j + 1]!) === letter(sorted[i]!) && n(sorted[j + 1]!) === n(sorted[j]!) + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : sorted[i]!);
    i = j + 1;
  }
  return out.join(', ');
}

const distinct = (statements: readonly Statement[], kind?: string) => new Set(statements.filter((s) => !kind || s.subject.kind === kind).map((s) => `${s.subject.kind}:${normalizeTag(s.subject.tag)}`)).size;

function termOf<T extends string>(statements: readonly Statement[], term: T): Record<string, unknown> | undefined {
  return statements.find((s) => s.field === 'terms' && (s.value as { term?: unknown }).term === term)?.value as Record<string, unknown> | undefined;
}

/** Title, detail and customer for an ingested document of `kind`, from what it states. */
export function uploadSummary(kind: UploadKind, doc: SourceDocument, reading: ContractReading | null, facility: Facility): UploadSummary {
  const spec = UPLOAD_KIND_SPECS[kind];
  const parsed = parseDocument(doc);
  const plain = (detail: string): UploadSummary => ({ title: spec.title, detail, customer: null });
  switch (kind) {
    case 'equipment-register':
      return plain(plural(registerAssets(doc).length, 'asset'));
    case 'bms-points':
      return plain(plural(distinct(parsed?.statements ?? []), 'monitored device'));
    case 'circuit-roster': {
      const s = parsed?.statements ?? [];
      return plain(`${plural(distinct(s, 'cord'), 'cord')} · ${plural(distinct(s, 'customer'), 'customer')}`);
    }
    case 'maximo-workorders':
      return plain(plural(parsed?.workOrders.length ?? 0, 'work order'));
    case 'bms-event-log':
    case 'pme-event-history':
      return plain(plural(parsed?.events.length ?? 0, 'event'));
    case 'bms-trend':
    case 'pme-export':
      return plain(plural(parsed?.trends.length ?? 0, 'trend series', 'trend series'));
    case 'contract-msa':
    case 'contract-order-form': {
      const s = contractStatements(doc, reading);
      const value = (field: string) => s.find((x) => x.field === field)?.value;
      const account = value('customer');
      const named = typeof account === 'string' ? facility.list('customer').find((c) => c.tag === normalizeTag(account))?.name : undefined;
      const customer = reading?.customerName ?? (named?.kind === 'known' ? named.value : null) ?? (typeof account === 'string' ? account : null);
      const fee = value('monthlyFeeUsd');
      const cabinets = value('cabinets');
      const power = termOf(s, 'power-redundancy');
      const availability = termOf(s, 'availability');
      const notice = termOf(s, 'maintenance-notice');
      const parts =
        kind === 'contract-order-form'
          ? [
              typeof fee === 'number' ? `${usd(fee)}/mo` : null,
              Array.isArray(cabinets) ? cabinetRanges(cabinets as string[]) : null,
              power ? `${String(power['level'])} power` : null,
            ]
          : [availability ? `${String(availability['pct'])}% availability` : null, notice ? `${String(notice['businessDays'])} business days notice` : null];
      return { title: customer ? `${spec.title} · ${customer}` : spec.title, detail: parts.filter(Boolean).join(' · '), customer };
    }
    case 'unknown':
      return plain('');
  }
}
