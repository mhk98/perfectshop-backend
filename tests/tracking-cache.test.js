const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTtlCache } = require('../shared/ttlCache');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Loads a module with its requires stubbed, so no DB connection is opened.
const loadWithStubs = (file, stubs) => {
  const ctx = {
    module: { exports: {} }, process, console, fetch: undefined, AbortSignal, URL, Date, Promise,
    setInterval, clearInterval, setTimeout,
    require: (p) => {
      const key = Object.keys(stubs).find((k) => p.endsWith(k));
      return key ? stubs[key] : require(p.startsWith('.') ? path.resolve(path.dirname(file), p) : p);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx;
};

test('ttl cache shares one load, caches it, and reloads after clear or failure', async () => {
  let loads = 0;
  let fail = true;
  const cache = createTtlCache(async () => {
    loads++;
    if (fail) { fail = false; throw new Error('db down'); }
    return ['pixel'];
  });
  await assert.rejects(cache.get(), /db down/);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.deepEqual(a, ['pixel']);
  assert.equal(a, b);
  await cache.get();
  assert.equal(loads, 2);
  cache.clear();
  await cache.get();
  assert.equal(loads, 3);
});

test('pixel config is read from the DB once and refreshed when admin edits it', async () => {
  let findAll = 0;
  const row = { Id: 1, update: async () => {}, get: () => ({ pixelsId: '123', metaAccessToken: 't' }) };
  const model = {
    findAll: async () => { findAll++; return [{ toJSON: () => ({ pixelsId: '123' }) }]; },
    findOne: async ({ where }) => (where.pixelsId ? null : row),
  };
  const svc = loadWithStubs(path.join(__dirname, '../app/modules/facebookPixel/facebookPixel.service.js'), {
    '/models': { facebookPixel: model },
    paginationHelper: {},
  }).module.exports;
  await svc.getActiveFromDB();
  await svc.getActiveFromDB();
  await svc.getPublicFromDB();
  assert.equal(findAll, 1);
  await svc.updateOneFromDB(1, { status: 'Inactive' });
  await svc.getActiveFromDB();
  assert.equal(findAll, 2);
});

test('Meta CAPI keeps every match-quality field and the response results', async () => {
  const sent = [];
  const pixel = { toJSON: () => ({ pixelsId: '123', metaAccessToken: 'tok', testEventId: null }) };
  const ctx = loadWithStubs(path.join(__dirname, '../app/modules/tracking/tracking.service.js'), {
    'facebookPixel.service': { getActiveFromDB: async () => [pixel] },
    'tiktokPixel.service': { getActiveFromDB: async () => [] },
    'googleAds.service': { getActiveFromDB: async () => [] },
  });
  ctx.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  };
  const result = await ctx.module.exports.trackEvent({
    eventName: 'Purchase',
    eventId: 'Purchase.order.9',
    eventSourceUrl: 'https://perfectshop.world/checkout',
    userData: {
      name: 'Rahim Uddin', phone: '01700000000', email: 'rahim@gmail.com',
      address: 'Mirpur 10, Dhaka 1216', district: 'inside', customerId: 9, deviceId: 'dev1',
      fbp: 'fb.1.1700000000000.123456', fbc: 'fb.1.1700000000000.AbCdEf',
    },
    customData: { value: 500, content_ids: ['7'], num_items: 1 },
  }, { headers: { 'user-agent': 'UA', 'x-forwarded-for': '203.0.113.7' }, ip: '203.0.113.7' });

  assert.equal(result.eventId, 'Purchase.order.9');
  assert.equal(result.results[0].ok, true, JSON.stringify(result.results));
  const event = sent[0].data[0];
  assert.equal(event.event_id, 'Purchase.order.9');
  const ud = event.user_data;
  assert.equal(ud.client_ip_address, '203.0.113.7');
  assert.equal(ud.client_user_agent, 'UA');
  assert.deepEqual(ud.em, [sha('rahim@gmail.com')]);
  assert.equal(ud.ph[0], sha('8801700000000'));
  assert.deepEqual(ud.fn, [sha('rahim')]);
  assert.deepEqual(ud.ln, [sha('uddin')]);
  assert.deepEqual(ud.ct, [sha('dhaka')]);
  assert.deepEqual(ud.st, [sha('dhaka')]);
  assert.deepEqual(ud.zp, [sha('1216')]);
  assert.deepEqual(ud.country, [sha('bd')]);
  assert.ok(ud.external_id.length >= 2);
  assert.equal(ud.fbp, 'fb.1.1700000000000.123456');
  assert.equal(ud.fbc, 'fb.1.1700000000000.AbCdEf');
  assert.equal(event.custom_data.value, 500);
});

test('visitor counts are batched into one write per day and survive a failed write', async () => {
  const writes = [];
  let failNext = true;
  const model = {
    findOrCreate: async ({ where }) => {
      if (failNext) { failNext = false; throw new Error('db busy'); }
      return [{ increment: async (_f, { by }) => writes.push([where.date, by]) }];
    },
  };
  const svc = loadWithStubs(path.join(__dirname, '../app/modules/visitorStat/visitorStat.service.js'), {
    '/models': { visitorStat: model },
  }).module.exports;
  await svc.track('1.1.1.1');
  await svc.track('2.2.2.2');
  await svc.flush();
  assert.equal(writes.length, 0);
  await svc.track('3.3.3.3');
  await svc.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 3);
});
