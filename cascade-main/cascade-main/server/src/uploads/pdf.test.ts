import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parserFor, sourceDocument, type Statement } from '@cascade/core';
import { DFW1_SITE_DIR } from '../testing.js';
import { pdfText } from './pdf.js';

const values = (statements: readonly Statement[]) => statements.map((s) => JSON.stringify([s.subject, s.field, s.value])).sort();

test('each contract PDF states, through its text layer, what its .txt excerpt states', async () => {
  const pdfs = readdirSync(path.join(DFW1_SITE_DIR, 'upload')).filter((f) => f.endsWith('.pdf'));
  assert.equal(pdfs.length, 12);
  for (const file of pdfs) {
    const text = await pdfText(readFileSync(path.join(DFW1_SITE_DIR, 'upload', file)));
    const fromPdf = sourceDocument({ path: file, format: 'pdf', text });
    const fromTxt = sourceDocument({ path: file, format: 'text', text: readFileSync(path.join(DFW1_SITE_DIR, 'docs', 'contracts', file.replace(/\.pdf$/, '.txt')), 'utf8') });
    assert.equal(parserFor(fromPdf)?.id, 'contract-clauses', file);
    const pdf = values(parserFor(fromPdf)!.parse(fromPdf).statements);
    const txt = values(parserFor(fromTxt)!.parse(fromTxt).statements);
    // The .txt wraps Caddo's availability clause across two lines; the PDF states it in one sentence.
    const extra = file === 'C1102-caddo-msa.pdf' ? [JSON.stringify([{ kind: 'contract', tag: 'DFW-MSA-1102' }, 'terms', { term: 'availability', pct: 99.999, excludesMaintenance: true }])] : [];
    assert.deepEqual(pdf, [...txt, ...extra].sort(), file);
  }
});

test('a wrapped paragraph comes back as one line and table rows keep their columns', async () => {
  const text = await pdfText(readFileSync(path.join(DFW1_SITE_DIR, 'upload', 'C1041-mesquite-order-form.pdf')));
  const lines = text.split('\n');
  assert.ok(lines.includes('1.1 Charges begin on the Service Commencement Date and exclude applicable taxes. Recurring charges increase by 3% on each anniversary of the Order Date.'));
  assert.ok(lines.includes('B03   30A/208V/1ph   A+B   8.0 kW'));
  assert.ok(lines.includes('Monthly Recurring Charge (MRC)   Colocation space, power and cooling for 14 cabinets   $16,940.00'));
});
