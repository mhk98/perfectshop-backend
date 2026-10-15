const { Op } = require("sequelize");
const { createHash } = require("node:crypto");

// Keep the named MySQL lock on one connection for the entire sweep. This also
// prevents duplicate courier requests when several server processes are running.
async function withSyncLock(sequelize, work) {
  const connection = await sequelize.connectionManager.getConnection();
  const name = `courier-sync:${createHash("sha256").update(sequelize.getDatabaseName()).digest("hex").slice(0, 40)}`;
  const query = (sql) => new Promise((resolve, reject) => {
    connection.query(sql, [name], (error, rows) => error ? reject(error) : resolve(rows));
  });
  let locked = false;
  try {
    const rows = await query("SELECT GET_LOCK(?, 0) AS acquired");
    locked = Number(rows[0].acquired) === 1;
    if (locked) await work();
  } finally {
    try {
      if (locked) await query("SELECT RELEASE_LOCK(?) AS released");
    } catch (error) {
      // Never return a session that may still own the lock to the pool.
      await sequelize.connectionManager.destroyConnection(connection);
      throw error;
    }
    await sequelize.connectionManager.releaseConnection(connection);
  }
}

async function syncCourierOrders({ Order, service, shouldStop = () => false, pause = () => new Promise(resolve => setTimeout(resolve, 500)), logger = console }) {
  let cursor = 0;
  // Snapshot the upper bound so new orders cannot extend a sweep indefinitely.
  const upperBound = await Order.max("Id");
  if (!upperBound) return;
  while (!shouldStop()) {
    const orders = await Order.findAll({
      attributes: ["Id", "courier", "note"],
      where: { Id: { [Op.gt]: cursor, [Op.lte]: upperBound }, status: { [Op.in]: ["in_courier", "on_hold"] } },
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
  let stopped = false;
  let running = Promise.resolve();
  let timer;
  const schedule = (delay) => {
    timer = setTimeout(() => {
      running = lock(db.sequelize, () => syncCourierOrders({ Order: db.order, service, shouldStop: () => stopped, logger }))
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

module.exports = { startCourierStatusSync, syncCourierOrders, withSyncLock };
