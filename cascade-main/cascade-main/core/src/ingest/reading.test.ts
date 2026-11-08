import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DFW1_DIR } from '../testing/dfw1.js';
import { sourceDocument } from './documents.js';
import { checkReading, contractStatements } from './reading.js';

const contract = (file: string, edit: (t: string) => string = (t) => t) =>
  sourceDocument({ path: file, format: 'text', text: edit(readFileSync(path.join(DFW1_DIR, 'docs', 'contracts', file), 'utf8')) });

const halcyon = {
  agreementNumber: 'DFW-MSA-1156',
  account: 'C1156',
  customerName: 'Halcyon Health Partners',
  monthlyFeeUsd: 7850,
  cabinets: ['E01', 'E02', 'E03', 'E04', 'E05'],
  committedKw: ['E01', 'E02', 'E03', 'E04', 'E05'].map((cabinet) => ({ cabinet, kw: 6 })),
  powerRedundancy: 'A+B',
  coolingRedundancy: 'N+1',
  noticeBusinessDays: null,
};

const fee = (statements: ReturnType<typeof contractStatements>) => statements.filter((s) => s.field === 'monthlyFeeUsd').map((s) => s.value);

test('a reading that matches the document keeps every field', () => {
  const r = checkReading(contract('C1156-halcyon-order-form.txt'), halcyon);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.reading.monthlyFeeUsd, 7850);
  assert.equal(r.reading.customerName, 'Halcyon Health Partners');
});

test('a fee the document never states is dropped and the parser value stands', () => {
  const doc = contract('C1156-halcyon-order-form.txt');
  const r = checkReading(doc, { ...halcyon, monthlyFeeUsd: 7580 });
  assert.deepEqual(r.dropped, [{ field: 'monthlyFeeUsd', why: 'not found in the document' }]);
  assert.equal(r.reading.monthlyFeeUsd, undefined);
  assert.deepEqual(fee(contractStatements(doc, r.reading)), [7850]);
});

test("a value present in the text but off its clause is dropped: B03's old 4.0 kW, Pecan's courtesy A+B", () => {
  const mesquite = checkReading(contract('C1041-mesquite-order-form.txt'), { committedKw: [{ cabinet: 'B03', kw: 4 }] });
  assert.deepEqual(mesquite.dropped, [{ field: 'committedKw', why: 'contradicts what the parser read' }]);
  const pecan = checkReading(contract('C1077-pecan-order-form.txt'), { powerRedundancy: 'A+B' });
  assert.deepEqual(pecan.dropped, [{ field: 'powerRedundancy', why: 'not found in the document' }]);
});

test('a checked reading adds what the parser could not read, and nothing it did', () => {
  const doc = contract('C1156-halcyon-order-form.txt', (t) => t.replace('2.1 Licensed Cabinets: E01-E05', '2.1 The licensed cabinets are E01 through E05.'));
  const parsedOnly = contractStatements(doc, null);
  assert.equal(parsedOnly.some((s) => s.field === 'cabinets'), false);
  const r = checkReading(doc, halcyon);
  assert.deepEqual(r.dropped, []);
  const merged = contractStatements(doc, r.reading);
  assert.deepEqual(merged.filter((s) => s.field === 'cabinets').map((s) => s.value), [['E01', 'E02', 'E03', 'E04', 'E05']]);
  assert.equal(merged.length, parsedOnly.length + 1);
});

test('values in the wrong shape are dropped, nulls are not', () => {
  const r = checkReading(contract('C1156-halcyon-order-form.txt'), { monthlyFeeUsd: '7850', cabinets: ['row E'], account: null });
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['cabinets', 'monthlyFeeUsd']);
  assert.deepEqual(r.reading, {});
});
