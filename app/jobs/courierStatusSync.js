const { Op } = require("sequelize");
const { createHash } = require("node:crypto");

// Keep the named MySQL lock on one connection for the entire sweep. This also
// prevents duplicate courier requests when several server processes are running.
// The connection is opened outside the request pool: a sweep can take minutes
// and the pool only has a few connections. Closing the session releases the
// lock, so no RELEASE_LOCK is needed and a locked session never reaches the pool.
async function withSyncLock(sequelize, work) {
  const manager = sequelize.connectionManager;
  const connection = await manager.connect(manager.config.replication?.write || manager.config);
  // MySQL may drop the idle session mid-sweep; without a listener that error
  // would crash the process.
  connection.on?.("error", () => {});
  const name = `courier-sync:${createHash("sha256").update(sequelize.getDatabaseName()).digest("hex").slice(0, 40)}`;
  try {
    const rows = await new Promise((resolve, reject) => {
      connection.query("SELECT GET_LOCK(?, 0) AS acquired", [name], (error, result) =>
        error ? reject(error) : resolve(result));
    });
    if (Number(rows[0].acquired) === 1) await work();
  } finally {
    await manager.disconnect(connection).catch(() => connection.destroy?.());
  }
}

// Parcels older than this are almost always settled or lost; sweeping them
// every interval cost one courier API call each. Staff can still sync an old
// order from the admin panel.
const DEFAULT_MAX_AGE_DAYS = 30;
function getMaxAgeDays(env = process.env) {
  const days = Number(env.COURIER_SYNC_MAX_AGE_DAYS);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_MAX_AGE_DAYS;
}

async function syncCourierOrders({ Order, service, shouldStop = () => false, pause = () => new Promise(resolve => setTimeout(resolve, 500)), logger = console, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = () => Date.now() }) {
  let cursor = 0;
  // Snapshot the upper bound so new orders cannot extend a sweep indefinitely.
  const upperBound = await Order.max("Id");
  if (!upperBound) return;
  const createdAfter = new Date(now() - maxAgeDays * 24 * 60 * 60 * 1000);
  while (!shouldStop()) {
    const orders = await Order.findAll({
      attributes: ["Id", "courier", "note"],
      where: { Id: { [Op.gt]: cursor, [Op.lte]: upperBound }, status: { [Op.in]: ["in_courier", "on_hold"] }, createdAt: { [Op.gte]: createdAfter } },
      order: [["Id", "ASC"]], limit: 100, raw: true,
    });
    if (!orders.length) break;
    for (const order of orders) {
      if (shouldStop()) return;
      cursor = order.Id;
      const provider = String(order.courier || "").trim().toLowerCase();
      let meta = {};
      try { meta = JSON.parse(order.note || "{}"); } catch { /* Legacy text note. */ }
      const tracking = meta?.courierIntegration?.[provider];
      if (provider !== "steadfast" && provider !== "pathao") continue;
      if (provider === "pathao" && !tracking?.consignmentId && !tracking?.trackingCode) continue;
      try {
        const sync = provider === "steadfast" ? service.syncSteadfastStatusInDB : service.syncPathaoStatusInDB;
        await sync(order.Id, { automatic: true });
      } catch {
        // Do not log provider responses: they can contain customer information.
        logger.warn(`[courier-sync] ${provider} order ${order.Id} failed; will retry next sweep`);
      }
      if (!shouldStop()) await pause();
    }
  }
}

function startCourierStatusSync({ env = process.env, db, service, logger = console, lock = withSyncLock } = {}) {
  if (String(env.COURIER_STATUS_SYNC_ENABLED || "true").toLowerCase() === "false") return async () => {};
  db ||= require("../../models");
  service ||= require("../modules/order/order.service");
  const configured = Number(env.COURIER_STATUS_SYNC_INTERVAL_MS);
  const interval = Number.isFinite(configured) && configured >= 60000 ? configured : 300000;
  const maxAgeDays = getMaxAgeDays(env);
  let stopped = false;
  let running = Promise.resolve();
  let timer;
  const schedule = (delay) => {
    timer = setTimeout(() => {
      running = lock(db.sequelize, () => syncCourierOrders({ Order: db.order, service, shouldStop: () => stopped, logger, maxAgeDays }))
        .catch(() => logger.warn("[courier-sync] Sweep failed; will retry next interval"))
        .finally(() => { if (!stopped) schedule(interval); });
    }, delay);
    timer.unref?.();
  };
  schedule(10000);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

module.exports = { startCourierStatusSync, syncCourierOrders, withSyncLock, getMaxAgeDays };
