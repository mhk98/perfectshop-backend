const { Op } = require("sequelize");
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");

const LandingPage = () => db.landingPage;
const Product = () => db.product;

const DEFAULT_HEADER = {
  helpText: "Need any help? Call",
  supportPhone: "+8809647-222999",
  supportText: "Contact support",
  supportUrl: "",
  trackOrderText: "🚚 Track your order",
  followUsText: "Follow us:",
  socialLinks: [
    { platform: "facebook", label: "Facebook", url: "" },
    { platform: "youtube", label: "YouTube", url: "" },
    { platform: "tiktok", label: "TikTok", url: "" },
    { platform: "instagram", label: "Instagram", url: "" },
  ],
  logoUrl: null,
  logoAlt: "Website logo",
  backgroundColor: "#1d1d1b",
  textColor: "#ffffff",
  accentColor: "#fbbf24",
  status: true,
};

const DEFAULT_FOOTER = {
  logoUrl: null,
  companyName: "কাফেলা",
  supportLabel: "Customer Supports:",
  supportPhone: "+8809647-222999",
  description: "Corporate and promotional gift item supplier in Bangladesh",
  address: "500/3 Khilgaon Niribili Society, Dhaka Bangladesh",
  quickLinksTitle: "Quick Links",
  quickLinks: [
    { label: "Customer Support", url: "/contact-us" },
    { label: "All Products", url: "/products" },
    { label: "Categories", url: "/categories" },
    { label: "Track My Order", url: "/track-order" },
  ],
  socialLinksTitle: "Follow Us",
  socialLinks: [
    { platform: "facebook", label: "facebook", url: "" },
    { platform: "youtube", label: "youtube", url: "" },
    { platform: "tiktok", label: "tiktok", url: "" },
    { platform: "instagram", label: "instagram", url: "" },
  ],
  importantLinksTitle: "Important Links",
  importantLinks: [{ label: "Refund Policy", url: "/refund-policy" }],
  paymentMethodsImageUrl: null,
  copyrightText: "কাফেলা © 2026.",
  developerText: "Develop by SOFT-HEXIS",
  developerUrl: "",
  status: true,
};

const parseObject = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return !Array.isArray(value) && typeof value === "object" ? value : {};
};

const normalizeLinks = (links, includePlatform = false) => {
  if (!Array.isArray(links)) return [];
  return links
    .filter((link) => link && typeof link === "object")
    .map((link) => ({
      ...(includePlatform
        ? { platform: String(link.platform || link.key || "").trim() }
        : {}),
      label: String(link.label || link.name || "").trim(),
      url: String(link.url || link.link || "").trim(),
    }))
    .filter((link) => link.label || link.url);
};

const normalizeHeader = (payload = {}) => {
  const data = { ...DEFAULT_HEADER, ...parseObject(payload?.data ?? payload) };
  return {
    helpText: String(data.helpText || "").trim(),
    supportPhone: String(data.supportPhone || "").trim(),
    supportText: String(data.supportText || "").trim(),
    supportUrl: String(data.supportUrl || "").trim(),
    trackOrderText: String(data.trackOrderText || "").trim(),
    followUsText: String(data.followUsText || "").trim(),
    socialLinks: normalizeLinks(data.socialLinks, true),
    logoUrl: data.logoUrl || null,
    logoAlt: String(data.logoAlt || "").trim(),
    backgroundColor: String(data.backgroundColor || "#1d1d1b").trim(),
    textColor: String(data.textColor || "#ffffff").trim(),
    accentColor: String(data.accentColor || "#fbbf24").trim(),
    status: data.status !== false,
  };
};

const getHeaderFromDB = async () => {
  const row = await db.siteSetting.findOne({ where: { settingType: "header" } });
  return { ...DEFAULT_HEADER, ...parseObject(row?.data) };
};

const upsertHeaderIntoDB = async (payload) => {
  const current = await getHeaderFromDB();
  const incoming = parseObject(payload?.data ?? payload);
  const data = normalizeHeader({ ...current, ...incoming });
  const [row, created] = await db.siteSetting.findOrCreate({
    where: { settingType: "header" },
    defaults: { settingType: "header", data },
  });
  if (!created) await row.update({ data });
  return data;
};

const normalizeFooter = (payload = {}) => {
  const data = { ...DEFAULT_FOOTER, ...parseObject(payload?.data ?? payload) };
  return {
    logoUrl: data.logoUrl || null,
    companyName: String(data.companyName || "").trim(),
    supportLabel: String(data.supportLabel || "").trim(),
    supportPhone: String(data.supportPhone || "").trim(),
    description: String(data.description || "").trim(),
    address: String(data.address || "").trim(),
    quickLinksTitle: String(data.quickLinksTitle || "").trim(),
    quickLinks: normalizeLinks(data.quickLinks),
    socialLinksTitle: String(data.socialLinksTitle || "").trim(),
    socialLinks: normalizeLinks(data.socialLinks, true),
    importantLinksTitle: String(data.importantLinksTitle || "").trim(),
    importantLinks: normalizeLinks(data.importantLinks),
    paymentMethodsImageUrl: data.paymentMethodsImageUrl || null,
    copyrightText: String(data.copyrightText || "").trim(),
    developerText: String(data.developerText || "").trim(),
    developerUrl: String(data.developerUrl || "").trim(),
    status: data.status !== false,
  };
};

const getFooterFromDB = async () => {
  const row = await db.siteSetting.findOne({ where: { settingType: "footer" } });
  return { ...DEFAULT_FOOTER, ...parseObject(row?.data) };
};

const upsertFooterIntoDB = async (payload) => {
  const current = await getFooterFromDB();
  const incoming = parseObject(payload?.data ?? payload);
  const data = normalizeFooter({ ...current, ...incoming });
  const [row, created] = await db.siteSetting.findOrCreate({
    where: { settingType: "footer" },
    defaults: { settingType: "footer", data },
  });
  if (!created) await row.update({ data });
  return data;
};

const normalizePayload = async (payload = {}) => {
  const productId = payload.productId ? Number(payload.productId) : null;
  let product = payload.product || null;

  if (productId && Product()) {
    const productRow = await Product().findOne({ where: { Id: productId } });
    product = productRow?.name || product;
  }

  return {
    pageType: payload.pageType || "Campaign",
    productId,
    product,
    title: payload.title || payload.campaignTitle || product || "Untitled Campaign",
    subTitle: payload.subTitle || null,
    bannerImageUrl: payload.bannerImageUrl || null,
    prizeImageUrl: payload.prizeImageUrl || null,
    reviewImages: payload.reviewImages
      ? (typeof payload.reviewImages === "string" ? payload.reviewImages : JSON.stringify(payload.reviewImages))
      : null,
    shortDescription: payload.shortDescription || null,
    video: payload.video || null,
    reviewTitle: payload.reviewTitle === undefined ? null : payload.reviewTitle,
    descriptionTitle: payload.descriptionTitle || null,
    description: payload.description || null,
    whyChooseTitle: payload.whyChooseTitle || null,
    whyChooseUs: payload.whyChooseUs || null,
    price: payload.price === undefined || payload.price === "" ? null : Number(payload.price),
    originalPrice: payload.originalPrice === undefined || payload.originalPrice === "" ? null : Number(payload.originalPrice),
    phone: payload.phone || null,
    template: payload.template || payload.campaignTemplate || "Template Design 1",
    countdown: payload.countdown || payload.countdownTime || null,
    regularData: payload.regularData
      ? (typeof payload.regularData === "string" ? payload.regularData : JSON.stringify(payload.regularData))
      : null,
    status: payload.status === undefined ? true : Boolean(payload.status),
  };
};

const insertIntoDB = async (payload) => LandingPage().create(await normalizePayload(payload));

const getAllFromDB = async (filters, options) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters || {};
  const where = searchTerm
    ? {
      [Op.or]: [
        { title: { [Op.like]: `%${searchTerm}%` } },
        { product: { [Op.like]: `%${searchTerm}%` } },
        { template: { [Op.like]: `%${searchTerm}%` } },
      ],
    }
    : {};

  const [data, count] = await Promise.all([
    LandingPage().findAll({ where, offset: skip, limit, order: [["createdAt", "DESC"]], paranoid: true }),
    LandingPage().count({ where }),
  ]);

  return { meta: { count, page, limit }, data };
};

const getOneFromDB = async (id) => {
  const row = await LandingPage().findOne({ where: { Id: id }, paranoid: true });
  if (!row) throw new ApiError(404, "Landing page not found");
  return row;
};

const getPublicOneFromDB = async (id) => {
  const row = await LandingPage().findOne({
    where: { Id: id, status: true },
    paranoid: true,
  });
  if (!row) throw new ApiError(404, "Landing page not found or inactive");
  return row;
};

const updateOneFromDB = async (id, payload) => {
  const row = await LandingPage().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Landing page not found");
  const existing = row.get({ plain: true });
  await row.update(await normalizePayload({ ...existing, ...payload }));
  return row;
};

const deleteIdFromDB = async (id) => {
  const row = await LandingPage().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Landing page not found");
  await row.destroy();
  return { deleted: true };
};

module.exports = {
  insertIntoDB,
  getAllFromDB,
  getOneFromDB,
  getPublicOneFromDB,
  updateOneFromDB,
  deleteIdFromDB,
  getHeaderFromDB,
  upsertHeaderIntoDB,
  getFooterFromDB,
  upsertFooterIntoDB,
};
