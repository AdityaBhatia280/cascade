import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sourceDocument, type DocFormat, type SourceDocument, type Statement } from './documents.js';
import { normalizeTag, parserFor, PARSERS } from './sources.js';

const SITE = fileURLToPath(new URL('../../../seed/sites/dfw1/', import.meta.url));
const DOCS = join(SITE, 'docs');

const FORMATS: Record<string, DocFormat> = { csv: 'csv', json: 'json', txt: 'text', md: 'text' };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function loadSeed(): SourceDocument[] {
  return walk(DOCS)
    .sort()
    .map((abs) => {
      const text = readFileSync(abs, 'utf8');
      const path = relative(DOCS, abs);
      return sourceDocument({ path, format: FORMATS[path.split('.').pop() ?? ''] ?? 'text', text });
    });
}

interface Truth {
  conflicts: { id: string; entity: { kind: string; tag: string }; field: string; sources: { doc: string; value: unknown }[] }[];
  numbers: { hallMeasuredKw: number; rowCMeasuredKw: number };
}
const truth = JSON.parse(readFileSync(join(SITE, 'ground_truth.json'), 'utf8')) as Truth;

const docs = loadSeed();
const parsed = docs.map((doc) => {
  const parser = parserFor(doc);
  return { doc, parser, result: parser?.parse(doc) ?? null };
});
const allStatements: { doc: SourceDocument; st: Statement }[] = parsed.flatMap(({ doc, result }) => (result?.statements ?? []).map((st) => ({ doc, st })));

/** Key-sorted JSON, so equal values compare equal regardless of property order. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v);

/** Fields holding one value per entity. Contract `terms` is a list of independent facts, so it is excluded. */
const singleValued = ({ st }: { st: Statement }) => st.field !== null && !(st.subject.kind === 'contract' && st.field === 'terms');

function valuesBySubjectField() {
  const groups = new Map<string, Map<string, { doc: string; st: Statement }[]>>();
  for (const c of allStatements.filter(singleValued)) {
    const key = `${c.st.subject.kind}:${normalizeTag(c.st.subject.tag)}#${c.st.field}`;
    const byValue = groups.get(key) ?? new Map();
    const v = canonical(c.st.value);
    byValue.set(v, [...(byValue.get(v) ?? []), { doc: c.doc.path, st: c.st }]);
    groups.set(key, byValue);
  }
  return groups;
}

test('every seed document is read by exactly one parser and yields values or time-based records', (t) => {
  for (const { doc, parser, result } of parsed) {
    assert.ok(parser, `${doc.path}: no parser accepts it`);
    assert.equal(PARSERS.filter((p) => p.accepts(doc)).length, 1, `${doc.path}: more than one parser accepts it`);
    assert.ok(result && result.statements.length + result.workOrders.length + result.events.length + result.trends.length > 0, `${doc.path}: produced nothing`);
    t.diagnostic(`${doc.path}  [${parser.id}]  ${result.statements.length} values, ${result.workOrders.length} work orders, ${result.events.length} events, ${result.trends.length} trend series, ${result.skipped.length} skipped`);
    for (const s of result.skipped) t.diagnostic(`    skipped ${s.where}: ${s.why}`);
  }
  t.diagnostic(`total values: ${allStatements.length}`);
});

test('the planted disagreements, and only those, are fields two sources give different values', () => {
  const disagreeing = [...valuesBySubjectField()].filter(([, byValue]) => byValue.size > 1).map(([key]) => key).sort();
  const planted = truth.conflicts.map((c) => `${c.entity.kind}:${normalizeTag(c.entity.tag)}#${c.field}`).sort();
  assert.deepEqual(disagreeing, planted);

  const groups = valuesBySubjectField();
  for (const c of truth.conflicts) {
    const byValue = groups.get(`${c.entity.kind}:${normalizeTag(c.entity.tag)}#${c.field}`)!;
    for (const s of c.sources) {
      const statements = byValue.get(canonical(s.value)) ?? [];
      assert.ok(statements.some((x) => `docs/${x.doc}` === s.doc), `${c.id}: no value ${canonical(s.value)} from ${s.doc}`);
    }
  }
});

test('one device under several spellings is one subject, not a conflict or a duplicate', () => {
  assert.equal(normalizeTag('PDU-3B'), normalizeTag('PDU 3B'));
  assert.equal(normalizeTag('PDU3B'), normalizeTag('pdu_3b'));
  assert.equal(normalizeTag('CRAH-05'), normalizeTag('CRAH-5'));
  assert.equal(normalizeTag('SWGR-B CB-3'), normalizeTag('SWGR-B-CB3'));
  assert.notEqual(normalizeTag('D03'), normalizeTag('D30'));

  const pduDocs = new Set(allStatements.filter(({ st }) => st.subject.kind === 'pdu' && st.subject.tag === normalizeTag('PDU-2A')).map(({ doc }) => doc.path));
  const panelDocs = new Set(allStatements.filter(({ st }) => st.subject.kind === 'circuit' && st.field === 'panel' && st.value === normalizeTag('PDU-2A')).map(({ doc }) => doc.path));
  assert.deepEqual([...pduDocs].sort(), ['bms_points.json', 'equipment_register.csv']);
  assert.deepEqual([...panelDocs], ['circuit_roster.csv']);
  const pduTags = new Set(allStatements.filter(({ st }) => st.subject.kind === 'pdu').map(({ st }) => st.subject.tag));
  assert.equal(pduTags.size, 6);
});

test('every reference names a subject some document establishes', () => {
  const REFS: Record<string, readonly string[]> = {
    ats: ['normal', 'alternate'], switchgear: ['input'], breaker: ['bus'], ups: ['input', 'bypass'], pdu: ['input'], rpp: ['input'],
    circuit: ['panel'], cord: ['circuit'], row: ['hall'], cabinet: ['row', 'customer'],
    chiller: ['header', 'power'], header: ['loop'], pump: ['loop', 'power'], crah: ['loop', 'hall', 'power'], contract: ['customer'],
  };
  const subjects = new Set(allStatements.map(({ st }) => normalizeTag(st.subject.tag)));
  const dangling = allStatements
    .filter(({ st }) => st.field !== null && REFS[st.subject.kind]?.includes(st.field) && typeof st.value === 'string')
    .filter(({ st }) => !subjects.has(st.value as string))
    .map(({ doc, st }) => `${doc.path}: ${st.subject.tag}.${st.field} -> ${String(st.value)}`);
  assert.deepEqual(dangling, []);
});

test('ambiguous contract clauses produce no value instead of a guess', () => {
  const caddo = allStatements.filter(({ doc }) => doc.path.includes('caddo-msa'));
  const availability = caddo.filter(({ st }) => st.field === 'terms' && (st.value as { term: string }).term === 'availability');
  assert.equal(availability.length, 0, 'the wrapped 7.1 clause must not be read');
  const others = allStatements.filter(({ doc, st }) => doc.path.endsWith('-msa.txt') && st.field === 'terms' && (st.value as { term: string }).term === 'availability').map(({ doc }) => doc.path);
  assert.equal(new Set(others).size, 5);
});

test('every MSA states its maintenance notice period in business days', () => {
  const notices = allStatements.filter(({ st }) => st.field === 'terms' && (st.value as { term: string }).term === 'maintenance-notice');
  assert.equal(new Set(notices.map(({ doc }) => doc.path)).size, 6);
  for (const { st } of notices) assert.deepEqual(st.value, { term: 'maintenance-notice', businessDays: 10 });
});

test('the BMS point list yields each chiller supply-temperature high alarm', () => {
  const bms = parsed.find(({ doc }) => doc.path === 'bms_points.json')!.result!;
  assert.deepEqual(
    bms.limits.map((l) => [l.source, l.bound, l.value, l.unit]),
    [['CH-1.CHWS.Temp', 'high', 50, 'degF'], ['CH-2.CHWS.Temp', 'high', 50, 'degF'], ['CH-3.CHWS.Temp', 'high', 50, 'degF']],
  );
});

test('every licensed cabinet in an order form has exactly one committed-kW term', () => {
  for (const { doc, result } of parsed.filter(({ doc }) => doc.path.endsWith('-order-form.txt'))) {
    const statements = result?.statements ?? [];
    const licensed = statements.find((c) => c.field === 'cabinets')?.value as string[] | undefined;
    const committed = statements.filter((c) => c.field === 'terms' && (c.value as { term: string }).term === 'committed-kw').map((c) => (c.value as { cabinet: string }).cabinet);
    assert.ok(licensed?.length, `${doc.path}: no licensed cabinets`);
    assert.deepEqual([...committed].sort(), [...licensed].sort(), doc.path);
  }
});

test('measured load parsed from the roster matches the seed numbers', () => {
  const kw = new Map<string, number>();
  for (const { st } of allStatements) if (st.subject.kind === 'cabinet' && st.field === 'measuredKw') kw.set(st.subject.tag, st.value as number);
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.equal(kw.size, 52);
  assert.equal(sum([...kw.values()]), truth.numbers.hallMeasuredKw);
  assert.equal(sum([...kw].filter(([tag]) => tag.startsWith('C')).map(([, v]) => v)), truth.numbers.rowCMeasuredKw);
});

test('parsing is deterministic', () => {
  for (const doc of docs) assert.deepEqual(parserFor(doc)?.parse(doc), parserFor(doc)?.parse(doc));
});
