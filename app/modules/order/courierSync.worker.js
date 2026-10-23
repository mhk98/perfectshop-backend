const { Op } = require("sequelize");

// Dependencies are injectable so the scheduler can be tested without a live DB.
// `pendingWhere` picks the rows still moving with the courier; scratch cards
// reuse this worker with their own condition.
const createCourierSyncWorker = ({
  Order,
  service,
  logger = console,
  intervalMs = 300000,
  // Courier APIs rate limit per account, so space the lookups out.
  delayMs = 400,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pendingWhere = { status: { [Op.in]: ["in_courier", "on_hold"] } },
}) => {
  let timer;
  let active;
  let stopped = false;

  const sweep = async () => {
    let cursor = 0;
    while (!stopped) {
      const orders = await Order.findAll({
        attributes: ["Id", "courier"],
        where: {
          Id: { [Op.gt]: cursor },
          ...pendingWhere,
          courier: { [Op.in]: ["Steadfast", "Pathao"] },
        },
        order: [["Id", "ASC"]],
        limit: 100,
      });
      if (!orders.length) break;
      for (const order of orders) {
        if (stopped) break;
        cursor = order.Id;
        try {
          const sync = String(order.courier).toLowerCase() === "steadfast"
            ? service.syncSteadfastStatusInDB : service.syncPathaoStatusInDB;
          await sync(order.Id, { automatic: true });
        } catch (error) {
          // Once rate limited every following lookup fails too; retry next interval.
          if (error?.statusCode === 429) {
            logger.warn(`Courier sync paused at order ${order.Id}: rate limited, retrying next run`);
            return;
          }
          logger.warn(`Courier sync failed for order ${order.Id}: ${error.message}`);
        }
        if (delayMs > 0) await wait(delayMs);
      }
    }
  };

  const run = () => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = sweep().catch((error) => {
      logger.error(`Courier sync failed: ${error.message}`);
    }).finally(() => { active = null; });
    return active;
  };

  return {
    run,
    start() {
      if (timer || stopped) return;
      void run();
      timer = setInterval(run, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
};

module.exports = { createCourierSyncWorker };
