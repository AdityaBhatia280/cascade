import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceDocument } from './documents.js';

test('document ids are content-addressed', () => {
  const text = ['tag,asset_class,rating', 'UPS-A,UPS,500 kW'].join('\n');
  const doc = sourceDocument({ path: 'register.csv', format: 'csv', text });
  const same = sourceDocument({ path: 'elsewhere.csv', format: 'csv', text });
  const changed = sourceDocument({ path: 'register.csv', format: 'csv', text: text + '\n' });
  assert.equal(same.id, doc.id);
  assert.notEqual(changed.id, doc.id);
});
