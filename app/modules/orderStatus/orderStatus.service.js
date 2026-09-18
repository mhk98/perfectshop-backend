const { Op } = require("sequelize");
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const M = () => db.orderStatus;

const DEFAULT_ORDER_STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "packaging", label: "Packaging" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "returned", label: "Returned" },
  { key: "on_hold", label: "On Hold" },
  { key: "in_courier", label: "In Courier" },
  { key: "delivered", label: "Delivered" },
  { key: "incomplete", label: "Incomplete" },
];

const toOrderStatusKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeRow = (row) => {
  const plain = typeof row?.toJSON === "function" ? row.toJSON() : row;
  const label = String(plain?.name || "").trim();
  const key = toOrderStatusKey(label);
  return { ...plain, key, label };
};

const getActiveStatusOptions = async () => {
  const rows = await M().findAll({
    where: { status: { [Op.ne]: "Inactive" } },
    paranoid: true,
    order: [["createdAt", "ASC"], ["Id", "ASC"]],
  });

  const normalized = [
    ...DEFAULT_ORDER_STATUSES,
    ...rows.map(normalizeRow).filter((row) => row.key),
  ];

  const seen = new Set();
  return normalized.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
};

const getActiveStatusKeys = async () =>
  (await getActiveStatusOptions()).map((status) => status.key);

const insertIntoDB = async (data) => M().create(data);

const getAllFromDB = async (filters, options) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters || {};
  const where = searchTerm ? { name: { [Op.like]: `%${searchTerm}%` } } : {};
  const [data, count] = await Promise.all([
    M().findAll({ where, offset: skip, limit, paranoid: true, order: [["createdAt", "ASC"]] }),
    M().count({ where }),
  ]);
  return { meta: { count, page, limit }, data };
};

const getPublicFromDB = async () => {
  const data = await getActiveStatusOptions();
  return { meta: { count: data.length, page: 1, limit: data.length }, data };
};

const updateOneFromDB = async (id, payload) => {
  const row = await M().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Order status not found");
  await row.update(payload);
  return row;
};

const deleteIdFromDB = async (id) => {
  const row = await M().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Order status not found");
  await row.destroy();
  return { deleted: true };
};

module.exports = {
  DEFAULT_ORDER_STATUSES,
  toOrderStatusKey,
  getActiveStatusOptions,
  getActiveStatusKeys,
  insertIntoDB,
  getAllFromDB,
  getPublicFromDB,
  updateOneFromDB,
  deleteIdFromDB,
};
