import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './analysis/analysis.js';
import { fixture } from './testing/fixture.js';
import { toWire } from './wire.js';

test('audit DTOs carry titles, detail and the customers affected', () => {
  const { facility } = fixture();
  const dto = toWire.audit(analyze(facility).audit(), facility);
  const conv = dto.findings.find((x) => x.id === 'ab-convergence:ups:UPS-A')!;
  assert.equal(conv.title, 'A and B feeds of 2 cabinets converge at UPS-A');
  assert.deepEqual(conv.detail['cabinets'], ['cabinet:C12', 'cabinet:C13']);
  assert.deepEqual(conv.affected.map((a) => a.customerName).sort(), ['Acme Corp', 'Globex']);
  assert.equal(JSON.parse(JSON.stringify(dto)).findings.length, dto.findings.length);
});

test('entity DTOs give each fact as a display value', () => {
  const { facility } = fixture();
  const an = analyze(facility);
  const dto = toWire.entity(an.explain(facility.parseId('cord:C22/B')!), facility);
  assert.deepEqual(dto.facts.find((x) => x.field === 'circuit'), { ref: 'cord:C22/B#circuit', field: 'circuit', display: 'PDU-A1/6' });
});

test('summary counts entities', () => {
  const { facility } = fixture();
  const s = toWire.summary(facility, 'documented');
  assert.equal(s.counts.cabinet, 5);
  assert.equal(s.counts.cord, 9);
});
