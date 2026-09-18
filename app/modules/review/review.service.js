const { Op } = require("sequelize");
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const Review = db.review;

const insertIntoDB = async (data) => {
  return await Review.create(data);
};

const getAllFromDB = async (filters, options) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm, ...filterData } = filters;
  const andConditions = [];

  if (searchTerm) {
    andConditions.push({
      [Op.or]: [
        { customerName: { [Op.like]: `%${searchTerm}%` } },
        { productName: { [Op.like]: `%${searchTerm}%` } },
      ],
    });
  }

  if (Object.keys(filterData).length > 0) {
    andConditions.push({
      [Op.and]: Object.entries(filterData).map(([key, value]) => ({
        [key]: { [Op.eq]: value },
      })),
    });
  }

  const whereConditions = andConditions.length ? { [Op.and]: andConditions } : {};

  const result = await Review.findAll({
    where: whereConditions,
    offset: skip,
    limit,
    paranoid: true,
    order: options.sortBy && options.sortOrder
      ? [[options.sortBy, options.sortOrder.toUpperCase()]]
      : [["createdAt", "DESC"]],
  });

  const count = await Review.count({ where: whereConditions });

  return { meta: { count, page, limit }, data: result };
};

const getAllFromDBWithoutQuery = async () => {
  return await Review.findAll({ paranoid: true, order: [["createdAt", "DESC"]] });
};

const getPublicApprovedReviews = async (filters = {}, options = {}) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination({
    page: options.page || 1,
    limit: options.limit || 20,
  });
  const andConditions = [{ status: "approved" }];

  const productMatch = [];
  if (filters.productId) {
    productMatch.push({ productId: { [Op.eq]: filters.productId } });
  }
  if (filters.productName) {
    productMatch.push({ productName: { [Op.like]: `%${filters.productName}%` } });
  }
  if (productMatch.length) {
    andConditions.push({ [Op.or]: productMatch });
  }

  const whereConditions = { [Op.and]: andConditions };
  const data = await Review.findAll({
    where: whereConditions,
    offset: skip,
    limit,
    paranoid: true,
    attributes: ["Id", "productId", "productName", "customerName", "rating", "comment", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
  const count = await Review.count({ where: whereConditions });

  return { meta: { count, page, limit }, data };
};

const getDataById = async (id) => {
  return await Review.findOne({ where: { Id: id } });
};

const updateOneFromDB = async (id, payload) => {
  return await Review.update(payload, { where: { Id: id } });
};

const deleteIdFromDB = async (id) => {
  return await Review.destroy({ where: { Id: id } });
};

const ReviewService = {
  insertIntoDB, getAllFromDB, getAllFromDBWithoutQuery, getPublicApprovedReviews, getDataById, updateOneFromDB, deleteIdFromDB,
};

module.exports = ReviewService;
