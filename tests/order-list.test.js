const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Op, DataTypes } = require('sequelize');

// The real model gives us the real phoneKey normalizer and save hook.
let modelOptions;
const realModel = require('../app/modules/order/order.model')({
  define(_name, _attributes, options) { modelOptions = options; return {}; },
}, DataTypes);

// Runs getOrdersFromDB against an in-memory orders table and records each query.
function setup(rows) {
  const queries = [];
  const inList = (value) => (value && value[Op.in]) || null;
  const Order = {
    toPhoneKey: realModel.toPhoneKey,
    async findAndCountAll({ limit }) {
      queries.push('page');
      const page = [...rows].sort((a, b) => b.Id - a.Id).slice(0, limit)
        .map((row) => ({ ...row, toJSON() { const { toJSON, ...plain } = this; return plain; } }));
      return { count: rows.length, rows: page };
    },
    async findAll({ where }) {
      if (where.phoneKey) {
        queries.push('repeat');
        const keys = inList(where.phoneKey);
        return rows.filter((row) => keys.includes(row.phoneKey) && row.Id < where.Id[Op.lt]);
      }
      queries.push('fraud');
      const phones = inList(where.customerPhone).map((phone) => phone.toLowerCase());
      return rows.filter((row) => phones.includes(String(row.customerPhone).trim().toLowerCase()));
    },
    async count() { throw new Error('per-row count must not run'); },
  };
  const context = { module: { exports: {} }, console, process, setTimeout, require(name) {
    if (name === '../../../models') return { order: Order, user: {}, sequelize: {} };
    if (name === '../../../helpers/paginationHelper') {
      return { calculatePagination: () => ({ page: 1, limit: 20, skip: 0 }) };
    }
    if (name.includes('orderStatus.service')) return { toOrderStatusKey: (s) => String(s || '').toLowerCase() };
    if (name === './order.constants') return require('../app/modules/order/order.constants');
    if (name === './orderStock') return { registerOrderStockHooks() {} };
    if (name === 'crypto' || name === 'sequelize') return require(name);
    if (name.includes('ApiError')) return class extends Error {};
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/modules/order/order.service'), 'utf8'), context);
  return { service: context.module.exports, queries };
}

const order = (Id, customerPhone, extra = {}) => ({
  Id, customerPhone, phoneKey: realModel.toPhoneKey(customerPhone), status: 'pending', ...extra,
});

test('orders list loads repeat counts and fraud guard in two queries for the whole page', async () => {
  const rows = [
    order(1, '01712345678', { status: 'returned' }),
    order(2, '+8801712345678', { status: 'cancelled' }),
    order(3, '01712345678', { status: 'returned' }),
    order(4, '01712345678'),
    order(5, '01899999999'),
    order(6, '01812345678', { fraudStatus: 'fake', fraudReason: 'prank' }),
    order(7, '01812345678'),
    order(8, '01912345678', { fraudStatus: 'safe' }),
  ];
  const { service, queries } = setup(rows);
  const { data } = await service.getOrdersFromDB({}, {}, {});
  const byId = Object.fromEntries(data.map((row) => [row.Id, row]));

  assert.deepEqual(queries.sort(), ['fraud', 'page', 'repeat']);

  // +880 and 0-prefixed numbers are the same customer.
  assert.equal(byId[4].previousOrderCount, 3);
  assert.equal(byId[4].isRepeat, true);
  assert.equal(byId[1].previousOrderCount, 0);
  assert.equal(byId[5].isRepeat, false);

  // Exact-phone history: rows 1 and 3 failed, row 4 itself is pending.
  assert.equal(byId[4].fraudGuard.status, 'safe');
  assert.equal(byId[3].fraudGuard.failedCount, 2);
  assert.equal(byId[7].fraudGuard.status, 'fake');
  assert.equal(byId[7].fraudGuard.reason, 'prank');
  assert.equal(byId[8].fraudGuard.reason, 'Manually marked as safe');
});

test('three failed deliveries with no delivery marks the phone high risk', async () => {
  const rows = [
    order(1, '01712345678', { status: 'returned' }),
    order(2, '01712345678', { status: 'cancelled' }),
    order(3, '01712345678', { status: 'on_hold' }),
    order(4, '01712345678'),
  ];
  const { service } = setup(rows);
  const { data } = await service.getOrdersFromDB({}, {}, {});
  assert.equal(data.find((row) => row.Id === 4).fraudGuard.status, 'high_risk');
});

test('phoneKey is kept in sync when an order is created or its phone changes', () => {
  const { beforeSave } = modelOptions.hooks;
  const created = { isNewRecord: true, customerPhone: '+880 1712-345678', changed: () => false };
  beforeSave(created);
  assert.equal(created.phoneKey, '01712345678');

  const edited = { isNewRecord: false, customerPhone: '01899999999', phoneKey: 'old', changed: (f) => f === 'customerPhone' };
  beforeSave(edited);
  assert.equal(edited.phoneKey, '01899999999');

  const untouched = { isNewRecord: false, customerPhone: '01899999999', phoneKey: 'kept', changed: () => false };
  beforeSave(untouched);
  assert.equal(untouched.phoneKey, 'kept');
});
