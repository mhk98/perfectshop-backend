const { Op } = require("sequelize");
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const { createTtlCache } = require("../../../shared/ttlCache");
const M = () => db.facebookPixel;

const normalizePayload = (data = {}) => {
  const pixelsId = String(data.pixelsId || "").trim();
  const metaAccessToken = String(data.metaAccessToken || "").trim();
  if (!/^\d+$/.test(pixelsId)) throw new ApiError(400, "A valid numeric Meta Pixel ID is required");
  if (!metaAccessToken) throw new ApiError(400, "Meta access token is required");
  return {
    pixelsId,
    metaAccessToken,
    testEventId: String(data.testEventId || "").trim() || null,
    status: data.status === false || data.status === "Inactive" ? "Inactive" : "Active",
  };
};

const ensureUnique = async (pixelsId, excludeId) => {
  const where = { pixelsId };
  if (excludeId) where.Id = { [Op.ne]: excludeId };
  if (await M().findOne({ where })) throw new ApiError(409, "This Meta Pixel ID already exists");
};

const insertIntoDB = async (data) => {
  const payload = normalizePayload(data);
  await ensureUnique(payload.pixelsId);
  const row = await M().create(payload);
  activeCache.clear();
  return row;
};

const getAllFromDB = async (filters, options) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters || {};
  const where = searchTerm ? { pixelsId: { [Op.like]: `%${searchTerm}%` } } : {};
  const [data, count] = await Promise.all([
    M().findAll({ where, offset: skip, limit, paranoid: true, order: [["createdAt", "DESC"]] }),
    M().count({ where }),
  ]);
  return { meta: { count, page, limit }, data };
};

// Read on every tracking event; cleared below whenever a config changes.
const activeCache = createTtlCache(() =>
  M().findAll({ where: { status: "Active" }, paranoid: true, order: [["createdAt", "DESC"]] }),
);

const getActiveFromDB = () => activeCache.get();

const getPublicFromDB = async () => {
  const rows = await getActiveFromDB();
  return rows.map((row) => {
    const plain = row.toJSON();
    return { Id: plain.Id, pixelsId: plain.pixelsId, testEventId: plain.testEventId, status: plain.status };
  });
};

const updateOneFromDB = async (id, payload) => {
  const row = await M().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Pixel not found");
  const data = normalizePayload({ ...row.get({ plain: true }), ...payload });
  await ensureUnique(data.pixelsId, row.Id);
  await row.update(data);
  activeCache.clear();
  return row;
};

const deleteIdFromDB = async (id) => {
  const row = await M().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Pixel not found");
  await row.destroy();
  activeCache.clear();
  return { deleted: true };
};

module.exports = { insertIntoDB, getAllFromDB, getActiveFromDB, getPublicFromDB, updateOneFromDB, deleteIdFromDB };
