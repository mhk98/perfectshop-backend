const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const trackingCache = require('../app/modules/tracking/tracking.cache');

beforeEach(() => trackingCache.clearTrackingCache());

// Runs the real tracking service with stubbed pixel services and a fake fetch.
function loadTracking({ metaRows = [{ pixelsId: '123', metaAccessToken: 'token' }], fetchDelay } = {}) {
  const reads = { meta: 0, tiktok: 0, googleAds: 0, public: 0 };
  const posts = [];
  const asRows = (rows) => rows.map((row) => ({ toJSON: () => ({ ...row }) }));
  const stub = (key, rows) => ({
    getActiveFromDB: async () => { reads[key]++; return asRows(rows); },
    getPublicFromDB: async () => { reads.public++; return rows; },
  });
  const context = {
    module: { exports: {} }, console: { warn() {} }, process: { env: { NODE_ENV: 'production' } }, AbortSignal, setTimeout,
    async fetch(url, options) {
      if (fetchDelay) await fetchDelay;
      posts.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
    },
    require(name) {
      if (name === 'crypto') return require('crypto');
      if (name === './tracking.cache') return trackingCache;
      if (name.includes('facebookPixel.service')) return stub('meta', metaRows);
      if (name.includes('tiktokPixel.service')) return stub('tiktok', []);
      if (name.includes('googleAds.service')) return stub('googleAds', []);
      if (name.includes('clientIp')) return { getClientIp: () => '203.0.113.7' };
      if (name.includes('ApiError')) return class extends Error { constructor(code, message) { super(message); this.statusCode = code; } };
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/modules/tracking/tracking.service'), 'utf8'), context);
  return { service: context.module.exports, reads, posts };
}

const req = { headers: { 'user-agent': 'test-agent' } };

test('active pixels are read from the database once, not on every event', async () => {
  const { service, reads, posts } = loadTracking();
  for (const eventName of ['PageView', 'ViewContent', 'AddToCart']) {
    const result = await service.trackEvent({ eventName }, req);
    assert.equal(result.results[0].ok, true);
  }
  assert.equal(posts.length, 3);
  assert.deepEqual([reads.meta, reads.tiktok, reads.googleAds], [1, 1, 0]);
});

test('public config is cached and reloaded after the cache is cleared', async () => {
  const { service, reads } = loadTracking();
  await service.getPublicConfig();
  await service.getPublicConfig();
  assert.equal(reads.public, 3);
  trackingCache.clearTrackingCache();
  await service.getPublicConfig();
  assert.equal(reads.public, 6);
});

test('a failed config load is not cached', async () => {
  let calls = 0;
  const loader = async () => { calls++; if (calls === 1) throw Error('db down'); return 'ok'; };
  await assert.rejects(trackingCache.cached('flaky', loader), /db down/);
  assert.equal(await trackingCache.cached('flaky', loader), 'ok');
  assert.equal(calls, 2);
});

test('queued events answer immediately and still deliver in the background', async () => {
  let release;
  const fetchDelay = new Promise((resolve) => { release = resolve; });
  const { service, posts } = loadTracking({ fetchDelay });
  const result = service.queueEvent({ eventName: 'PageView', eventId: 'pv-1' }, req);
  assert.deepEqual({ ...result }, { eventId: 'pv-1', queued: true });
  assert.equal(posts.length, 0);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.data[0].event_id, 'pv-1');
  assert.equal(posts[0].body.data[0].user_data.client_ip_address, '203.0.113.7');
});

test('queued events without a name are rejected before anything is sent', () => {
  const { service, posts } = loadTracking();
  assert.throws(() => service.queueEvent({}, req), (error) => error.statusCode === 400);
  assert.equal(posts.length, 0);
});

for (const [file, model] of [
  ['facebookPixel/facebookPixel.service', 'facebookPixel'],
  ['tiktokPixel/tiktokPixel.service', 'tiktokPixel'],
  ['googleAds/googleAds.service', 'googleAds'],
]) test(`${model} admin create, update and delete clear the tracking cache`, async () => {
  const row = { Id: 1, get: () => ({}), update: async () => {}, destroy: async () => {} };
  // Only the by-Id lookup finds the row; uniqueness checks find no duplicate.
  const Model = { create: async () => row, findOne: async ({ where }) => (where.Id === 1 ? row : null) };
  const context = { module: { exports: {} }, require(name) {
    if (name === '../../../models') return { [model]: Model };
    if (name === '../tracking/tracking.cache') return trackingCache;
    if (name === 'sequelize') return require('sequelize');
    if (name.includes('ApiError')) return Error;
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve(`../app/modules/${file}`), 'utf8'), context);
  const service = context.module.exports;
  const valid = { pixelsId: '123', metaAccessToken: 't', pixelCode: 'ABC123', accessToken: 't', conversionId: 'AW-1', conversionLabel: 'x' };

  for (const write of [() => service.insertIntoDB(valid), () => service.updateOneFromDB(1, valid), () => service.deleteIdFromDB(1)]) {
    await trackingCache.cached('probe', async () => 'value');
    await write();
    assert.equal(trackingCache.clearTrackingCache().clearedEntries, 0, 'write must clear the cache');
  }
});
