const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(provider, { fail = false, changed = false, status = 'in_courier' } = {}) {
  const row = { Id: 7, orderId: 'INV7', courier: provider, status,
    note: JSON.stringify({ customerAddress: 'Dhaka', courierIntegration: { pathao: { consignmentId: 'P7' } } }) };
  let writes = 0;
  const db = { order: {
    async findByPk() { return row; },
    async update(values, { where }) {
      writes++;
      assert.equal(where.status, status);
      assert.equal(where.note, row.note);
      if (changed) return [0];
      Object.assign(row, values); return [1];
    },
  } };
  const context = { module: { exports: {} }, console, process, setTimeout, clearTimeout, AbortController,
    async fetch(url) {
      if (fail) throw Error('courier offline');
      const data = url.includes('issue-token') ? { access_token: 'test-token' }
        : provider === 'Steadfast' ? { status: 200, delivery_status: 'delivered' }
          : { data: { order_status: 'Delivered' } };
      return { ok: true, text: async () => JSON.stringify(data) };
    },
    require(name) {
      if (name === '../../../models') return db;
      if (name.includes('siteSetting.service')) return { getByType: async () => ({ data: {
        steadfast: { apiKey: 'test', secretKey: 'test' },
        pathao: { clientId: 'test', clientSecret: 'test', username: 'test', password: 'test', storeId: 1 },
      } }) };
      if (name === './orderPricing') return { priceOrderItems: async (payload) => payload };
      if (name === './orderStock') return { registerOrderStockHooks() {} };
      if (name === 'crypto' || name === 'sequelize') return require(name);
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/modules/order/order.service'), 'utf8'), context);
  return { row, writes: () => writes, sync: () => context.module.exports[provider === 'Steadfast' ? 'syncSteadfastStatusInDB' : 'syncPathaoStatusInDB'](7, { automatic: true }) };
}
for (const provider of ['Steadfast', 'Pathao']) {
  test(`${provider} delivery automatically updates order and preserves metadata`, async () => {
    const { sync, row } = setup(provider);
    await sync();
    assert.equal(row.status, 'delivered');
    assert.equal(JSON.parse(row.note).customerAddress, 'Dhaka');
  });
  test(`${provider} failures and concurrent edits do not overwrite status`, async () => {
    const failed = setup(provider, { fail: true });
    await assert.rejects(failed.sync(), /courier offline/);
    assert.equal(failed.writes(), 0);
    const changed = setup(provider, { changed: true });
    await changed.sync();
    assert.equal(changed.row.status, 'in_courier');
    const delivered = setup(provider, { status: 'delivered' });
    await delivered.sync();
    assert.equal(delivered.writes(), 0);
  });
}
