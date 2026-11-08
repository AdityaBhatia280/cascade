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

/** "CHWP-1 from MCC-A" and "CHWP-1 from SWGR-A CB-3" tell one route when a document feeds MCC-A from SWGR-A CB-3. */
const feeders = new Set(allStatements.filter(({ st }) => st.field === 'input').map(({ st }) => canonical([normalizeTag(st.subject.tag), st.value])));
const oneRoute = (byValue: ReadonlyMap<string, unknown>) => {
  const [a, b, ...rest] = [...byValue.keys()].map((v) => JSON.parse(v) as unknown);
  return rest.length === 0 && (feeders.has(canonical([a, b])) || feeders.has(canonical([b, a])));
};

test('the planted disagreements, and only those, are fields two sources give different values', () => {
  const disagreeing = [...valuesBySubjectField()].filter(([, byValue]) => byValue.size > 1 && !oneRoute(byValue)).map(([key]) => key).sort();
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
    ats: ['normal', 'alternate'], switchgear: ['input'], breaker: ['bus'], ups: ['input', 'bypass'], pdu: ['input'], transformer: ['input'], rpp: ['input'], panel: ['input'],
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

test('MCCs, the mechanical panels and XFMR-5B sit between their breaker and their loads, as the register routes them', () => {
  const reg = parsed.find(({ doc }) => doc.path === 'equipment_register.csv')!.result!.statements;
  const said = (kind: string, tag: string, field: string) => reg.find((st) => st.subject.kind === kind && st.subject.tag === normalizeTag(tag) && st.field === field)?.value;
  // The MCCs and the transformer have register rows; MP-A and MP-B exist only in their breakers' notes.
  assert.deepEqual(['MCC-A', 'MCC-B', 'MP-A', 'MP-B'].map((t) => said('panel', t, 'input')), ['SWGR-A-CB-3', 'SWGR-B-CB-3', 'SWGR-A-CB-4', 'SWGR-B-CB-4']);
  assert.equal(said('transformer', 'XFMR-5B', 'input'), 'SWGR-B-CB-6');
  assert.deepEqual(said('transformer', 'XFMR-5B', 'rating'), { unit: 'kva', kva: 75 });
  assert.equal(said('rpp', 'RPP-5B', 'input'), 'XFMR-5B');
  assert.deepEqual(['CH-1', 'CH-2', 'CH-3'].map((t) => said('chiller', t, 'power')), ['MCC-A', 'MCC-B', 'MCC-B']);
  assert.deepEqual(['CHWP-1', 'CHWP-2', 'CHWP-3'].map((t) => said('pump', t, 'power')), ['MCC-A', 'MCC-B', 'MCC-A']);
  assert.deepEqual(['CRAH-01', 'CRAH-02'].map((t) => said('crah', t, 'power')), ['MP-A', 'MP-B']);
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

test('the BMS point table yields each alarm limit under the designation the event log and trends use', () => {
  const bms = parsed.find(({ doc }) => doc.path === 'bms_points.json')!.result!;
  const aisle = (row: string) => [[`DFW1.Bldg1.DH-1.Row_${row}.Cold_Aisle_Temp`, 'high', 80.6, '°F'], [`DFW1.Bldg1.DH-1.Row_${row}.Cold_Aisle_Temp`, 'low', 64.4, '°F']];
  assert.deepEqual(bms.limits.map((l) => [l.source, l.bound, l.value, l.unit]), [
    ...['CH-1', 'CH-2', 'CH-3', 'CHW-LOOP-1'].map((u) => [`DFW1.Bldg1.CHW_Plant.${u}.CHWS_Temp`, 'high', 50, '°F']),
    ...aisle('A'), ...aisle('C'), ...aisle('E'),
  ]);
  const named = new Set(parsed.flatMap(({ result }) => [...(result?.events ?? []), ...(result?.trends ?? [])].filter((r) => r.system === 'bms').map((r) => r.source)));
  for (const l of bms.limits) assert.ok(named.has(l.source), `${l.source} is not a point the event log or trends name`);
});

test('a branch-circuit channel states its cord or SPARE and its breaker; a rating label states only a labelled kind', () => {
  const row = (designation: string, equipment: string, type: string, description: string) =>
    ({ designation, equipment, equipment_type: type, object_type: 'AI', object_instance: 1, device_instance: 5000, description, units: 'kW', high_limit: null, low_limit: null, state_text: null });
  const doc = sourceDocument({ path: 'points.json', format: 'json', text: JSON.stringify({ points: [
    row('S.DH-1.RPP-9A.CB07_kW', 'RPP-9A', 'RPP', 'RPP-9A CB07 kW - Cab Z01 Cord B - 30A/208V/3P'),
    row('S.DH-1.RPP-9A.CB09_kW', 'RPP-9A', 'RPP', 'RPP-9A CB09 kW - SPARE - 20A/208V/1P'),
    row('S.DH-1.RPP-9A.CB11_kW', 'RPP-9A', 'RPP', 'RPP-9A CB11 kW - lighting'),
    row('S.Plant.CH-9.kW', 'CH-9', 'Chiller', 'CH-9 Power (90 kVA)'),
    row('S.DH-1.PDU-9A.Output_kW', 'PDU-9A', 'PDU', 'PDU-9A Output kW (300 kVA)'),
  ] }) });
  const r = parserFor(doc)!.parse(doc);
  const said = r.statements.filter((x) => x.field !== null).map((x) => `${x.subject.kind}:${x.subject.tag}#${x.field}=${canonical(x.value)}`);
  assert.deepEqual(said, [
    'circuit:RPP-9A/7#panel="RPP-9A"', 'circuit:RPP-9A/7#position="7"', 'circuit:RPP-9A/7#rating={"amps":30,"phases":3,"unit":"amps","volts":208}',
    'cord:Z01/B#labelledSide="B"', 'cord:Z01/B#circuit="RPP-9A/7"',
    'circuit:RPP-9A/9#panel="RPP-9A"', 'circuit:RPP-9A/9#position="9"', 'circuit:RPP-9A/9#rating={"amps":20,"phases":1,"unit":"amps","volts":208}',
    'circuit:RPP-9A/11#panel="RPP-9A"', 'circuit:RPP-9A/11#position="11"',
    'pdu:PDU-9A#rating={"kva":300,"unit":"kva"}',
  ]);
  assert.deepEqual(r.skipped.map((x) => x.where), ['/points/2']);
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
