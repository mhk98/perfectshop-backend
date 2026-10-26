const { Op } = require("sequelize");
const db = require("../../../models");
const M = () => db.visitorStat;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

// In-memory store: ip -> last seen timestamp (ms)
// Visitors active within last 5 minutes are counted as "active"
const activeVisitorMap = new Map();
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const pruneExpired = () => {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [ip, ts] of activeVisitorMap.entries()) {
    if (ts < cutoff) activeVisitorMap.delete(ip);
  }
};

const clearRuntimeCache = () => {
  const clearedEntries = activeVisitorMap.size;
  activeVisitorMap.clear();
  return { cache: "activeVisitors", clearedEntries };
};

// Visits are counted in memory and written in one query per day every
// FLUSH_INTERVAL_MS, instead of a findOrCreate + increment on every page load.
const pendingVisits = new Map(); // date -> visits not yet written
const FLUSH_INTERVAL_MS = 30 * 1000;
let flushTimer = null;
let flushing = null;

const writePending = async () => {
  for (const [date, count] of [...pendingVisits.entries()]) {
    pendingVisits.delete(date);
    try {
      const [row] = await M().findOrCreate({ where: { date }, defaults: { date, visitors: 0 } });
      await row.increment("visitors", { by: count });
    } catch (error) {
      // Keep the count for the next flush rather than losing it.
      pendingVisits.set(date, (pendingVisits.get(date) || 0) + count);
      console.error(`Visitor stat flush failed for ${date}: ${error.message}`);
    }
  }
  pruneExpired();
};

const flush = () => {
  if (!flushing) flushing = writePending().finally(() => { flushing = null; });
  return flushing;
};

const track = async (ip) => {
  activeVisitorMap.set(ip || "unknown", Date.now());

  const date = today();
  pendingVisits.set(date, (pendingVisits.get(date) || 0) + 1);
  if (!flushTimer) {
    flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }
  return { date };
};

const getStats = async () => {
  await flush();

  const todayStr       = today();
  const yesterdayStr   = daysAgo(1);
  const weekStart      = daysAgo(7);
  const lastWeekStart  = daysAgo(14);
  const monthStart     = daysAgo(30);
  const lastMonthStart = daysAgo(60);

  const rows = await M().findAll({
    where: { date: { [Op.gte]: lastMonthStart } },
    paranoid: true,
    order: [["date", "ASC"]],
  });

  const sum = (from, to) =>
    rows.filter((r) => r.date >= from && r.date <= to).reduce((acc, r) => acc + r.visitors, 0);

  const todayRow     = rows.find((r) => r.date === todayStr);
  const yesterdayRow = rows.find((r) => r.date === yesterdayStr);
  const total        = await M().sum("visitors") || 0;
  const chart        = rows.map((r) => ({ date: r.date, Visitors: r.visitors }));

  pruneExpired();

  return {
    activeVisitor:    activeVisitorMap.size,
    todayVisitor:     todayRow?.visitors    ?? 0,
    yesterdayVisitor: yesterdayRow?.visitors ?? 0,
    thisWeekVisitor:  sum(weekStart, todayStr),
    lastWeekVisitor:  sum(lastWeekStart, daysAgo(8)),
    thisMonthVisitor: sum(monthStart, todayStr),
    lastMonthVisitor: sum(lastMonthStart, daysAgo(31)),
    totalVisitor:     total,
    chart,
  };
};

module.exports = { track, getStats, clearRuntimeCache, flush };
