// Keeps the result of `load` for `ttlMs`, so hot read paths (every tracking
// event) don't query the DB each time. Concurrent callers share one load, and a
// failed load is not cached. Call clear() after writes so changes apply at once.
const createTtlCache = (load, ttlMs = 60_000) => {
  let value;
  let expiresAt = 0;
  let pending = null;
  let generation = 0;

  const get = () => {
    if (Date.now() < expiresAt) return Promise.resolve(value);
    if (pending) return pending;
    const loadGeneration = generation;
    pending = Promise.resolve()
      .then(load)
      .then((result) => {
        // A clear() during the load means the result may predate a write.
        if (loadGeneration === generation) {
          value = result;
          expiresAt = Date.now() + ttlMs;
        }
        return result;
      })
      .finally(() => {
        if (loadGeneration === generation) pending = null;
      });
    return pending;
  };

  const clear = () => {
    generation += 1;
    value = undefined;
    expiresAt = 0;
    pending = null;
  };

  return { get, clear };
};

module.exports = { createTtlCache };
