const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Op } = require('sequelize');
const { syncCourierOrders, withSyncLock, startCourierStatusSync, getMaxAgeDays } = require('../app/jobs/courierStatusSync');

test('sweeps all pages as statuses change, skips terminal/unsupported orders, continues after errors', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ Id: i + 1, courier: 'Steadfast', status: 'in_courier', note: '' }));
  rows[1].courier = 'Pathao'; rows[1].note = JSON.stringify({ courierIntegration: { pathao: { consignmentId: 'p2' } } });
  rows[2].status = 'delivered'; rows[3].courier = 'Other'; rows[4].courier = 'Pathao';
  const visited = [], warnings = [];
  const sync = async (id, options) => { assert.equal(options.automatic, true); visited.push(id); if (id === 1) throw Error('API failure'); rows[id - 1].status = 'delivered'; };
  await syncCourierOrders({
    Order: { max: async () => 205, findAll: async ({ where, limit }) => rows.filter(r => r.Id > where.Id[Op.gt] && r.Id <= where.Id[Op.lte] && where.status[Op.in].includes(r.status)).slice(0, limit) },
    service: { syncSteadfastStatusInDB: sync, syncPathaoStatusInDB: sync }, pause: async () => {}, logger: { warn: m => warnings.push(m) },
  });
  assert.equal(visited.length, 202); assert.equal(new Set(visited).size, 202);
  assert.ok(visited.includes(2)); assert.ok(visited.includes(205)); assert.equal(warnings.length, 1);
});

test('shutdown stops before another courier request', async () => {
  let stopped = false, calls = 0;
  await syncCourierOrders({ Order: { max: async () => 2, findAll: async () => [1, 2].map(Id => ({ Id, courier: 'Steadfast' })) },
    service: { syncSteadfastStatusInDB: async () => { calls++; stopped = true; } }, shouldStop: () => stopped });
  assert.equal(calls, 1);
});

// The lock runs on its own connection: the request pool must never be touched.
function lockSequelize(connection, { onDisconnect = async () => {} } = {}) {
  return { getDatabaseName: () => 'test', connectionManager: {
    config: { replication: false, host: 'db' },
    connect: async config => { assert.equal(config.host, 'db'); return connection; },
    disconnect: async c => { assert.equal(c, connection); await onDisconnect(); },
    getConnection: async () => assert.fail('lock must not take a pooled connection'),
  } };
}

for (const acquired of [0, 1]) test(`database lock acquired=${acquired} protects sweep and closes its own connection`, async () => {
  const queries = []; let ran = false, closed = false, errorHandler;
  const connection = { on: (event, handler) => { errorHandler = handler; }, query(sql, params, callback) { queries.push(sql); callback(null, [{ acquired }]); } };
  const result = withSyncLock(lockSequelize(connection, { onDisconnect: async () => { closed = true; } }), async () => { ran = true; throw Error('sweep failed'); });
  if (acquired) await assert.rejects(result, /sweep failed/); else await result;
  assert.equal(ran, Boolean(acquired)); assert.equal(closed, true); assert.equal(queries.length, 1);
  assert.equal(typeof errorHandler, 'function');
});

test('disabled scheduler does not load database or start work', async () => {
  await startCourierStatusSync({ env: { COURIER_STATUS_SYNC_ENABLED: 'false' } })();
});

function serviceFixture({ courier = 'Steadfast', status = 'in_courier', providerStatus = 'delivered', editDuringFetch } = {}) {
  const provider = courier.toLowerCase();
  const row = { Id: 1, orderId: 'PS-1', courier, status, note: JSON.stringify({ courierIntegration: { [provider]: { consignmentId: 'c1' } } }) };
  let requests = 0;
  const db = { order: {
    findByPk: async () => ({ ...row }),
    update: async (values, { where }) => {
      if (!Object.entries(where).every(([key, value]) => row[key] === value)) return [0];
      Object.assign(row, values); return [1];
    },
  } };
  const context = { module: { exports: {} }, console, process, setTimeout, clearTimeout, AbortController,
    fetch: async url => {
      requests++;
      if (url.includes('issue-token')) return { ok: true, text: async () => JSON.stringify({ access_token: 'test-token' }) };
      editDuringFetch?.(row);
      return { ok: true, text: async () => JSON.stringify(provider === 'steadfast' ? { delivery_status: providerStatus } : { data: { order_status: providerStatus } }) };
    },
    require(name) {
      if (name === '../../../models') return db;
      if (name.includes('siteSetting.service')) return { getByType: async () => ({ data: {
        steadfast: { apiKey: 'test', secretKey: 'test' }, pathao: { clientId: 'test', clientSecret: 'test', username: 'test', password: 'test', storeId: 1 },
      } }) };
      if (name === './orderPricing') return { priceOrderItems: async (payload) => payload };
      if (name === './orderStock') return { registerOrderStockHooks() {} };
      if (name === 'crypto' || name === 'sequelize') return require(name);
      if (name.includes('ApiError')) return Error;
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/modules/order/order.service'), 'utf8'), context);
  const service = context.module.exports;
  return { row, requests: () => requests, sync: () => (provider === 'steadfast' ? service.syncSteadfastStatusInDB : service.syncPathaoStatusInDB)(1, { automatic: true }) };
}
for (const courier of ['Steadfast', 'Pathao']) test(`${courier} automatic sync persists delivered status`, async () => {
  const f = serviceFixture({ courier }); await f.sync(); assert.equal(f.row.status, 'delivered');
});
test('pending courier approval remains eligible for the next sweep', async () => {
  const f = serviceFixture({ providerStatus: 'delivered_approval_pending' }); await f.sync(); assert.equal(f.row.status, 'in_courier');
});
test('terminal orders are rechecked before contacting courier', async () => {
  const f = serviceFixture({ status: 'cancelled' }); await f.sync(); assert.equal(f.requests(), 0);
});
for (const edit of [{ status: 'cancelled' }, { note: 'Staff added a note' }, { courier: 'Other' }]) test(`concurrent manual ${Object.keys(edit)[0]} edit is preserved`, async () => {
  const f = serviceFixture({ editDuringFetch: row => Object.assign(row, edit) }); await f.sync();
  for (const [key, value] of Object.entries(edit)) assert.equal(f.row[key], value);
  assert.notEqual(f.row.status, 'delivered');
});

 test('failed lock close destroys the session so the lock cannot outlive the sweep', async () => {
  let destroyed = false;
  const connection = { on() {}, destroy: () => { destroyed = true; }, query(sql, params, callback) { callback(null, [{ acquired: 1 }]); } };
  await withSyncLock(lockSequelize(connection, { onDisconnect: async () => { throw Error('connection lost'); } }), async () => {});
  assert.equal(destroyed, true);
});

test('sweep only covers orders created within the max age window', async () => {
  let createdAfter;
  const now = Date.parse('2026-10-22T00:00:00Z');
  await syncCourierOrders({ Order: { max: async () => 5, findAll: async ({ where }) => { createdAfter = where.createdAt[Op.gte]; return []; } },
    service: {}, maxAgeDays: 30, now: () => now });
  assert.equal(createdAfter.toISOString(), '2026-09-22T00:00:00.000Z');
});

test('max age comes from COURIER_SYNC_MAX_AGE_DAYS and falls back to 30 days', () => {
  assert.equal(getMaxAgeDays({ COURIER_SYNC_MAX_AGE_DAYS: '45' }), 45);
  assert.equal(getMaxAgeDays({ COURIER_SYNC_MAX_AGE_DAYS: 'abc' }), 30);
  assert.equal(getMaxAgeDays({}), 30);
});
