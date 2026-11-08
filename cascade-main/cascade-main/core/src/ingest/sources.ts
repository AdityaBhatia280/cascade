// Knowledge of each source format: one deterministic parser per document family. Parsers produce
// plain values (Statement[]) and records; assembly turns statements into facts.

import { WORK_ORDER_STATUSES, WORK_TYPES, type EntityKind, type WorkOrderStatus, type WorkType } from '../contract.js';
import type { AlarmLimit, EventPhase, EventRecord, HistorySystem, TrendSample, TrendSeries } from '../history/history.js';
import type { LocalDateTime, WorkOrderRecord } from '../maintenance/work-orders.js';
import type { SourceDocument, Statement } from './documents.js';

/**
 * What one document says. Statements are facts about the facility. Work orders, events, trends and
 * alarm limits are records about it (work done, what the BMS and power monitoring logged), kept apart so
 * history never becomes topology.
 */
export interface ParseResult {
  readonly statements: readonly Statement[];
  readonly workOrders: readonly WorkOrderRecord[];
  readonly events: readonly EventRecord[];
  readonly trends: readonly TrendSeries[];
  readonly limits: readonly AlarmLimit[];
  /** Rows/points the parser could not interpret. Surfaced as ingest warnings, never dropped silently. */
  readonly skipped: readonly { readonly where: string; readonly why: string }[];
}

const NO_RECORDS = { workOrders: [], events: [], trends: [], limits: [] } as const;

export type ParserId =
  | 'bms-points' | 'equipment-register' | 'circuit-roster' | 'contract-clauses' | 'maximo-work-orders'
  | 'desigo-event-log' | 'desigo-trend' | 'pme-event-history' | 'pme-data-export';

export interface Parser {
  readonly id: ParserId;
  accepts(doc: SourceDocument): boolean;
  parse(doc: SourceDocument): ParseResult;
}

/**
 * When documents give different values for one field, the source listed first wins: live
 * measurement beats paperwork. Within one source the first statement read wins.
 */
export const SOURCE_PRECEDENCE = ['bms-points', 'circuit-roster', 'equipment-register', 'contract-clauses'] as const satisfies readonly ParserId[];
export type FactSource = (typeof SOURCE_PRECEDENCE)[number];

// ───────────────────────────── Tags ─────────────────────────────

/**
 * The one tag canonicalization used by every parser (and by assembly when it keys subjects).
 * "PDU-3B" ≡ "PDU 3B" ≡ "PDU3B" ≡ "pdu_3b"; "CRAH-05" ≡ "CRAH-5"; "SWGR-B CB-3" ≡ "SWGR-B-CB3".
 * "/" separates compound identities (cord "D03/B", circuit "RPP-3B/13") and is preserved.
 * A digit run right after a hyphen or "/" loses leading zeros; one glued to a single letter
 * ("D03", "C1041") is kept as written, so cabinet and account numbers stay recognizable.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[‐-―]/g, '-')
    .split('/')
    .map((seg) =>
      seg
        .replace(/[\s_.]+/g, '-')
        .replace(/([A-Z]{2,})(?=\d)/g, '$1-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .replace(/(^|-)0+(?=\d)/g, '$1'),
    )
    .join('/');
}

const cordTag = (cabinet: string, side: 'A' | 'B') => `${normalizeTag(cabinet)}/${side}`;
const circuitTag = (panel: string, position: number) => `${normalizeTag(panel)}/${position}`;

// ───────────────────────────── Shared value readers ─────────────────────────────
// Each reader takes the source text of one cell/property and returns the domain-shaped raw value,
// or undefined when the text is not recognizable.

type Read<V> = V | undefined;

type RawRating =
  | { readonly unit: 'kw'; readonly kw: number }
  | { readonly unit: 'kva'; readonly kva: number }
  | { readonly unit: 'amps'; readonly amps: number; readonly volts: number; readonly phases: 1 | 3 };

const num = (s: string) => Number(s.replace(/,/g, ''));
const TR_TO_KW = 3.517;
const round1 = (x: number) => Math.round(x * 10) / 10;

function readRating(text: string): Read<RawRating> {
  const kva = /(\d[\d,]*(?:\.\d+)?)\s*kVA\b/i.exec(text);
  if (kva) return { unit: 'kva', kva: num(kva[1]!) };
  const amps = /(\d[\d,]*)\s*A\b[^\d]*?(\d{3})\s*V\b[^\d]*?([13])\s*-?\s*(PH|P|Ø|PHASE|POLE)/i.exec(text);
  if (amps) return { unit: 'amps', amps: num(amps[1]!), volts: num(amps[2]!), phases: amps[3] === '1' ? 1 : 3 };
  const kw = /(\d[\d,]*(?:\.\d+)?)\s*kW\b/i.exec(text);
  if (kw) return { unit: 'kw', kw: num(kw[1]!) };
  return undefined;
}

/** Cooling capacity in kW (thermal). Tons of refrigeration are a fixed physical conversion, not an assumption. */
function readCapacityKw(text: string): Read<number> {
  const kw = /(\d[\d,]*(?:\.\d+)?)\s*kW\b/i.exec(text);
  if (kw) return num(kw[1]!);
  const tr = /(\d[\d,]*(?:\.\d+)?)\s*(?:TR|tons?)\b/i.exec(text);
  if (tr) return round1(num(tr[1]!) * TR_TO_KW);
  return undefined;
}

/**
 * A reference cell: the device it names nearest the subject. "SWGR-B CB-3 (via MCC-B)",
 * "SWGR-A CB-4 (MP-A)" and "SWGR-B CB-6 via XFMR-5B" route through the tag in the aside, so that
 * is the feeder; any other parenthetical is a remark.
 */
function readRef(text: string): Read<string> {
  const through = /\(\s*(?:via\s+)?([A-Z][A-Z0-9]*-[A-Z0-9-]+)\s*\)|\s+via\s+(\S+)\s*$/i.exec(text);
  const head = through ? (through[1] ?? through[2]!) : text.replace(/\(.*?\)/g, '').trim();
  if (!head || /^(n\/?a|none|-+)$/i.test(head)) return undefined;
  return normalizeTag(head);
}

/** Like readRef, but a documented "none" / "N/A" is itself a fact (no bypass, no alternate). */
function readNullableRef(text: string): Read<string | null> {
  return /^\s*(none|n\/a)\b/i.test(text) ? null : readRef(text);
}

function readSide(text: string): Read<'A' | 'B'> {
  const m = /^\s*([AB])\s*$/i.exec(text);
  if (!m) return undefined;
  return m[1]!.toUpperCase() === 'A' ? 'A' : 'B';
}

function readNumber(text: string): Read<number> {
  const m = /^\s*(-?\d[\d,]*(?:\.\d+)?)\s*$/.exec(text);
  return m ? num(m[1]!) : undefined;
}

type RawPlacement =
  | { readonly at: 'row-end'; readonly row: string; readonly end: 'start' | 'end' }
  | { readonly at: 'grid'; readonly hall: string; readonly x: number; readonly z: number }
  | { readonly at: 'room'; readonly room: string };

function readPlacement(text: string): Read<RawPlacement> {
  const rowEnd = /(Row\s+([A-Z]))\s+(start|end)\b/i.exec(text);
  if (rowEnd) return { at: 'row-end', row: `ROW-${rowEnd[2]!.toUpperCase()}`, end: rowEnd[3]!.toLowerCase() === 'start' ? 'start' : 'end' };
  const grid = /^(DH-?\s*\d+).*?grid\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/i.exec(text);
  if (grid) return { at: 'grid', hall: normalizeTag(grid[1]!), x: num(grid[2]!), z: num(grid[3]!) };
  const room = text.trim();
  return room ? { at: 'room', room } : undefined;
}

function readHallPrefix(text: string): Read<string> {
  const m = /^\s*(DH-?\s*\d+)\b/i.exec(text);
  return m ? normalizeTag(m[1]!) : undefined;
}

type RawIntent = { readonly scheme: 'N' } | { readonly scheme: 'N+K'; readonly k: number } | { readonly scheme: '2N' };

function readIntent(text: string): Read<RawIntent> {
  const m = /\b(2N|N\+(\d+))(?![\w+])/.exec(text);
  if (!m) return undefined;
  return m[1] === '2N' ? { scheme: '2N' } : { scheme: 'N+K', k: Number(m[2]) };
}

const regexReader =
  <V>(re: RegExp, make: (m: RegExpExecArray) => V) =>
  (text: string): Read<V> => {
    const m = re.exec(text);
    return m ? make(m) : undefined;
  };

const readStartDelaySec = regexReader(/start(?:\/transfer)?\s+(\d+(?:\.\d+)?)\s*s\b/i, (m) => num(m[1]!));
const readBatteryMin = regexReader(/(\d+(?:\.\d+)?)\s*min\b/i, (m) => num(m[1]!));
const readRole = regexReader(/\b(duty|lead|standby)\b/i, (m): 'duty' | 'standby' => (m[1]!.toLowerCase() === 'standby' ? 'standby' : 'duty'));
const readSizedForKw = regexReader(/sized for\s+(\d[\d,]*(?:\.\d+)?)\s*kW\b/i, (m) => num(m[1]!));
const readMaxInletC = regexReader(/max inlet\s+(\d+(?:\.\d+)?)\s*°?\s*C\b/i, (m) => num(m[1]!));

function readDimensions(text: string): Read<{ width: number; depth: number }> {
  const m = /(\d+(?:\.\d+)?)\s*m\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\b/i.exec(text);
  return m ? { width: num(m[1]!), depth: num(m[2]!) } : undefined;
}

function readCoolingIntent(text: string): Read<RawIntent> {
  const m = /cooling[^;]*?\b(2N|N\+(\d+))(?![\w+])/i.exec(text);
  if (!m) return undefined;
  return m[1]!.toUpperCase() === '2N' ? { scheme: '2N' } : { scheme: 'N+K', k: Number(m[2]) };
}

// ───────────────────────────── Statements ─────────────────────────────

interface Emitter {
  readonly statements: Statement[];
  readonly skipped: { where: string; why: string }[];
  emit(kind: EntityKind, tag: string, field: string, value: unknown): void;
  exists(kind: EntityKind, tag: string): void;
}

function emitter(source: FactSource): Emitter {
  const statements: Statement[] = [];
  const skipped: { where: string; why: string }[] = [];
  return {
    statements,
    skipped,
    emit: (kind, tag, field, value) => void statements.push({ subject: { kind, tag }, field, value, source }),
    exists: (kind, tag) => void statements.push({ subject: { kind, tag }, field: null, value: null, source }),
  };
}

// ───────────────────────────── CSV ─────────────────────────────

interface CsvRow {
  /** 1-based line in the file. */
  readonly line: number;
  readonly cells: ReadonlyMap<string, string>;
}

function splitCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (quoted) return null;
  out.push(cur);
  return out;
}

function parseCsv(text: string): { readonly header: readonly string[]; readonly rows: readonly CsvRow[]; readonly bad: readonly number[] } {
  const lines = text.split(/\r?\n/);
  const header = (splitCsvLine(lines[0] ?? '') ?? []).map((h) => h.trim().toLowerCase());
  const rows: CsvRow[] = [];
  const bad: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);
    if (!cells) {
      bad.push(i + 1);
      continue;
    }
    rows.push({ line: i + 1, cells: new Map(header.map((h, j) => [h, (cells[j] ?? '').trim()])) });
  }
  return { header, rows, bad };
}

const csvHeader = (doc: SourceDocument): readonly string[] =>
  doc.format === 'csv' ? (splitCsvLine(doc.text.split(/\r?\n/)[0] ?? '') ?? []).map((h) => h.trim().toLowerCase()) : [];

/** A non-empty cell's text, or null. */
const cellAt = (r: CsvRow, column: string): string | null => r.cells.get(column) || null;

// ───────────────────────────── Equipment register (CMMS export) ─────────────────────────────

const ASSET_CLASS: readonly (readonly [RegExp, EntityKind])[] = [
  [/^utility/i, 'utility'],
  [/^generator|^genset/i, 'generator'],
  [/^ats\b|automatic transfer/i, 'ats'],
  [/switchgear|switchboard/i, 'switchgear'],
  [/breaker|^acb\b|^mccb\b/i, 'breaker'],
  [/motor control|^mcc\b|panelboard|mech(?:anical)? panel/i, 'panel'],
  [/transformer|^xfmr\b/i, 'transformer'],
  [/^ups\b/i, 'ups'],
  [/^pdu\b|power distribution unit/i, 'pdu'],
  [/^rpp\b|remote power panel/i, 'rpp'],
  [/^chiller/i, 'chiller'],
  [/header/i, 'header'],
  [/loop/i, 'loop'],
  [/pump/i, 'pump'],
  [/^crah\b|computer room air handler/i, 'crah'],
  [/data hall/i, 'hall'],
];

const kindOfAssetClass = (cls: string): EntityKind | null => ASSET_CLASS.find(([re]) => re.test(cls))?.[1] ?? null;

type CellReader = (text: string) => Read<unknown>;
type ColumnRules = readonly (readonly [column: string, field: string, read: CellReader])[];

const sideFromSystem: ColumnRules = [['system', 'labelledSide', readSide]];

/** Which register column states which entity field, per kind. A kind absent here only exists. */
const REGISTER_FIELDS: { readonly [K in EntityKind]?: ColumnRules } = {
  utility: [['rating', 'rating', readRating]],
  generator: [['rating', 'rating', readRating], ['notes', 'startDelaySec', readStartDelaySec]],
  ats: [['rating', 'rating', readRating], ['fed_from', 'normal', readRef], ['alt_source', 'alternate', readRef]],
  switchgear: [['rating', 'rating', readRating], ['fed_from', 'input', readRef], ...sideFromSystem],
  breaker: [['rating', 'rating', readRating], ['fed_from', 'bus', readRef]],
  ups: [['rating', 'rating', readRating], ['fed_from', 'input', readRef], ['alt_source', 'bypass', readNullableRef], ['notes', 'batteryMin', readBatteryMin], ...sideFromSystem],
  pdu: [['rating', 'rating', readRating], ['fed_from', 'input', readRef], ['location', 'placement', readPlacement], ...sideFromSystem],
  transformer: [['rating', 'rating', readRating], ['fed_from', 'input', readRef]],
  rpp: [['rating', 'rating', readRating], ['fed_from', 'input', readRef], ['location', 'placement', readPlacement], ...sideFromSystem],
  panel: [['rating', 'rating', readRating], ['fed_from', 'input', readRef]],
  chiller: [['rating', 'capacityKw', readCapacityKw], ['fed_from', 'power', readRef], ['system', 'header', readRef], ['notes', 'role', readRole]],
  header: [['system', 'loop', readRef]],
  loop: [['notes', 'intent', readIntent]],
  pump: [['fed_from', 'power', readRef], ['system', 'loop', readRef], ['notes', 'capacityKw', readSizedForKw]],
  crah: [['rating', 'capacityKw', readCapacityKw], ['fed_from', 'power', readRef], ['system', 'loop', readRef], ['location', 'hall', readHallPrefix], ['location', 'placement', readPlacement]],
  hall: [['notes', 'dimensionsM', readDimensions], ['notes', 'coolingIntent', readCoolingIntent], ['notes', 'maxInletC', readMaxInletC]],
};

/**
 * A panel with no register row of its own, named in its feeder breaker's notes
 * ("MP-A mech panel: CRAH-01/03/05/07"). The units' fed_from cells route through it.
 */
const readPanelInNote = regexReader(/^\s*([A-Z][A-Z0-9]*-[A-Z0-9]+)\s+(?:mech(?:anical)?\s+panel|panelboard)\b/i, (m) => normalizeTag(m[1]!));

/** Free-text columns are parsed by regex; an unreadable one is not worth a warning. */
const FREE_TEXT_COLUMNS = new Set(['notes', 'location']);

const equipmentRegister: Parser = {
  id: 'equipment-register',
  accepts: (doc) => {
    const h = csvHeader(doc);
    return h.includes('tag') && h.includes('asset_class');
  },
  parse(doc) {
    const out = emitter('equipment-register');
    const csv = parseCsv(doc.text);
    for (const line of csv.bad) out.skipped.push({ where: `line ${line}`, why: 'unbalanced quotes' });
    for (const r of csv.rows) {
      const where = `line ${r.line}`;
      const tagCell = cellAt(r, 'tag');
      if (!tagCell) {
        out.skipped.push({ where, why: 'no tag' });
        continue;
      }
      if (/retired|decommissioned|removed/i.test(r.cells.get('status') ?? '')) {
        out.skipped.push({ where, why: `${tagCell}: status ${r.cells.get('status')}` });
        continue;
      }
      const kind = kindOfAssetClass(r.cells.get('asset_class') ?? '');
      if (!kind) {
        out.skipped.push({ where, why: `${tagCell}: asset class "${r.cells.get('asset_class')}" is not modeled` });
        continue;
      }
      const tag = normalizeTag(tagCell);
      out.exists(kind, tag);
      for (const [column, field, read] of REGISTER_FIELDS[kind] ?? []) {
        const cell = cellAt(r, column);
        if (!cell) continue;
        const value = read(cell);
        if (value === undefined) {
          if (!FREE_TEXT_COLUMNS.has(column)) out.skipped.push({ where: `${where} ${column}`, why: `${tagCell}: cannot read ${field} from "${cell}"` });
          continue;
        }
        out.emit(kind, tag, field, value);
      }
      const panel = kind === 'breaker' ? readPanelInNote(r.cells.get('notes') ?? '') : undefined;
      if (panel) out.emit('panel', panel, 'input', tag);
    }
    return { statements: out.statements, ...NO_RECORDS, skipped: out.skipped };
  },
};

/** One register row as an asset record, so other CMMS exports that cite ASSETNUM can be joined to it. */
export interface RegisterAsset {
  readonly assetNum: string;
  /** Normalized tag, as the register parser names the subject. */
  readonly tag: string;
  readonly assetClass: string;
  /** The kind the model gives this class; null when the model does not include the class. */
  readonly kind: EntityKind | null;
  readonly status: string;
}

/** Every asset row of an equipment register (retired and unmodeled ones too); [] for other documents. */
export function registerAssets(doc: SourceDocument): readonly RegisterAsset[] {
  if (!equipmentRegister.accepts(doc)) return [];
  return parseCsv(doc.text).rows.flatMap((r) => {
    const assetNum = r.cells.get('asset_id') ?? '';
    const tag = r.cells.get('tag') ?? '';
    if (!assetNum || !tag) return [];
    const assetClass = r.cells.get('asset_class') ?? '';
    return [{ assetNum, tag: normalizeTag(tag), assetClass, kind: kindOfAssetClass(assetClass), status: r.cells.get('status') ?? '' }];
  });
}

// ───────────────────────────── Circuit roster ─────────────────────────────

const ROSTER_COLUMNS = ['acct', 'cabinet', 'cord', 'panel', 'ckt'] as const;

function readPhases(text: string): Read<1 | 3> {
  const m = /^\s*([13])/.exec(text);
  return m ? (m[1] === '1' ? 1 : 3) : undefined;
}

const circuitRoster: Parser = {
  id: 'circuit-roster',
  accepts: (doc) => {
    const h = csvHeader(doc);
    return ROSTER_COLUMNS.every((c) => h.includes(c));
  },
  parse(doc) {
    const out = emitter('circuit-roster');
    const csv = parseCsv(doc.text);
    for (const line of csv.bad) out.skipped.push({ where: `line ${line}`, why: 'unbalanced quotes' });
    for (const r of csv.rows) {
      const where = `line ${r.line}`;
      const c = (col: string) => cellAt(r, col);
      const acct = c('acct');
      const cab = c('cabinet');
      const cord = c('cord');
      if (!acct || !cab || !cord) {
        out.skipped.push({ where, why: 'missing acct / cabinet / cord' });
        continue;
      }
      const customer = normalizeTag(acct);
      const cabinet = normalizeTag(cab);
      const side = readSide(cord);
      if (!side) {
        out.skipped.push({ where, why: `cord side "${cord}" is not A or B` });
        continue;
      }

      out.exists('customer', customer);
      const name = c('customer');
      if (name) out.emit('customer', customer, 'name', name);

      out.emit('cabinet', cabinet, 'customer', customer);
      const slot = /(\d+)\s*$/.exec(cab);
      if (slot) out.emit('cabinet', cabinet, 'slot', Number(slot[1]));
      const cabKw = c('cab_kw_meas');
      const cabKwValue = cabKw === null ? undefined : readNumber(cabKw);
      if (cabKwValue !== undefined) out.emit('cabinet', cabinet, 'measuredKw', cabKwValue);
      const psu = c('psu');
      if (psu && /^(dual|single)$/i.test(psu)) out.emit('cabinet', cabinet, 'dualPsu', psu.toLowerCase() === 'dual');

      const row = c('row');
      const hall = c('hall');
      if (row && /^[A-Z]$/i.test(row)) {
        const rowTag = `ROW-${row.toUpperCase()}`;
        out.emit('cabinet', cabinet, 'row', rowTag);
        out.emit('row', rowTag, 'index', row.toUpperCase().charCodeAt(0) - 64);
        if (hall) {
          out.exists('hall', normalizeTag(hall));
          out.emit('row', rowTag, 'hall', normalizeTag(hall));
        }
      }

      const cordId = cordTag(cab, side);
      out.emit('cord', cordId, 'labelledSide', side);

      const panel = c('panel');
      const ckt = c('ckt');
      const pos = ckt && /(\d+)/.exec(ckt);
      if (!panel || !ckt || !pos) {
        out.skipped.push({ where, why: `${cordId}: no panel / circuit position` });
        continue;
      }
      const position = Number(pos[1]);
      const circuit = circuitTag(panel, position);
      out.emit('cord', cordId, 'circuit', circuit);
      out.emit('circuit', circuit, 'panel', normalizeTag(panel));
      out.emit('circuit', circuit, 'position', String(position));

      const a = /^(\d+)\s*A?$/i.exec(c('brkr_a') ?? '');
      const v = /^(\d{3})\s*V?$/i.exec(c('volts') ?? '');
      const phase = c('phase');
      const ph = phase === null ? undefined : readPhases(phase);
      if (a && v && ph) out.emit('circuit', circuit, 'rating', { unit: 'amps', amps: Number(a[1]), volts: Number(v[1]), phases: ph });
      else out.skipped.push({ where, why: `${circuit}: breaker amps / volts / phase not readable` });

      const cktKw = c('ckt_kw_meas');
      const cktKwValue = cktKw === null ? undefined : readNumber(cktKw);
      if (cktKwValue !== undefined) out.emit('circuit', circuit, 'measuredKw', cktKwValue);
      else if (cktKw) out.skipped.push({ where: `${where} ckt_kw_meas`, why: `${circuit}: measured kW "${cktKw}" is not a number` });
    }
    return { statements: out.statements, ...NO_RECORDS, skipped: out.skipped };
  },
};

// ───────────────────────────── BMS point table (JSON) ─────────────────────────────
// A Desigo CC point table: one row per BACnet object, named by its designation (the name the event
// log and trends print), with the equipment it belongs to, object type and instance, units and alarm
// limits. Nameplate and topology are not point properties. The facts it states are the ones its
// labels carry: which cord a branch-circuit channel meters (or SPARE) and the breaker size, and a
// rating an integrator typed into a description ("PDU 2B Output kW (225 kVA)").

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObj = (j: Json | undefined): j is { [k: string]: Json } => typeof j === 'object' && j !== null && !Array.isArray(j);
const asArray = (j: Json | undefined): readonly Json[] => (Array.isArray(j) ? j : []);

/** The point table's equipment types the model represents. Others (outdoor air, plant) carry telemetry only. */
const BMS_EQUIPMENT_KIND: Readonly<Record<string, EntityKind>> = {
  chiller: 'chiller', pump: 'pump', crah: 'crah', 'chw loop': 'loop', 'data hall': 'hall',
  ups: 'ups', pdu: 'pdu', rpp: 'rpp', switchboard: 'switchgear', breaker: 'breaker',
};
/** Kinds whose rating a description label states, and the unit it must be stated in. */
const LABELLED_RATING: { readonly [K in EntityKind]?: RawRating['unit'] } = { ups: 'kva', pdu: 'kva', breaker: 'amps' };
/** Panels whose branch-circuit channels are named "CB<n>_..." in the designation's last part. */
const PANEL_KINDS: ReadonlySet<EntityKind> = new Set(['pdu', 'rpp']);
const BMS_SECTIONS = new Set(['export', 'devices', 'points']);

const bmsPoints: Parser = {
  id: 'bms-points',
  accepts: (doc) => doc.format === 'json' && /"points"\s*:/.test(doc.text) && /"object_type"\s*:/.test(doc.text),
  parse(doc) {
    const out = emitter('bms-points');
    let root: Json;
    try {
      root = JSON.parse(doc.text) as Json;
    } catch (e) {
      return { statements: [], ...NO_RECORDS, skipped: [{ where: 'document', why: (e as Error).message }] };
    }
    if (!isObj(root)) return { statements: [], ...NO_RECORDS, skipped: [{ where: 'document', why: 'top level is not an object' }] };

    const limits: AlarmLimit[] = [];
    asArray(root['points']).forEach((p, idx) => {
      const where = `/points/${idx}`;
      if (!isObj(p) || typeof p['designation'] !== 'string' || typeof p['equipment'] !== 'string') {
        out.skipped.push({ where, why: 'point has no designation or equipment' });
        return;
      }
      const designation = p['designation'];
      const description = typeof p['description'] === 'string' ? p['description'] : '';
      const unit = typeof p['units'] === 'string' ? p['units'] : '';
      for (const bound of ['high', 'low'] as const) {
        const value = p[`${bound}_limit`];
        if (typeof value === 'number') limits.push({ system: 'bms', source: designation, bound, value, unit });
      }

      const kind = BMS_EQUIPMENT_KIND[String(p['equipment_type'] ?? '').trim().toLowerCase()];
      if (!kind) return;
      const tag = normalizeTag(p['equipment']);
      out.exists(kind, tag);

      const channel = PANEL_KINDS.has(kind) ? /^CB(\d+)_/i.exec(designation.split('.').pop()!) : null;
      if (!channel) {
        const rating = LABELLED_RATING[kind] ? readRating(description) : undefined;
        if (rating && rating.unit === LABELLED_RATING[kind]) out.emit(kind, tag, 'rating', rating);
        return;
      }
      const circuit = circuitTag(p['equipment'], Number(channel[1]));
      out.emit('circuit', circuit, 'panel', tag);
      out.emit('circuit', circuit, 'position', String(Number(channel[1])));
      const rating = readRating(description);
      if (rating?.unit === 'amps') out.emit('circuit', circuit, 'rating', rating);
      const cord = /\bCab(?:inet)?\s+([A-Z]\d{2})\s+Cord\s+([AB])\b/i.exec(description);
      if (cord) {
        const side = cord[2]!.toUpperCase() === 'A' ? 'A' : 'B';
        out.emit('cord', cordTag(cord[1]!, side), 'labelledSide', side);
        out.emit('cord', cordTag(cord[1]!, side), 'circuit', circuit);
      } else if (!/\bSPARE\b/i.test(description)) {
        out.skipped.push({ where, why: `${circuit}: "${description}" names no cabinet cord and is not marked SPARE` });
      }
    });

    for (const key of Object.keys(root)) if (!BMS_SECTIONS.has(key)) out.skipped.push({ where: `/${key}`, why: 'section not understood by bms-points' });
    return { statements: out.statements, ...NO_RECORDS, limits, skipped: out.skipped };
  },
};

// ───────────────────────────── Contract clauses (MSA / order form text) ─────────────────────────────
// Deliberately conservative: a clause is read only when the whole statement sits on one line in a
// recognized form. Anything else (wrapped clauses, prose variants) is not read. A PDF's text layer
// reads the same way: its extractor puts each paragraph and table row on one line, under a letterhead.

type RawTerm =
  | { readonly term: 'power-redundancy'; readonly level: '2N' | 'A+B' | 'N+1' | 'N' }
  | { readonly term: 'cooling-redundancy'; readonly level: 'N+1' | 'N' }
  | { readonly term: 'committed-kw'; readonly cabinet: string; readonly kw: number }
  | { readonly term: 'availability'; readonly pct: number; readonly excludesMaintenance: boolean }
  | { readonly term: 'maintenance-notice'; readonly businessDays: number };

/** "A01-A10; B01" (hyphen, en dash, "through" or "to") → normalized cabinet tags; undefined when any part is not a cabinet or range. */
export function expandCabinets(list: string): Read<string[]> {
  const out: string[] = [];
  for (const part of list.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const range = /^([A-Z])(\d+)\s*(?:-|–|through|to)\s*([A-Z])(\d+)$/i.exec(part);
    if (range) {
      const [, l1, n1, l2, n2] = range;
      if (l1!.toUpperCase() !== l2!.toUpperCase() || Number(n2) < Number(n1)) return undefined;
      for (let n = Number(n1); n <= Number(n2); n++) out.push(normalizeTag(`${l1}${String(n).padStart(n1!.length, '0')}`));
      continue;
    }
    if (!/^[A-Z]\d+$/i.test(part)) return undefined;
    out.push(normalizeTag(part));
  }
  return out.length ? out : undefined;
}

const CONTRACT_ID = [/^\s*MASTER SERVICES AGREEMENT\s+No\.?\s*([A-Z0-9-]+)/i, /under Master Services Agreement\s+No\.?\s*([A-Z0-9-]+)/i];
/** The agreement number sits in the first lines, below a letterhead when there is one. */
const HEADER_LINES = 12;
const headerOf = (text: string) => text.split(/\r?\n/).slice(0, HEADER_LINES);

interface ClauseRule {
  readonly re: RegExp;
  readonly field: string;
  readonly make: (m: RegExpExecArray) => Read<unknown>;
}

const CLAUSES: readonly ClauseRule[] = [
  { re: /\bAccount:?\s*(?:No\.?\s*)?(C\d{3,})\b/i, field: 'customer', make: (m) => normalizeTag(m[1]!) },
  { re: /Monthly Recurring Charge[^$]*\$\s*(\d[\d,]*(?:\.\d{2})?)/i, field: 'monthlyFeeUsd', make: (m) => num(m[1]!) },
  { re: /Licensed Cabinets:\s*(.+?)\s*$/i, field: 'cabinets', make: (m) => expandCabinets(m[1]!) },
  {
    re: /Power Redundancy:\s*(2N|A\+B|N\+1|N)(?![\w+])/i,
    field: 'terms',
    make: (m) => ({ term: 'power-redundancy', level: m[1]!.toUpperCase() as '2N' | 'A+B' | 'N+1' | 'N' }) satisfies RawTerm,
  },
  {
    re: /Cooling Redundancy:\s*(N\+1|N)(?![\w+])/i,
    field: 'terms',
    make: (m) => ({ term: 'cooling-redundancy', level: m[1]!.toUpperCase() as 'N+1' | 'N' }) satisfies RawTerm,
  },
  {
    re: /^\s*([A-Z]\d{2})\s{2,}\S.*?\s(\d+(?:\.\d+)?)\s*kW\s*$/,
    field: 'terms',
    make: (m) => ({ term: 'committed-kw', cabinet: normalizeTag(m[1]!), kw: num(m[2]!) }) satisfies RawTerm,
  },
  {
    re: /Availability\b.*?\b(\d{2}(?:\.\d+)?)%.*?\b(excluding|including)\s+Scheduled Maintenance/i,
    field: 'terms',
    make: (m) => ({ term: 'availability', pct: num(m[1]!), excludesMaintenance: m[2]!.toLowerCase() === 'excluding' }) satisfies RawTerm,
  },
  {
    re: /at least\s+(?:[a-z]+\s+)?\(?(\d+)\)?\s+business days'?\s+(?:prior\s+)?(?:written\s+)?notice of Scheduled Maintenance/i,
    field: 'terms',
    make: (m) => ({ term: 'maintenance-notice', businessDays: num(m[1]!) }) satisfies RawTerm,
  },
];

const contractClauses: Parser = {
  id: 'contract-clauses',
  accepts: (doc) => (doc.format === 'text' || doc.format === 'pdf') && headerOf(doc.text).some((line) => CONTRACT_ID.some((re) => re.test(line))),
  parse(doc) {
    const out = emitter('contract-clauses');
    const lines = doc.text.split(/\r?\n/);
    let contract: string | null = null;
    for (let i = 0; i < Math.min(lines.length, HEADER_LINES) && !contract; i++) {
      for (const re of CONTRACT_ID) {
        const m = re.exec(lines[i]!);
        if (m) contract = normalizeTag(m[1]!);
      }
    }
    if (!contract) return { statements: [], ...NO_RECORDS, skipped: [{ where: 'document', why: 'no agreement number in the header' }] };
    out.exists('contract', contract);
    lines.forEach((text, i) => {
      for (const rule of CLAUSES) {
        const m = rule.re.exec(text);
        if (!m) continue;
        const value = rule.make(m);
        if (value === undefined) {
          out.skipped.push({ where: `line ${i + 1}`, why: `clause for ${rule.field} not in a recognized form` });
          continue;
        }
        out.emit('contract', contract, rule.field, value);
      }
    });
    return { statements: out.statements, ...NO_RECORDS, skipped: out.skipped };
  },
};

// ───────────────────────────── Maximo work order export ─────────────────────────────
// A Work Order Tracking list download: attribute names as headers, times in the site's local time
// as Maximo prints them ("11/10/2026 02:00 PM"). One record per row; a row that cannot be read is
// skipped with the reason, never guessed.

const MAXIMO_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i;

/** "" is a blank date (null); unreadable text is undefined. */
function readMaximoTime(text: string): LocalDateTime | null | undefined {
  if (!text) return null;
  const m = MAXIMO_TIME.exec(text);
  if (!m) return undefined;
  const [mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 1 || h > 12 || mi > 59) return undefined;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const h24 = (h % 12) + (m[6]!.toUpperCase() === 'PM' ? 12 : 0);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p2(mo)}-${p2(d)}T${p2(h24)}:${p2(mi)}`;
}

const isWorkOrderStatus = (s: string): s is WorkOrderStatus => (WORK_ORDER_STATUSES as readonly string[]).includes(s);
const isWorkType = (s: string): s is WorkType => (WORK_TYPES as readonly string[]).includes(s);
const WO_TIMES = [['schedstart', 'scheduledStart'], ['schedfinish', 'scheduledFinish'], ['actstart', 'actualStart'], ['actfinish', 'actualFinish'], ['statusdate', 'statusDate']] as const;

const maximoWorkOrders: Parser = {
  id: 'maximo-work-orders',
  accepts: (doc) => {
    const h = csvHeader(doc);
    return ['wonum', 'status', 'worktype'].every((c) => h.includes(c));
  },
  parse(doc) {
    const csv = parseCsv(doc.text);
    const workOrders: WorkOrderRecord[] = [];
    const skipped: { where: string; why: string }[] = csv.bad.map((line) => ({ where: `line ${line}`, why: 'unbalanced quotes' }));
    for (const r of csv.rows) {
      const where = `line ${r.line}`;
      const cell = (c: string) => r.cells.get(c) ?? '';
      const orNull = (c: string) => cell(c) || null;
      const wonum = cell('wonum');
      const status = cell('status').toUpperCase();
      const workType = cell('worktype').toUpperCase();
      if (!wonum) {
        skipped.push({ where, why: 'no WONUM' });
        continue;
      }
      if (!isWorkOrderStatus(status) || !isWorkType(workType)) {
        skipped.push({ where, why: `${wonum}: status "${cell('status')}" / work type "${cell('worktype')}" not recognized` });
        continue;
      }
      const reported = readMaximoTime(cell('reportdate'));
      if (!reported) {
        skipped.push({ where, why: `${wonum}: REPORTDATE "${cell('reportdate')}" is not a date` });
        continue;
      }
      const times = Object.fromEntries(WO_TIMES.map(([column, field]) => [field, readMaximoTime(cell(column))])) as Record<(typeof WO_TIMES)[number][1], LocalDateTime | null | undefined>;
      const badTime = WO_TIMES.find(([, field]) => times[field] === undefined);
      if (badTime) {
        skipped.push({ where, why: `${wonum}: ${badTime[0].toUpperCase()} "${cell(badTime[0])}" is not a date` });
        continue;
      }
      const priority = cell('wopriority');
      if (priority && !/^\d+$/.test(priority)) {
        skipped.push({ where, why: `${wonum}: WOPRIORITY "${priority}" is not a number` });
        continue;
      }
      workOrders.push({
        wonum,
        description: cell('description'),
        status,
        workType,
        priority: priority ? Number(priority) : null,
        location: cell('location'),
        assetNum: orNull('assetnum'),
        scheduledStart: times.scheduledStart ?? null,
        scheduledFinish: times.scheduledFinish ?? null,
        actualStart: times.actualStart ?? null,
        actualFinish: times.actualFinish ?? null,
        reported,
        statusDate: times.statusDate ?? null,
        pm: orNull('pmnum'),
        jobPlan: orNull('jpnum'),
        ownerGroup: orNull('ownergroup'),
        lead: orNull('lead'),
        vendor: orNull('vendor'),
      });
    }
    return { ...NO_RECORDS, statements: [], workOrders, skipped };
  },
};

// ───────────────────────────── BMS and power monitoring exports ─────────────────────────────
// Siemens Desigo CC Log Viewer and trend exports (en-US: "MM/DD/YYYY HH:MM:SS", site time), and
// Schneider EcoStruxure Power Monitoring Expert event history and Data Export - Extended
// ("M/D/YYYY h:mm:ss[.fff] AM", local and UTC). One record per row; unreadable rows are skipped with
// the reason. Long-format trend rows are grouped into one series per point (or device measurement).

const DESIGO_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
const PME_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(\.\d{1,3})?\s*(AM|PM)$/i;
const p2 = (n: number) => String(n).padStart(2, '0');

/** Site-local "YYYY-MM-DDTHH:mm:ss[.fff]" from date and clock parts, or null when a part is out of range. */
function localTime(mo: number, d: number, y: number, h24: number, mi: number, s: number, frac = ''): LocalDateTime | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h24 > 23 || mi > 59 || s > 59) return null;
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h24)}:${p2(mi)}:${p2(s)}${frac}`;
}

function readDesigoTime(text: string): LocalDateTime | null {
  const m = DESIGO_TIME.exec(text);
  return m ? localTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : null;
}

function readPmeTime(text: string): LocalDateTime | null {
  const m = PME_TIME.exec(text);
  if (!m || Number(m[4]) < 1 || Number(m[4]) > 12) return null;
  const h24 = (Number(m[4]) % 12) + (m[8]!.toUpperCase() === 'PM' ? 12 : 0);
  return localTime(Number(m[1]), Number(m[2]), Number(m[3]), h24, Number(m[5]), Number(m[6]), m[7] ? m[7].padEnd(4, '0') : '');
}

type Skipped = { where: string; why: string }[];

/** Parses rows into long-format samples and groups them by series key, in first-seen order. */
function trendSeries(
  system: HistorySystem,
  rows: readonly CsvRow[],
  skipped: Skipped,
  read: (r: CsvRow) => { key: string; source: string; label: string; unit: string; at: LocalDateTime; value: number | null } | string,
): TrendSeries[] {
  const series = new Map<string, { source: string; label: string; unit: string; samples: TrendSample[] }>();
  for (const r of rows) {
    const x = read(r);
    if (typeof x === 'string') {
      skipped.push({ where: `line ${r.line}`, why: x });
      continue;
    }
    let s = series.get(x.key);
    if (!s) series.set(x.key, (s = { source: x.source, label: x.label, unit: x.unit, samples: [] }));
    s.samples.push({ at: x.at, value: x.value });
  }
  return [...series.values()].map((s) => ({ system, ...s }));
}

const readValue = (text: string): number | null | undefined => (text === '' ? null : Number.isFinite(Number(text)) ? Number(text) : undefined);

const desigoEventLog: Parser = {
  id: 'desigo-event-log',
  accepts: (doc) => ['date/time', 'record type', 'event message text', 'source designation'].every((c) => csvHeader(doc).includes(c)),
  parse(doc) {
    const csv = parseCsv(doc.text);
    const skipped: Skipped = csv.bad.map((line) => ({ where: `line ${line}`, why: 'unbalanced quotes' }));
    const events: EventRecord[] = [];
    for (const r of csv.rows) {
      const cell = (c: string) => r.cells.get(c) ?? '';
      const where = `line ${r.line}`;
      const at = readDesigoTime(cell('date/time'));
      const record = cell('record type');
      const source = cell('source designation');
      if (!at) skipped.push({ where, why: `Date/Time "${cell('date/time')}" is not a date` });
      else if (record !== 'Event' && record !== 'Activity') skipped.push({ where, why: `Record Type "${record}" is neither Event nor Activity` });
      else if (!source) skipped.push({ where, why: 'no Source Designation' });
      else {
        const [message, action, value, unit] = [cell('event message text'), cell('action'), cell('value'), cell('unit')];
        const activity = record === 'Activity';
        const cause = cell('event cause');
        const phase: EventPhase = activity ? 'instant' : cause === 'To Normal' ? 'normal' : /^To /.test(cause) ? 'active' : 'instant';
        events.push({
          system: 'bms',
          at,
          source,
          text: activity ? (message ? `${action}: ${message}` : `${action} ${value}`.trim()) : message || value,
          category: cell('event category') || record,
          phase,
          detail: !activity && value ? `${value}${unit ? ` ${unit}` : ''}` : null,
        });
      }
    }
    return { ...NO_RECORDS, statements: [], events, skipped };
  },
};

const desigoTrend: Parser = {
  id: 'desigo-trend',
  accepts: (doc) => {
    const h = csvHeader(doc);
    return ['date/time', 'source designation', 'value', 'quality'].every((c) => h.includes(c)) && !h.includes('record type');
  },
  parse(doc) {
    const csv = parseCsv(doc.text);
    const skipped: Skipped = csv.bad.map((line) => ({ where: `line ${line}`, why: 'unbalanced quotes' }));
    const trends = trendSeries('bms', csv.rows, skipped, (r) => {
      const cell = (c: string) => r.cells.get(c) ?? '';
      const at = readDesigoTime(cell('date/time'));
      if (!at) return `Date/Time "${cell('date/time')}" is not a date`;
      const source = cell('source designation');
      if (!source) return 'no Source Designation';
      const value = readValue(cell('value'));
      if (value === undefined) return `${source}: Value "${cell('value')}" is not a number`;
      return { key: source, source, label: cell('source description'), unit: cell('unit'), at, value: cell('quality') === 'Good' ? value : null };
    });
    return { ...NO_RECORDS, statements: [], trends, skipped };
  },
};

const PME_PHASE: Readonly<Record<string, EventPhase>> = { 'pick up': 'active', 'drop out': 'normal', instantaneous: 'instant' };
const priorityBand = (p: number) => (p >= 192 ? 'High' : p >= 128 ? 'Medium' : p >= 64 ? 'Low' : 'None');

const pmeEventHistory: Parser = {
  id: 'pme-event-history',
  accepts: (doc) => ['source', 'timestamp', 'timestamp utc', 'event', 'type', 'priority'].every((c) => csvHeader(doc).includes(c)),
  parse(doc) {
    const csv = parseCsv(doc.text);
    const skipped: Skipped = csv.bad.map((line) => ({ where: `line ${line}`, why: 'unbalanced quotes' }));
    const events: EventRecord[] = [];
    for (const r of csv.rows) {
      const cell = (c: string) => r.cells.get(c) ?? '';
      const where = `line ${r.line}`;
      const at = readPmeTime(cell('timestamp'));
      const phase = PME_PHASE[cell('type').toLowerCase()];
      const priority = cell('priority');
      if (!at) skipped.push({ where, why: `Timestamp "${cell('timestamp')}" is not a date` });
      else if (!phase) skipped.push({ where, why: `Type "${cell('type')}" is not Pick up, Drop out or Instantaneous` });
      else if (!/^\d+$/.test(priority) || Number(priority) > 255) skipped.push({ where, why: `Priority "${priority}" is not 0-255` });
      else if (!cell('source') || !cell('event')) skipped.push({ where, why: 'no Source or Event' });
      else {
        const reading = cell('measurement') && cell('value') ? `${cell('measurement')} ${cell('value')}` : '';
        events.push({
          system: 'epms',
          at,
          source: cell('source'),
          text: cell('event'),
          category: priorityBand(Number(priority)),
          phase,
          detail: [reading, cell('condition')].filter(Boolean).join('; ') || null,
        });
      }
    }
    return { ...NO_RECORDS, statements: [], events, skipped };
  },
};

const pmeDataExport: Parser = {
  id: 'pme-data-export',
  accepts: (doc) => {
    const h = csvHeader(doc);
    return ['timestamp utc', 'timestamp', 'value', 'source', 'measurement', 'unit'].every((c) => h.includes(c)) && !h.includes('event');
  },
  parse(doc) {
    const csv = parseCsv(doc.text);
    const skipped: Skipped = csv.bad.map((line) => ({ where: `line ${line}`, why: 'unbalanced quotes' }));
    const trends = trendSeries('epms', csv.rows, skipped, (r) => {
      const cell = (c: string) => r.cells.get(c) ?? '';
      const at = readPmeTime(cell('timestamp'));
      if (!at) return `Timestamp "${cell('timestamp')}" is not a date`;
      const [source, measurement] = [cell('source'), cell('measurement')];
      if (!source || !measurement) return 'no Source or Measurement';
      const value = readValue(cell('value'));
      if (value === undefined) return `${source} ${measurement}: Value "${cell('value')}" is not a number`;
      return { key: `${source}\u0000${measurement}`, source, label: measurement, unit: cell('unit'), at, value };
    });
    return { ...NO_RECORDS, statements: [], trends, skipped };
  },
};

// ───────────────────────────── Registry ─────────────────────────────

/** The single registry. `parserFor` picks the first that accepts; documents nobody accepts are reported as "unparsed". */
export const PARSERS: readonly Parser[] = [
  bmsPoints, equipmentRegister, circuitRoster, contractClauses, maximoWorkOrders, desigoEventLog, desigoTrend, pmeEventHistory, pmeDataExport,
];

export function parserFor(doc: SourceDocument): Parser | null {
  return PARSERS.find((p) => p.accepts(doc)) ?? null;
}

const parsed = new Map<string, ParseResult | null>();

/** The registry's parse of a document, once per content id (the same bytes always parse the same). */
export function parseDocument(doc: SourceDocument): ParseResult | null {
  if (!parsed.has(doc.id)) parsed.set(doc.id, parserFor(doc)?.parse(doc) ?? null);
  return parsed.get(doc.id)!;
}
