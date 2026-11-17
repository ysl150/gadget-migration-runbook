import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportModel, modelManager } from '../scripts/gadget/export.mjs';
import { tableFor } from '../scripts/gadget/load-postgres.mjs';

// A fake model manager that behaves like Gadget's findMany: pages of records with hasNextPage/endCursor.
function fakeManager(total, calls) {
  const all = Array.from({ length: total }, (_, i) => ({ id: String(i + 1), updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, toJSON() { return { id: this.id, updatedAt: this.updatedAt }; } }));
  return {
    async findMany(opts) {
      calls.push(opts);
      const start = opts.after ? parseInt(opts.after, 10) : 0;
      const page = all.slice(start, start + opts.first);
      return Object.assign(page, { hasNextPage: start + opts.first < total, endCursor: String(start + page.length) });
    },
  };
}

test('exports every record across pages of 250', async () => {
  const calls = [];
  const records = await exportModel(fakeManager(600, calls));
  assert.equal(records.length, 600);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.after ?? null), [null, '250', '500']);
  assert.ok(calls.every((c) => c.first === 250 && c.sort.updatedAt === 'Ascending'));
  assert.deepEqual(records[0], { id: '1', updatedAt: '2026-01-01T00:00:00Z' }); // plain JSON, not client objects
});

test('--since becomes an updatedAt filter', async () => {
  const calls = [];
  await exportModel(fakeManager(3, calls), { since: '2026-11-01T00:00:00Z' });
  assert.deepEqual(calls[0].filter, { updatedAt: { after: '2026-11-01T00:00:00Z' } });
});

test('empty model exports zero records in one call', async () => {
  const calls = [];
  assert.equal((await exportModel(fakeManager(0, calls))).length, 0);
  assert.equal(calls.length, 1);
});

test('resolves namespaced models and rejects unknown ones', () => {
  const api = { billing: { invoice: { findMany() {} } }, customer: { findMany() {} } };
  assert.ok(modelManager(api, 'billing.invoice'));
  assert.ok(modelManager(api, 'customer'));
  assert.throws(() => modelManager(api, 'nope'), /No model/);
});

test('staging table names are safe snake_case', () => {
  assert.equal(tableFor('shopifyShop'), 'gadget_import_shopify_shop');
  assert.equal(tableFor('billing.invoice'), 'gadget_import_billing_invoice');
  assert.throws(() => tableFor('x; DROP TABLE users'), /Unsafe/);
});
