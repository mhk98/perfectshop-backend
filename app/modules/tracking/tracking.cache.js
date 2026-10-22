// Active pixel / Google Ads configs change rarely but were read from the
// database on every tracked event and every storefront page load. Keep them in
// memory per process; the pixel services clear this on every admin write, so
// only another server process can serve a stale copy, for at most TTL_MS.
const TTL_MS = 5 * 60 * 1000;
const entries = new Map();

const cached = (key, loader) => {
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;

  const value = Promise.resolve().then(loader);
  entries.set(key, { value, expiresAt: Date.now() + TTL_MS });
  // A failed load must not be served from the cache.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
};

const clearTrackingCache = () => {
  const clearedEntries = entries.size;
  entries.clear();
  return { cache: "trackingConfig", clearedEntries };
};

module.exports = { cached, clearTrackingCache, TTL_MS };
