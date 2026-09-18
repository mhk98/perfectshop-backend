const crypto = require("crypto");
const { Op, fn, col, literal } = require("sequelize");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const paginationHelpers = require("../../../helpers/paginationHelper");
const { ORDER_STATUS_VALUES, ORDER_SEARCHABLE_FIELDS } = require("./order.constants");
const SiteSettingService = require("../siteSetting/siteSetting.service");
const OrderStatusService = require("../orderStatus/orderStatus.service");
const CouponCodeService = require("../couponCode/couponCode.service");
const NotificationService = require("../notification/notification.service");
const SmsMarketingService = require("../smsMarketing/smsMarketing.service");

const Order = db.order;
const IpBlock = db.ipBlock;
const User = db.user;
const FAILED_DELIVERY_STATUSES = ["cancelled", "returned", "on_hold"];
const MANUAL_FRAUD_STATUSES = ["safe", "fake"];
const ORDER_ASSIGNMENT_USER_ATTRIBUTES = [
  "Id",
  "FirstName",
  "LastName",
  "Email",
  "Phone",
  "role",
  "status",
];

const LOOPBACK_IP_VARIANTS = [
  "127.0.0.1",
  "::1",
  "0:0:0:0:0:0:0:1",
  "localhost",
];

const normalizeIpAddress = (value) =>
  String(value || "")
    .trim()
    .replace(/^::ffff:/, "");

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");

const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const getUserDisplayName = (user = {}) =>
  [user.FirstName, user.LastName].filter(Boolean).join(" ").trim() ||
  user.Name ||
  user.Email ||
  user.Phone ||
  `User ${user.Id}`;

const ORDER_ASSIGNMENT_INCLUDES = [
  {
    model: User,
    as: "assignedEmployee",
    attributes: ORDER_ASSIGNMENT_USER_ATTRIBUTES,
    required: false,
  },
  {
    model: User,
    as: "assignedByUser",
    attributes: ORDER_ASSIGNMENT_USER_ATTRIBUTES,
    required: false,
  },
];

const withAssignmentUsers = (order = {}) => {
  const assignedEmployee = order.assignedEmployee || null;
  const assignedByUser = order.assignedByUser || null;
  return {
    ...order,
    assignedEmployee,
    assignedByUser,
    assignedEmployeeName: assignedEmployee
      ? getUserDisplayName(assignedEmployee)
      : order.assignedEmployeeName,
    assignedByName: assignedByUser
      ? getUserDisplayName(assignedByUser)
      : order.assignedByName,
  };
};

const canSeeAllAssignedOrders = (user = {}) =>
  ["superadmin", "admin"].includes(normalizeRole(user.role));

const applyOrderAssignmentScope = (where, user = {}) => {
  if (!user?.Id || canSeeAllAssignedOrders(user)) return where;
  if (normalizeRole(user.role) === "employee") {
    return {
      [Op.and]: [
        where,
        { assignedEmployeeId: Number(user.Id) },
      ],
    };
  }
  return where;
};

const normalizeDeviceId = (value) =>
  String(value || "")
    .trim()
    .slice(0, 128);

const getIpVariants = (value) => {
  const ip = normalizeIpAddress(value);
  if (!ip) return [];
  if (LOOPBACK_IP_VARIANTS.includes(ip)) return LOOPBACK_IP_VARIANTS;
  return [...new Set([ip, String(value || "").trim()].filter(Boolean))];
};

const generateOrderId = async () => {
  const last = await Order.findOne({
    order: [["Id", "DESC"]],
    paranoid: false,
  });
  const nextNum = last ? last.Id + 1 : 1;
  return `TJ-${String(nextNum).padStart(4, "0")}`;
};

const parseOrderMeta = (note) => {
  if (!note || typeof note !== "string") return {};
  try {
    const parsed = JSON.parse(note);
    return parsed && parsed.__frontendOrder ? parsed : {};
  } catch {
    return {};
  }
};

const parseAnyOrderMeta = (note) => {
  if (!note || typeof note !== "string") return {};
  try {
    const parsed = JSON.parse(note);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const maskPhone = (phone) => {
  const digits = normalizePhone(phone);
  if (digits.length < 7) return phone || "";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const hashOrderOtp = (orderId, phone, otp) =>
  crypto
    .createHash("sha256")
    .update(`${orderId}:${normalizePhone(phone)}:${otp}:${process.env.JWT_SECRET || process.env.JWT_REFRESH_SECRET || "kafela-order-otp"}`)
    .digest("hex");

const toPublicOrder = (order) => {
  const plain = typeof order.toJSON === "function" ? order.toJSON() : order;
  const meta = parseOrderMeta(plain.note);
  const items = Array.isArray(meta.items)
    ? meta.items
    : [{
        name: plain.productName,
        image: plain.productImage || undefined,
        qty: plain.quantity || 1,
        price: Number(plain.totalBill || 0),
      }];

  return {
    ...withAssignmentUsers(plain),
    invoiceId: plain.orderId,
    customerAddress: meta.customerAddress || [plain.customerArea, plain.customerDistrict].filter(Boolean).join(", "),
    paymentMethod: meta.paymentMethod || "cod",
    paymentStatus: meta.paymentStatus || "pending",
    items,
    subtotal: meta.subtotal ?? Number(plain.totalBill || 0),
    deliveryCharge: meta.deliveryCharge ?? 0,
    total: meta.total ?? Number(plain.totalBill || 0),
  };
};

const normalizeFraudStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["fake", "fake_order"].includes(normalized)) return "fake";
  if (["safe", "clear"].includes(normalized)) return "safe";
  if (["high_risk", "high-risk", "risk"].includes(normalized)) return "high_risk";
  return "";
};

const unitToMs = (unit) => {
  const normalized = String(unit || "hour").trim().toLowerCase();
  if (normalized.startsWith("min")) return 60 * 1000;
  if (normalized.startsWith("day")) return 24 * 60 * 60 * 1000;
  if (normalized.startsWith("month")) return 30 * 24 * 60 * 60 * 1000;
  return 60 * 60 * 1000;
};

const formatDuration = (blockTime, timeUnit) =>
  `${blockTime} ${timeUnit || "Hour"}`;

const normalizeRuleKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["same_ip", "sameip", "ip"].includes(normalized)) return "same_ip";
  if (["same_device", "samedevice", "device"].includes(normalized)) return "same_device";
  if (["invalid_phone", "invalidphone", "phone"].includes(normalized)) return "invalid_phone";
  if (["suspicious_address", "fake_address", "address", "unknown_address"].includes(normalized)) {
    return "suspicious_address";
  }
  return "";
};

const normalizeDurationUnit = (value) => {
  const normalized = String(value || "hour").trim().toLowerCase();
  if (normalized.startsWith("day")) return "Day";
  if (normalized.startsWith("month")) return "Month";
  if (normalized.startsWith("unknown") || normalized.startsWith("permanent")) return "Unknown";
  return "Hour";
};

const getRuleDurationMs = (rule = {}) => {
  const unit = normalizeDurationUnit(rule.durationUnit || rule.timeUnit);
  if (unit === "Unknown") return null;
  const value = Number(rule.durationValue || rule.blockTime || rule.time || 1);
  return Math.max(1, value || 1) * unitToMs(unit);
};

const getRuleDurationLabel = (rule = {}) => {
  const unit = normalizeDurationUnit(rule.durationUnit || rule.timeUnit);
  if (unit === "Unknown") return "Unknown time";
  const value = Number(rule.durationValue || rule.blockTime || rule.time || 1);
  return `${Math.max(1, value || 1)} ${unit}`;
};

const isInvalidPhoneNumber = (value) => {
  const digits = normalizePhone(value);
  return !/^01\d{9}$/.test(digits);
};

const normalizeOrderBlockRules = (data = {}) => {
  const rawRules = Array.isArray(data.rules)
    ? data.rules
    : Object.entries(data.rules || {}).map(([key, rule]) => ({ key, ...rule }));

  return rawRules
    .map((rule) => ({
      key: normalizeRuleKey(rule.key || rule.type || rule.category),
      enabled: rule.enabled !== false && rule.status !== false,
      durationValue: Number(rule.durationValue || rule.blockTime || rule.time || 1),
      durationUnit: normalizeDurationUnit(rule.durationUnit || rule.timeUnit),
    }))
    .filter((rule) => rule.key && rule.enabled);
};

const getOrderBlockRuleSettings = async () => {
  const row = await SiteSettingService.getByType("order_block").catch(() => null);
  const data = row?.data || {};
  if (data.status === false) return [];
  return normalizeOrderBlockRules(data);
};

const getOrderBlockSettings = async () => {
  const settings = await SiteSettingService.getPublic();
  if (settings.status === false) return null;

  const limit = Number(settings.orderBlockLimit || 0);
  const blockTime = Number(settings.blockTime || 0);
  if (!limit || !blockTime) return null;

  const timeUnit = settings.timeUnit || "Hour";
  return {
    limit,
    blockTime,
    timeUnit,
    blockDurationMs: blockTime * unitToMs(timeUnit),
  };
};

const getOrderAddress = (payload = {}) => {
  const direct = payload.customerAddress || payload.address;
  if (direct) return String(direct).trim();

  const note = String(payload.note || "");
  const addressLine = note
    .split(/\r?\n/)
    .find((line) => /^address\s*:/i.test(line.trim()));
  if (addressLine) return addressLine.replace(/^address\s*:/i, "").trim();

  return String(payload.customerArea || "").trim();
};

const isSuspiciousAddress = (value) => {
  const address = String(value || "").trim();
  if (!address) return false;

  const normalized = address.toLowerCase();
  if (
    /\b(unknown|fake|test|asdf|qwer|n\/a|na|null|none)\b/i.test(address) ||
    /(হিজিবিজি|অজানা|ভুয়া|ভুয়া|ঠিকানা নাই)/i.test(address)
  ) {
    return true;
  }

  const lettersAndDigits = address.replace(/[^\p{L}\p{N}]/gu, "");
  if (lettersAndDigits.length < 5) return true;

  const uniqueChars = new Set(lettersAndDigits.toLowerCase()).size;
  if (lettersAndDigits.length >= 8 && uniqueChars <= 3) return true;
  if (/(.)\1{5,}/u.test(lettersAndDigits)) return true;
  if (/^(.)\1+$/u.test(lettersAndDigits)) return true;
  if (/^[a-z]{8,}$/i.test(normalized) && !/[aeiou]/i.test(normalized)) return true;

  return false;
};

const getActiveBlockWhere = ({ ipAddress, deviceId }) => {
  const identityConditions = [];
  const ipVariants = getIpVariants(ipAddress);
  if (ipVariants.length) identityConditions.push({ ip: { [Op.in]: ipVariants } });
  if (deviceId) identityConditions.push({ deviceId });
  if (!identityConditions.length) return null;

  return {
    [Op.and]: [
      { [Op.or]: identityConditions },
      {
        [Op.or]: [
          { expiresAt: null },
          { expiresAt: { [Op.gt]: new Date() } },
        ],
      },
    ],
  };
};

const createTimedIpBlock = async ({ ipAddress, deviceId, settings, rule, reason }) => {
  if (!IpBlock || (!ipAddress && !deviceId)) return null;

  const ip = normalizeIpAddress(ipAddress) || `device:${deviceId}`;
  const durationMs = settings?.blockDurationMs ?? getRuleDurationMs(rule);
  const expiresAt = durationMs === null ? null : new Date(Date.now() + durationMs);
  const where = getActiveBlockWhere({ ipAddress: ip, deviceId });
  const existing = where
    ? await IpBlock.findOne({ where, paranoid: true })
    : null;

  if (existing) {
    await existing.update({
      deviceId: existing.deviceId || deviceId || null,
      reason,
      expiresAt,
    });
    return existing;
  }

  return IpBlock.create({
    ip,
    deviceId: deviceId || null,
    reason,
    expiresAt,
  });
};

const throwTimedBlockError = (settings) => {
  throw new ApiError(
    429,
    `Order limit reached. Please try again after ${formatDuration(settings.blockTime, settings.timeUnit)}.`,
  );
};

const throwRuleBlockError = (rule) => {
  throw new ApiError(
    429,
    `Order blocked. Please try again after ${getRuleDurationLabel(rule)}.`,
  );
};

const hasPreviousOrderFor = async (where) => {
  const count = await Order.count({
    where: {
      ...where,
      status: { [Op.ne]: "incomplete" },
    },
    paranoid: true,
  });
  return count > 0;
};

const enforceSelectedOrderBlockRules = async (payload = {}) => {
  const rules = await getOrderBlockRuleSettings();
  if (!rules.length) return;

  const ipAddress = normalizeIpAddress(payload.ipAddress);
  const deviceId = normalizeDeviceId(payload.deviceId);
  const address = getOrderAddress(payload);
  const customerPhone = payload.customerPhone;

  for (const rule of rules) {
    if (rule.key === "invalid_phone" && isInvalidPhoneNumber(customerPhone)) {
      await createTimedIpBlock({
        ipAddress,
        deviceId,
        rule,
        reason: `Auto blocked: invalid phone number (${getRuleDurationLabel(rule)})`,
      });
      throwRuleBlockError(rule);
    }

    if (rule.key === "suspicious_address" && isSuspiciousAddress(address)) {
      await createTimedIpBlock({
        ipAddress,
        deviceId,
        rule,
        reason: `Auto blocked: suspicious delivery address (${getRuleDurationLabel(rule)})`,
      });
      throwRuleBlockError(rule);
    }

    if (rule.key === "same_ip" && getIpVariants(ipAddress).length) {
      const matched = await hasPreviousOrderFor({
        ipAddress: { [Op.in]: getIpVariants(ipAddress) },
      });
      if (matched) {
        await createTimedIpBlock({
          ipAddress,
          deviceId,
          rule,
          reason: `Auto blocked: same IP address (${getRuleDurationLabel(rule)})`,
        });
        throwRuleBlockError(rule);
      }
    }

    if (rule.key === "same_device" && deviceId) {
      const matched = await hasPreviousOrderFor({ deviceId });
      if (matched) {
        await createTimedIpBlock({
          ipAddress,
          deviceId,
          rule,
          reason: `Auto blocked: same device (${getRuleDurationLabel(rule)})`,
        });
        throwRuleBlockError(rule);
      }
    }
  }
};

const enforceOrderBlockLimit = async (payload = {}) => {
  await enforceSelectedOrderBlockRules(payload);

  const settings = await getOrderBlockSettings();
  if (!settings) return;

  const customerPhone = payload.customerPhone;
  const ipAddress = normalizeIpAddress(payload.ipAddress);
  const deviceId = normalizeDeviceId(payload.deviceId);
  const address = getOrderAddress(payload);

  if (isSuspiciousAddress(address) && (ipAddress || deviceId)) {
    await createTimedIpBlock({
      ipAddress,
      deviceId,
      settings,
      reason: `Auto blocked: suspicious delivery address (${formatDuration(settings.blockTime, settings.timeUnit)})`,
    });
    throwTimedBlockError(settings);
  }

  const since = new Date(Date.now() - settings.blockDurationMs);
  const orConditions = [];
  if (customerPhone) orConditions.push({ customerPhone: String(customerPhone).trim() });
  const ipVariants = getIpVariants(ipAddress);
  if (ipVariants.length) orConditions.push({ ipAddress: { [Op.in]: ipVariants } });
  if (deviceId) orConditions.push({ deviceId });
  if (!orConditions.length) return;

  const count = await Order.count({
    where: {
      createdAt: { [Op.gte]: since },
      status: { [Op.ne]: "incomplete" },
      [Op.or]: orConditions,
    },
    paranoid: true,
  });

  if (count >= settings.limit) {
    await createTimedIpBlock({
      ipAddress,
      deviceId,
      settings,
      reason: `Auto blocked: order limit reached (${settings.limit} orders / ${formatDuration(settings.blockTime, settings.timeUnit)})`,
    });
    throwTimedBlockError(settings);
  }
};

const calculateItemsSubtotal = (items = []) =>
  items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
    0,
  );

const parseJsonObject = (value) => {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const getSteadfastConfig = async () => {
  const settings = await SiteSettingService.getByType("courier_api");
  const config = settings?.data?.steadfast || {};
  if (config.status === false) throw new ApiError(400, "Steadfast courier API is disabled");
  if (!String(config.apiKey || "").trim() || !String(config.secretKey || "").trim()) {
    throw new ApiError(400, "Steadfast API key and secret key are required");
  }

  const rawUrl = String(config.url || "https://portal.packzy.com/api/v1").trim();
  const baseUrl = rawUrl
    .replace(/\/create_order(?:\/bulk-order)?\/?$/i, "")
    .replace(/\/api\/v1\/?$/i, "/api/v1")
    .replace(/\/+$/, "");

  return {
    baseUrl,
    apiKey: String(config.apiKey).trim(),
    secretKey: String(config.secretKey).trim(),
  };
};

const getPathaoConfig = async () => {
  const settings = await SiteSettingService.getByType("courier_api");
  const config = settings?.data?.pathao || {};
  if (config.status === false) throw new ApiError(400, "Pathao courier API is disabled");

  const clientId = String(config.clientId || config.apiKey || "").trim();
  const clientSecret = String(config.clientSecret || config.secretKey || "").trim();
  const username = String(config.username || config.email || "").trim();
  const password = String(config.password || "").trim();
  const storeId = Number(config.storeId || config.store_id || 0);

  const missing = [];
  if (!clientId) missing.push("clientId");
  if (!clientSecret) missing.push("clientSecret");
  if (!username) missing.push("username");
  if (!password) missing.push("password");
  if (!storeId) missing.push("storeId");
  if (missing.length) throw new ApiError(400, `Pathao credential(s) required: ${missing.join(", ")}`);

  const rawUrl = String(config.url || "https://api-hermes.pathao.com").trim();
  const baseUrl = rawUrl
    .replace(/\/aladdin\/api\/v1\/orders\/?$/i, "")
    .replace(/\/aladdin\/api\/v1\/?$/i, "")
    .replace(/\/+$/, "");

  return {
    baseUrl,
    clientId,
    clientSecret,
    username,
    password,
    storeId,
    deliveryType: Number(config.deliveryType || 48),
    itemType: Number(config.itemType || 2),
    itemWeight: Number(config.itemWeight || 0.5),
    recipientCity: Number(config.recipientCity || config.cityId || 0) || undefined,
    recipientZone: Number(config.recipientZone || config.zoneId || 0) || undefined,
    recipientArea: Number(config.recipientArea || config.areaId || 0) || undefined,
  };
};

const steadfastRequest = async (path, { method = "GET", body } = {}) => {
  const config = await getSteadfastConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Api-Key": config.apiKey,
        "Secret-Key": config.secretKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!response.ok || (data?.status && Number(data.status) >= 400)) {
      throw new ApiError(response.status || 400, data?.message || "Steadfast request failed");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const pathaoToken = async (config) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.baseUrl}/aladdin/api/v1/issue-token`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        username: config.username,
        password: config.password,
        grant_type: "password",
      }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!response.ok || data?.type === "error") {
      throw new ApiError(response.status || 400, data?.message || "Pathao token request failed");
    }
    const token = data?.access_token || data?.data?.access_token || data?.token;
    if (!token) throw new ApiError(400, "Pathao access token missing from response");
    return token;
  } finally {
    clearTimeout(timer);
  }
};

const pathaoRequest = async (path, { method = "GET", body, config, token } = {}) => {
  const resolvedConfig = config || await getPathaoConfig();
  const accessToken = token || await pathaoToken(resolvedConfig);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${resolvedConfig.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!response.ok || data?.type === "error") {
      throw new ApiError(response.status || 400, data?.message || "Pathao request failed");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const pathaoRequestFirst = async (paths, options = {}) => {
  let lastError;
  for (const path of paths) {
    try {
      return await pathaoRequest(path, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const normalizeCourierPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("880")) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
};

const getOrderMeta = (order) => parseJsonObject(order?.note);

const getOrderAddressForCourier = (order) => {
  const meta = getOrderMeta(order);
  return String(
    meta.customerAddress ||
      order.customerAddress ||
      [order.customerArea, order.customerDistrict].filter(Boolean).join(", "),
  ).trim();
};

const getOrderAdminNoteText = (order) => {
  const meta = getOrderMeta(order);
  if (Array.isArray(meta.adminNotes) && meta.adminNotes.length) {
    return meta.adminNotes
      .map((item) => (typeof item === "string" ? item : item?.text))
      .filter(Boolean)
      .join("; ")
      .slice(0, 250);
  }
  if (order.note && !Object.keys(meta).length) return String(order.note).slice(0, 250);
  return "";
};

const getOrderDueAmount = (order) => {
  const meta = getOrderMeta(order);
  const total = Number(order.totalBill || meta.total || 0);
  const discount = Number(meta.discount || meta.less || 0);
  const paid = Number(order.advance || meta.advance || meta.paid || 0);
  return Math.max(0, total - discount - paid);
};

const buildSteadfastOrderPayload = (order, options = {}) => {
  const phone = normalizeCourierPhone(order.customerPhone);
  if (!/^01\d{9}$/.test(phone)) {
    throw new ApiError(400, "Valid 11 digit recipient phone is required for Steadfast");
  }

  const recipientAddress = getOrderAddressForCourier(order);
  if (!recipientAddress) throw new ApiError(400, "Recipient address is required for Steadfast");

  return {
    invoice: order.orderId,
    recipient_name: String(order.customerName || "Customer").slice(0, 100),
    recipient_phone: phone,
    alternative_phone: options.alternativePhone ? normalizeCourierPhone(options.alternativePhone) : undefined,
    recipient_email: options.recipientEmail || undefined,
    recipient_address: recipientAddress.slice(0, 250),
    cod_amount: Number(options.codAmount ?? getOrderDueAmount(order)),
    note: String(options.note || getOrderAdminNoteText(order) || "").slice(0, 250) || undefined,
    item_description: String(order.productName || "").slice(0, 250) || undefined,
    total_lot: Number(options.totalLot || order.quantity || 1),
    delivery_type: Number(options.deliveryType ?? 0),
  };
};

const buildPathaoOrderPayload = (order, config, options = {}) => {
  const phone = normalizeCourierPhone(order.customerPhone);
  if (!/^01\d{9}$/.test(phone)) {
    throw new ApiError(400, "Valid 11 digit recipient phone is required for Pathao");
  }

  const recipientAddress = getOrderAddressForCourier(order);
  if (recipientAddress.length < 10) {
    throw new ApiError(400, "Recipient address must be at least 10 characters for Pathao");
  }

  return {
    store_id: Number(options.storeId || config.storeId),
    merchant_order_id: order.orderId,
    recipient_name: String(order.customerName || "Customer").slice(0, 100),
    recipient_phone: phone,
    recipient_secondary_phone: options.alternativePhone ? normalizeCourierPhone(options.alternativePhone) : undefined,
    recipient_address: recipientAddress.slice(0, 220),
    recipient_city: options.recipientCity || config.recipientCity,
    recipient_zone: options.recipientZone || config.recipientZone,
    recipient_area: options.recipientArea || config.recipientArea,
    delivery_type: Number(options.deliveryType || config.deliveryType || 48),
    item_type: Number(options.itemType || config.itemType || 2),
    special_instruction: String(options.note || getOrderAdminNoteText(order) || "").slice(0, 250) || undefined,
    item_quantity: Number(options.itemQuantity || order.quantity || 1),
    item_weight: Number(options.itemWeight || config.itemWeight || 0.5),
    item_description: String(order.productName || "Parcel").slice(0, 250),
    amount_to_collect: Number(options.codAmount ?? getOrderDueAmount(order)),
  };
};

const compactObject = (value) =>
  Object.entries(value).reduce((acc, [key, item]) => {
    if (item !== undefined && item !== null && item !== "") acc[key] = item;
    return acc;
  }, {});

const mapSteadfastStatusToOrderStatus = (status) => {
  const key = String(status || "").toLowerCase();
  if (key === "delivered") {
    return "delivered";
  }
  if (["cancelled", "cancelled_approval_pending"].includes(key)) return "cancelled";
  if (key === "partial_delivered") return "returned";
  if (key === "hold") return "on_hold";
  if ([
    "pending",
    "in_review",
    "delivered_approval_pending",
    "partial_delivered_approval_pending",
    "unknown",
    "unknown_approval_pending",
  ].includes(key)) return "in_courier";
  return null;
};

const mapPathaoStatusToOrderStatus = (status) => {
  const key = String(status || "").toLowerCase().replace(/\s+/g, "_");
  if (["delivered", "order_delivered"].includes(key)) return "delivered";
  if ([
    "cancelled",
    "cancel",
    "rejected",
    "pickup_cancelled",
    "order_cancelled",
    "order_pickup_cancelled",
  ].includes(key)) return "cancelled";
  if ([
    "returned",
    "return",
    "return_to_merchant",
    "returned_to_merchant",
    "partial_delivery",
    "partial_delivered",
    "partial_return",
    "paid_return",
    "order_returned",
    "order_paid_return",
    "order_partial_delivery",
    "order_partial_delivered",
    "order_returned_to_merchant",
  ].includes(key)) return "returned";
  if ([
    "hold",
    "on_hold",
    "delivery_failed",
    "pickup_failed",
    "order_hold",
    "order_on_hold",
    "order_delivery_failed",
    "order_pickup_failed",
  ].includes(key)) return "on_hold";
  if (key) return "in_courier";
  return null;
};

const canSendToCourier = (order) =>
  OrderStatusService.toOrderStatusKey(order?.status) === "confirmed";

const mergeCourierMeta = (order, provider, data = {}) => {
  const meta = getOrderMeta(order);
  return JSON.stringify({
    ...(!Object.keys(meta).length && order.note ? { legacyNote: order.note } : {}),
    ...meta,
    courierIntegration: {
      ...(meta.courierIntegration || {}),
      [provider]: {
        ...(meta.courierIntegration?.[provider] || {}),
        ...data,
        updatedAt: new Date().toISOString(),
      },
    },
  });
};

const getSteadfastMeta = (order) => getOrderMeta(order).courierIntegration?.steadfast || {};
const getPathaoMeta = (order) => getOrderMeta(order).courierIntegration?.pathao || {};

const getOrderForCourier = async (id) => {
  const order = await Order.findByPk(id);
  if (!order) throw new ApiError(404, "Order not found");
  return order;
};

const getIncompleteOrderFromPayload = async (payload = {}) => {
  const incompleteOrderId = Number(payload.incompleteOrderId || payload.draftOrderId || 0);
  if (incompleteOrderId) {
    const order = await Order.findOne({
      where: { Id: incompleteOrderId, status: "incomplete" },
      paranoid: true,
    });
    if (order) return order;
  }

  const phone = String(payload.customerPhone || "").trim();
  if (!phone) return null;
  return Order.findOne({
    where: { customerPhone: phone, status: "incomplete" },
    order: [["Id", "DESC"]],
    paranoid: true,
  });
};

const applyOrderCoupon = async (payload = {}) => {
  if (!Array.isArray(payload.items)) return payload;

  const itemSubtotal = calculateItemsSubtotal(payload.items);
  const subtotal = itemSubtotal > 0 ? itemSubtotal : Number(payload.subtotal || 0);
  const deliveryCharge = Number(payload.deliveryCharge || 0);
  let discount = 0;
  let couponCode = null;

  if (payload.couponCode) {
    const appliedCoupon = await CouponCodeService.validateCoupon({
      code: payload.couponCode,
      subtotal,
    });
    discount = Number(appliedCoupon.discount || 0);
    couponCode = appliedCoupon.code;
  }

  return {
    ...payload,
    subtotal,
    deliveryCharge,
    discount,
    couponCode,
    total: Math.max(0, subtotal + deliveryCharge - discount),
  };
};

const normalizeCreatePayload = (payload) => {
  const orderSource = payload.orderSource || payload.source || "Website";
  if (!Array.isArray(payload.items)) {
    return {
      ...payload,
      orderSource: payload.orderSource || payload.source || "Manual",
      orderDate: payload.orderDate || new Date().toISOString().slice(0, 10),
    };
  }

  const items = payload.items;
  const quantity = items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1;
  const firstItem = items[0] || {};
  const productName = items.map((item) => `${item.name} x${item.qty || 1}`).join(", ");
  const meta = {
    __frontendOrder: true,
    customerAddress: payload.customerAddress || "",
    paymentMethod: payload.paymentMethod || "cod",
    paymentStatus: payload.paymentMethod && payload.paymentMethod !== "cod" ? "unverified" : "pending",
    items,
    subtotal: Number(payload.subtotal || 0),
    deliveryCharge: Number(payload.deliveryCharge || 0),
    discount: Number(payload.discount || 0),
    couponCode: payload.couponCode || null,
    advance: Number(payload.advance || 0),
    total: Number(payload.total || 0),
    tracking: payload.tracking || payload.trackingData || null,
    source: orderSource,
    orderSource,
  };

  return {
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    ipAddress: payload.ipAddress,
    deviceId: payload.deviceId,
    customerArea: payload.customerAddress || null,
    customerDistrict: payload.customerDistrict || null,
    productName: productName || "Website Order",
    productImage: firstItem.image || null,
    quantity,
    totalBill: Number(payload.total || payload.subtotal || 0),
    advance: Number(payload.advance || 0),
    orderSource,
    status: "pending",
    orderDate: new Date().toISOString().slice(0, 10),
    note: JSON.stringify(meta),
  };
};

const extractOrderSourceFromNote = (note) => {
  if (!note || typeof note !== "string") return "";
  try {
    const meta = JSON.parse(note);
    return String(meta.orderSource || meta.source || meta.platform || "").trim();
  } catch (error) {
    return "";
  }
};

const createOrderInDB = async (payload, options = {}) => {
  const ipAddress = normalizeIpAddress(payload.ipAddress);
  const deviceId = normalizeDeviceId(payload.deviceId);
  if ((ipAddress || deviceId) && IpBlock) {
    const blockWhere = getActiveBlockWhere({ ipAddress, deviceId });
    const blockedIp = await IpBlock.findOne({
      where: blockWhere,
      paranoid: true,
    });
    if (blockedIp) {
      throw new ApiError(403, "Orders from this IP address are blocked");
    }
  }
  const checkedPayload = await applyOrderCoupon({ ...payload, ipAddress, deviceId });
  const normalizedPayload = normalizeCreatePayload(checkedPayload);
  const incompleteOrder = options.orderId
    ? null
    : await getIncompleteOrderFromPayload(checkedPayload);
  let order;

  if (incompleteOrder) {
    await enforceOrderBlockLimit(checkedPayload);
    await incompleteOrder.update({
      ...normalizedPayload,
      orderId: incompleteOrder.orderId,
      status: "pending",
    });
    order = incompleteOrder;
  } else {
    await enforceOrderBlockLimit(checkedPayload);
    const orderId = options.orderId || await generateOrderId();
    order = await Order.create({ ...normalizedPayload, orderId });
  }

  await NotificationService.createForRoles(
    ["superAdmin", "admin", "cs"],
    {
      title: "New order received",
      message: `${order.orderId} — ${order.customerName || "Customer"} — ৳${Number(order.totalBill || 0).toFixed(2)}`,
      type: "order_created",
      priority: "high",
      url: "/#page=orders&orderStatus=pending",
      data: { orderId: order.Id, invoiceId: order.orderId },
    },
  ).catch((error) => console.error("Order notification failed:", error.message));
  return toPublicOrder(order);
};

const saveIncompleteOrderInDB = async (payload = {}) => {
  const phone = String(payload.customerPhone || "").trim();
  if (!phone) throw new ApiError(400, "Customer phone is required");

  const ipAddress = normalizeIpAddress(payload.ipAddress);
  const deviceId = normalizeDeviceId(payload.deviceId);
  const checkedPayload = await applyOrderCoupon({ ...payload, ipAddress, deviceId });
  const normalizedPayload = {
    ...normalizeCreatePayload({
      ...checkedPayload,
      customerName: checkedPayload.customerName || "Incomplete Customer",
      customerAddress: checkedPayload.customerAddress || "",
      paymentMethod: checkedPayload.paymentMethod || "cod",
    }),
    status: "incomplete",
  };

  const existing = await getIncompleteOrderFromPayload({ ...checkedPayload, ipAddress });
  if (existing) {
    await existing.update({
      ...normalizedPayload,
      orderId: existing.orderId,
      status: "incomplete",
    });
    return toPublicOrder(existing);
  }

  const orderId = await generateOrderId();
  const order = await Order.create({ ...normalizedPayload, orderId });
  return toPublicOrder(order);
};

const validateOrderStatus = async (status) => {
  const key = OrderStatusService.toOrderStatusKey(status);
  const activeKeys = await OrderStatusService.getActiveStatusKeys();
  const validKeys = activeKeys.length ? activeKeys : ORDER_STATUS_VALUES;
  if (!validKeys.includes(key)) {
    throw new ApiError(400, `Invalid status. Valid: ${validKeys.join(", ")}`);
  }
  return key;
};

const getFraudGuardForOrder = async (plainOrder = {}) => {
  const manualStatus = normalizeFraudStatus(plainOrder.fraudStatus);
  if (manualStatus === "fake") {
    return {
      status: "fake",
      label: "Fake Order",
      reason: plainOrder.fraudReason || "Manually marked as fake",
    };
  }
  if (manualStatus === "safe") {
    return {
      status: "safe",
      label: "Safe",
      reason: plainOrder.fraudReason || "Manually marked as safe",
    };
  }

  const phone = String(plainOrder.customerPhone || "").trim();
  if (!phone) {
    return { status: "safe", label: "Safe", reason: "No previous risk found" };
  }

  const rows = await Order.findAll({
    attributes: ["status", "fraudStatus", "fraudReason"],
    where: {
      customerPhone: phone,
    },
    raw: true,
    paranoid: true,
  });

  const manuallyFake = rows.find((row) => normalizeFraudStatus(row.fraudStatus) === "fake");
  if (manuallyFake) {
    return {
      status: "fake",
      label: "Fake Order",
      reason: manuallyFake.fraudReason || "Customer manually marked as fake",
    };
  }

  const manuallySafe = rows.find((row) => normalizeFraudStatus(row.fraudStatus) === "safe");
  if (manuallySafe) {
    return {
      status: "safe",
      label: "Safe",
      reason: manuallySafe.fraudReason || "Customer manually marked as safe",
    };
  }

  const deliveredCount = rows.filter((row) => OrderStatusService.toOrderStatusKey(row.status) === "delivered").length;
  const failedCount = rows.filter((row) => FAILED_DELIVERY_STATUSES.includes(OrderStatusService.toOrderStatusKey(row.status))).length;

  if (failedCount >= 3 && deliveredCount === 0) {
    return {
      status: "high_risk",
      label: "High Risk",
      reason: `${failedCount} previous non-delivered orders, no delivered order found`,
      failedCount,
      deliveredCount,
    };
  }

  return {
    status: "safe",
    label: "Safe",
    reason: "No previous risk found",
    failedCount,
    deliveredCount,
  };
};

const getOrdersFromDB = async (filters, paginationOptions, currentUser = {}) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(paginationOptions);

  const { status, search, fromDate, toDate, assignedEmployeeId } = filters;

  const where = {};

  if (status && status !== "all") {
    where.status = OrderStatusService.toOrderStatusKey(status);
  }

  if (assignedEmployeeId === "unassigned" || assignedEmployeeId === "not_assigned") {
    where.assignedEmployeeId = { [Op.is]: null };
  } else if (assignedEmployeeId && assignedEmployeeId !== "all") {
    where.assignedEmployeeId = Number(assignedEmployeeId);
  }

  if (search) {
    where[Op.or] = ORDER_SEARCHABLE_FIELDS.map((field) => ({
      [field]: { [Op.like]: `%${search}%` },
    }));
  }

  if (fromDate && toDate) {
    where.orderDate = { [Op.between]: [fromDate, toDate] };
  } else if (fromDate) {
    where.orderDate = { [Op.gte]: fromDate };
  } else if (toDate) {
    where.orderDate = { [Op.lte]: toDate };
  }

  const scopedWhere = applyOrderAssignmentScope(where, currentUser);

  const { count, rows } = await Order.findAndCountAll({
    where: scopedWhere,
    include: ORDER_ASSIGNMENT_INCLUDES,
    distinct: true,
    limit,
    offset: skip,
    order: [[sortBy || "Id", sortOrder || "DESC"]],
  });

  const rowsWithRepeatInfo = await Promise.all(
    rows.map(async (row) => {
      const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
      const phone = normalizePhone(plain.customerPhone);
      const previousOrderCount = phone
        ? await Order.count({
            where: {
              Id: { [Op.lt]: plain.Id },
              customerPhone: { [Op.like]: `%${phone.slice(-11) || phone}%` },
            },
            paranoid: true,
          })
        : 0;
      return {
        ...withAssignmentUsers(plain),
        isRepeat: previousOrderCount > 0,
        previousOrderCount,
        fraudGuard: await getFraudGuardForOrder(plain),
      };
    }),
  );

  return {
    meta: { page, limit, total: count },
    data: rowsWithRepeatInfo,
  };
};

const getOrderStatusCountsFromDB = async (currentUser = {}) => {
  const activeStatuses = await OrderStatusService.getActiveStatusOptions();
  const scopedWhere = applyOrderAssignmentScope({}, currentUser);
  const counts = await Order.findAll({
    attributes: ["status", [fn("COUNT", col("Id")), "count"]],
    where: scopedWhere,
    group: ["status"],
    raw: true,
  });

  const total = await Order.count({ where: scopedWhere });

  const result = { all: total };
  activeStatuses.forEach((s) => (result[s.key] = 0));
  counts.forEach(({ status, count }) => {
    const key = OrderStatusService.toOrderStatusKey(status);
    result[key] = (result[key] || 0) + Number(count);
  });

  return result;
};

const getOrderByIdFromDB = async (id, currentUser = {}) => {
  const order = await Order.findByPk(id, {
    include: ORDER_ASSIGNMENT_INCLUDES,
  });
  if (!order) throw new ApiError(404, "Order not found");
  const plain = typeof order.toJSON === "function" ? order.toJSON() : order;
  if (
    normalizeRole(currentUser.role) === "employee" &&
    Number(plain.assignedEmployeeId) !== Number(currentUser.Id)
  ) {
    throw new ApiError(403, "You can only view orders assigned to you");
  }
  return { ...withAssignmentUsers(plain), fraudGuard: await getFraudGuardForOrder(plain) };
};

const trackOrdersByPhoneFromDB = async (phone, invoiceId, options = {}) => {
  const normalized = String(phone || "").trim();
  const normalizedInvoice = String(invoiceId || "").trim();
  if (!normalized && !normalizedInvoice) throw new ApiError(400, "Phone number or invoice ID is required");

  const activeTrackingStatuses = ["pending", "confirmed", "packaging", "in_courier", "on_hold"];
  const baseWhere = normalizedInvoice
    ? { orderId: normalizedInvoice }
    : { customerPhone: { [Op.like]: `%${normalized}%` } };
  const where = normalizedInvoice || options.includeHistory
    ? baseWhere
    : { ...baseWhere, status: { [Op.in]: activeTrackingStatuses } };

  let orders = await Order.findAll({
    where,
    limit: normalizedInvoice ? 1 : options.includeHistory ? 20 : 3,
    order: [["Id", "DESC"]],
    paranoid: true,
  });

  if (!normalizedInvoice && !options.includeHistory && orders.length === 0) {
    orders = await Order.findAll({
      where: baseWhere,
      limit: 1,
      order: [["Id", "DESC"]],
      paranoid: true,
    });
  }
  return orders.map(toPublicOrder);
};

const getReconfirmOrder = async (id, phone) => {
  const rawId = String(id || "").trim();
  const normalizedPhone = normalizePhone(phone);
  if (!rawId) throw new ApiError(400, "Order ID is required");
  if (!/^01\d{9}$/.test(normalizedPhone)) {
    throw new ApiError(400, "Valid customer phone is required");
  }

  const order = await Order.findOne({
    where: {
      [Op.or]: [
        ...(Number(rawId) ? [{ Id: Number(rawId) }] : []),
        { orderId: rawId },
      ],
      customerPhone: { [Op.like]: `%${normalizedPhone}%` },
    },
    paranoid: true,
  });
  if (!order) throw new ApiError(404, "Order not found");
  return order;
};

const sendOrderReconfirmOtpInDB = async (id, payload = {}) => {
  const order = await getReconfirmOrder(id, payload.phone);
  if (OrderStatusService.toOrderStatusKey(order.status) === "confirmed") {
    return {
      alreadyConfirmed: true,
      maskedPhone: maskPhone(order.customerPhone),
      order: toPublicOrder(order),
    };
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const meta = parseAnyOrderMeta(order.note);
  meta.__frontendOrder = meta.__frontendOrder !== false;
  meta.reconfirmOtp = {
    hash: hashOrderOtp(order.Id, order.customerPhone, otp),
    expiresAt,
    attempts: 0,
    sentAt: new Date().toISOString(),
    phone: normalizePhone(order.customerPhone),
  };

  await order.update({ note: JSON.stringify(meta) });

  const smsText = `Your ${order.orderId} confirmation OTP is ${otp}. This code will expire in 5 minutes.`;
  const smsResult = await SmsMarketingService.sendTransactionalSms(order.customerPhone, smsText);
  if (!smsResult?.sent) {
    const providerError = smsResult?.errors?.[0]?.response || smsResult?.errors?.[0]?.error;
    throw new ApiError(502, providerError || "OTP SMS could not be sent. Please check SMS gateway settings.");
  }

  return {
    alreadyConfirmed: false,
    maskedPhone: maskPhone(order.customerPhone),
    expiresAt,
  };
};

const verifyOrderReconfirmOtpInDB = async (id, payload = {}) => {
  const order = await getReconfirmOrder(id, payload.phone);
  if (OrderStatusService.toOrderStatusKey(order.status) === "confirmed") {
    return toPublicOrder(order);
  }

  const otp = String(payload.otp || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(otp)) throw new ApiError(400, "Valid 6 digit OTP is required");

  const meta = parseAnyOrderMeta(order.note);
  const otpMeta = meta.reconfirmOtp || {};
  if (!otpMeta.hash || !otpMeta.expiresAt) {
    throw new ApiError(400, "OTP not requested yet");
  }
  if (new Date(otpMeta.expiresAt).getTime() < Date.now()) {
    throw new ApiError(400, "OTP expired. Please request a new OTP");
  }
  if (Number(otpMeta.attempts || 0) >= 5) {
    throw new ApiError(429, "Too many OTP attempts. Please request a new OTP");
  }

  const expectedHash = hashOrderOtp(order.Id, order.customerPhone, otp);
  if (expectedHash !== otpMeta.hash) {
    meta.reconfirmOtp = {
      ...otpMeta,
      attempts: Number(otpMeta.attempts || 0) + 1,
    };
    await order.update({ note: JSON.stringify(meta) });
    throw new ApiError(400, "Invalid OTP");
  }

  delete meta.reconfirmOtp;
  meta.reconfirmedAt = new Date().toISOString();
  await order.update({
    status: "confirmed",
    note: JSON.stringify(meta),
  });

  NotificationService.createForRoles(
    ["superAdmin", "admin", "cs"],
    {
      title: "Order re-confirmed",
      message: `${order.orderId} — ${order.customerName || "Customer"} verified by OTP`,
      type: "order_status",
      priority: "high",
      url: "/#page=orders&orderStatus=confirmed",
      data: { orderId: order.Id, invoiceId: order.orderId, status: "confirmed" },
    },
  ).catch((error) => console.error("Order reconfirm notification failed:", error.message));

  return toPublicOrder({ ...order.get({ plain: true }), status: "confirmed", note: JSON.stringify(meta) });
};

const updateOrderInDB = async (id, payload) => {
  const order = await Order.findByPk(id);
  if (!order) throw new ApiError(404, "Order not found");
  const next = { ...payload };
  if (next.source && !next.orderSource) {
    next.orderSource = next.source;
  }
  if (Object.prototype.hasOwnProperty.call(next, "note") && !next.orderSource) {
    const sourceFromNote = extractOrderSourceFromNote(next.note);
    if (sourceFromNote) next.orderSource = sourceFromNote;
  }
  if (next.status !== undefined) {
    next.status = await validateOrderStatus(next.status);
  }
  if (next.fraudStatus !== undefined) {
    const fraudStatus = normalizeFraudStatus(next.fraudStatus);
    if (fraudStatus && !MANUAL_FRAUD_STATUSES.includes(fraudStatus)) {
      throw new ApiError(400, "Invalid fraud status. Valid: safe, fake");
    }
    next.fraudStatus = fraudStatus || null;
    next.fraudReason = next.fraudReason || null;
  }
  if (Object.prototype.hasOwnProperty.call(next, "fraudStatus")) {
    const { fraudStatus, fraudReason, ...otherUpdates } = next;
    if (Object.keys(otherUpdates).length) {
      await order.update(otherUpdates);
    }
    await Order.update(
      {
        fraudStatus,
        fraudReason,
      },
      {
        where: { customerPhone: order.customerPhone },
        paranoid: true,
      },
    );
    await order.reload();
  } else {
    await order.update(next);
  }
  const updatedOrder = await Order.findByPk(id, {
    include: ORDER_ASSIGNMENT_INCLUDES,
  });
  const plain = updatedOrder?.get
    ? updatedOrder.get({ plain: true })
    : typeof order.toJSON === "function"
      ? order.toJSON()
      : order;
  return { ...withAssignmentUsers(plain), fraudGuard: await getFraudGuardForOrder(plain) };
};

const getAssignableEmployeesFromDB = async () => {
  const employees = await User.findAll({
    where: {
      [Op.and]: [
        db.sequelize.where(fn("LOWER", col("role")), "employee"),
        db.sequelize.where(fn("LOWER", col("status")), "active"),
      ],
    },
    attributes: ["Id", "FirstName", "LastName", "Email", "Phone", "role", "status"],
    order: [["FirstName", "ASC"], ["createdAt", "DESC"]],
    paranoid: true,
  });

  return employees.map((employee) => {
    const plain = typeof employee.toJSON === "function" ? employee.toJSON() : employee;
    return {
      ...plain,
      name: getUserDisplayName(plain),
    };
  });
};

const bulkAssignOrdersToEmployeeInDB = async (orderIds = [], employeeId, actor = {}) => {
  const ids = [...new Set(
    (Array.isArray(orderIds) ? orderIds : [])
      .map((id) => Number(id))
      .filter(Boolean),
  )];
  if (!ids.length) throw new ApiError(400, "Order IDs are required");

  const employee = await User.findOne({
    where: {
      [Op.and]: [
        { Id: Number(employeeId) },
        db.sequelize.where(fn("LOWER", col("role")), "employee"),
        db.sequelize.where(fn("LOWER", col("status")), "active"),
      ],
    },
    attributes: ["Id", "FirstName", "LastName", "Email", "Phone", "role", "status"],
    paranoid: true,
  });
  if (!employee) throw new ApiError(404, "Active employee not found");

  const employeePlain = employee.get({ plain: true });
  const employeeName = getUserDisplayName(employeePlain);
  const actorName = getUserDisplayName(actor);

  const [updatedCount] = await Order.update(
    {
      assignedEmployeeId: employeePlain.Id,
      assignedEmployeeName: employeeName,
      assignedById: actor.Id || null,
      assignedByName: actorName,
      assignedAt: new Date(),
    },
    {
      where: { Id: { [Op.in]: ids } },
      paranoid: true,
    },
  );

  const updatedOrders = await Order.findAll({
    where: { Id: { [Op.in]: ids } },
    include: ORDER_ASSIGNMENT_INCLUDES,
    order: [["Id", "DESC"]],
    paranoid: true,
  });

  return {
    assigned: updatedCount,
    employee: {
      Id: employeePlain.Id,
      name: employeeName,
    },
    orders: updatedOrders.map((order) => withAssignmentUsers(order.get({ plain: true }))),
  };
};

const deleteOrderFromDB = async (id) => {
  const order = await Order.findByPk(id);
  if (!order) throw new ApiError(404, "Order not found");
  await order.destroy();
  return { message: "Order deleted successfully" };
};

const sendOrderToSteadfastInDB = async (id, options = {}) => {
  const order = await getOrderForCourier(id);
  if (!canSendToCourier(order)) {
    throw new ApiError(400, "Only confirmed orders can be sent to Steadfast");
  }
  const existing = getSteadfastMeta(order);
  if (existing.trackingCode && !options.force) {
    return {
      alreadySent: true,
      orderId: order.Id,
      invoice: order.orderId,
      consignmentId: existing.consignmentId,
      trackingCode: existing.trackingCode,
      steadfastStatus: existing.status,
    };
  }

  const payload = compactObject(buildSteadfastOrderPayload(order, options));
  const response = await steadfastRequest("/create_order", { method: "POST", body: payload });
  const consignment = response?.consignment || response || {};
  const steadfastStatus = consignment.status || response?.delivery_status || "in_review";
  const orderStatus = mapSteadfastStatusToOrderStatus(steadfastStatus) || "in_courier";

  await order.update({
    courier: "Steadfast",
    status: orderStatus,
    note: mergeCourierMeta(order, "steadfast", {
      invoice: payload.invoice,
      consignmentId: consignment.consignment_id || consignment.consignmentId || null,
      trackingCode: consignment.tracking_code || consignment.trackingCode || null,
      status: steadfastStatus,
      lastPayload: payload,
      lastResponse: consignment,
    }),
  });

  return {
    orderId: order.Id,
    invoice: order.orderId,
    status: order.status,
    consignmentId: consignment.consignment_id || consignment.consignmentId || null,
    trackingCode: consignment.tracking_code || consignment.trackingCode || null,
    steadfastStatus,
    response,
  };
};

const sendOrderToPathaoInDB = async (id, options = {}) => {
  const order = await getOrderForCourier(id);
  if (!canSendToCourier(order)) {
    throw new ApiError(400, "Only confirmed orders can be sent to Pathao");
  }
  const existing = getPathaoMeta(order);
  if ((existing.consignmentId || existing.trackingCode) && !options.force) {
    return {
      alreadySent: true,
      orderId: order.Id,
      invoice: order.orderId,
      consignmentId: existing.consignmentId,
      trackingCode: existing.trackingCode,
      pathaoStatus: existing.status,
    };
  }

  const config = await getPathaoConfig();
  const token = await pathaoToken(config);
  const payload = compactObject(buildPathaoOrderPayload(order, config, options));
  const response = await pathaoRequest("/aladdin/api/v1/orders", {
    method: "POST",
    body: payload,
    config,
    token,
  });
  const pathaoOrder = response?.data || response || {};
  const pathaoStatus = pathaoOrder.order_status || pathaoOrder.status || response?.message || "created";
  const orderStatus = mapPathaoStatusToOrderStatus(pathaoStatus) || "in_courier";
  const consignmentId =
    pathaoOrder.consignment_id ||
    pathaoOrder.consignmentId ||
    pathaoOrder.tracking_number ||
    pathaoOrder.trackingNumber ||
    null;

  await order.update({
    courier: "Pathao",
    status: orderStatus,
    note: mergeCourierMeta(order, "pathao", {
      invoice: payload.merchant_order_id,
      consignmentId,
      trackingCode: consignmentId,
      status: pathaoStatus,
      lastPayload: payload,
      lastResponse: pathaoOrder,
    }),
  });

  return {
    orderId: order.Id,
    invoice: order.orderId,
    status: order.status,
    consignmentId,
    trackingCode: consignmentId,
    pathaoStatus,
    response,
  };
};

const bulkSendOrdersToSteadfastInDB = async (orderIds = [], options = {}) => {
  const ids = [...new Set((orderIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!ids.length) throw new ApiError(400, "At least one order id is required");
  if (ids.length > 500) throw new ApiError(400, "Steadfast bulk order limit is 500");

  const orders = await Order.findAll({
    where: { Id: { [Op.in]: ids } },
    paranoid: true,
  });
  const orderMap = new Map(orders.map((order) => [Number(order.Id), order]));
  const payloadItems = [];
  const skipped = [];

  ids.forEach((id) => {
    const order = orderMap.get(id);
    if (!order) {
      skipped.push({ orderId: id, status: "error", message: "Order not found" });
      return;
    }
    const existing = getSteadfastMeta(order);
    if (existing.trackingCode && !options.force) {
      skipped.push({
        orderId: id,
        invoice: order.orderId,
        status: "skipped",
        message: "Already sent to Steadfast",
        trackingCode: existing.trackingCode,
      });
      return;
    }
    if (!canSendToCourier(order)) {
      skipped.push({
        orderId: id,
        invoice: order.orderId,
        status: "skipped",
        message: "Only confirmed orders can be sent to Steadfast",
        orderStatus: order.status,
      });
      return;
    }
    payloadItems.push({ order, payload: compactObject(buildSteadfastOrderPayload(order, options)) });
  });

  if (!payloadItems.length) return { sent: [], skipped };

  const response = await steadfastRequest("/create_order/bulk-order", {
    method: "POST",
    body: { data: JSON.stringify(payloadItems.map((item) => item.payload)) },
  });
  const rows = Array.isArray(response) ? response : response?.data || [];
  const sent = [];

  await Promise.all(payloadItems.map(async ({ order, payload }, index) => {
    const row = rows[index] || {};
    const successful = String(row.status || "").toLowerCase() === "success" || row.tracking_code || row.consignment_id;
    if (!successful) {
      skipped.push({
        orderId: order.Id,
        invoice: order.orderId,
        status: "error",
        message: row.message || "Steadfast rejected this order",
        response: row,
      });
      return;
    }

    await order.update({
      courier: "Steadfast",
      status: "in_courier",
      note: mergeCourierMeta(order, "steadfast", {
        invoice: payload.invoice,
        consignmentId: row.consignment_id || null,
        trackingCode: row.tracking_code || null,
        status: row.delivery_status || row.status || "success",
        lastPayload: payload,
        lastResponse: row,
      }),
    });
    sent.push({
      orderId: order.Id,
      invoice: order.orderId,
      consignmentId: row.consignment_id || null,
      trackingCode: row.tracking_code || null,
      status: row.status || "success",
    });
  }));

  return { sent, skipped, response };
};

const bulkSendOrdersToPathaoInDB = async (orderIds = [], options = {}) => {
  const ids = [...new Set((orderIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!ids.length) throw new ApiError(400, "At least one order id is required");

  const orders = await Order.findAll({
    where: { Id: { [Op.in]: ids } },
    paranoid: true,
  });
  const orderMap = new Map(orders.map((order) => [Number(order.Id), order]));
  const config = await getPathaoConfig();
  const token = await pathaoToken(config);
  const sent = [];
  const skipped = [];

  for (const id of ids) {
    const order = orderMap.get(id);
    if (!order) {
      skipped.push({ orderId: id, status: "error", message: "Order not found" });
      continue;
    }

    const existing = getPathaoMeta(order);
    if ((existing.consignmentId || existing.trackingCode) && !options.force) {
      skipped.push({
        orderId: id,
        invoice: order.orderId,
        status: "skipped",
        message: "Already sent to Pathao",
        trackingCode: existing.trackingCode || existing.consignmentId,
      });
      continue;
    }

    if (!canSendToCourier(order)) {
      skipped.push({
        orderId: id,
        invoice: order.orderId,
        status: "skipped",
        message: "Only confirmed orders can be sent to Pathao",
        orderStatus: order.status,
      });
      continue;
    }

    try {
      const payload = compactObject(buildPathaoOrderPayload(order, config, options));
      const response = await pathaoRequest("/aladdin/api/v1/orders", {
        method: "POST",
        body: payload,
        config,
        token,
      });
      const pathaoOrder = response?.data || response || {};
      const pathaoStatus = pathaoOrder.order_status || pathaoOrder.status || response?.message || "created";
      const consignmentId =
        pathaoOrder.consignment_id ||
        pathaoOrder.consignmentId ||
        pathaoOrder.tracking_number ||
        pathaoOrder.trackingNumber ||
        null;

      await order.update({
        courier: "Pathao",
        status: mapPathaoStatusToOrderStatus(pathaoStatus) || "in_courier",
        note: mergeCourierMeta(order, "pathao", {
          invoice: payload.merchant_order_id,
          consignmentId,
          trackingCode: consignmentId,
          status: pathaoStatus,
          lastPayload: payload,
          lastResponse: pathaoOrder,
        }),
      });
      sent.push({
        orderId: order.Id,
        invoice: order.orderId,
        consignmentId,
        trackingCode: consignmentId,
        status: pathaoStatus,
      });
    } catch (error) {
      skipped.push({
        orderId: order.Id,
        invoice: order.orderId,
        status: "error",
        message: error.message || "Pathao rejected this order",
      });
    }
  }

  return { sent, skipped };
};

const syncSteadfastStatusInDB = async (id) => {
  const order = await getOrderForCourier(id);
  const meta = getSteadfastMeta(order);
  const lookupValue = meta.consignmentId || meta.trackingCode || order.orderId;
  const path = meta.consignmentId
    ? `/status_by_cid/${encodeURIComponent(meta.consignmentId)}`
    : meta.trackingCode
      ? `/status_by_trackingcode/${encodeURIComponent(meta.trackingCode)}`
      : `/status_by_invoice/${encodeURIComponent(order.orderId)}`;

  const response = await steadfastRequest(path);
  const steadfastStatus = response?.delivery_status || response?.status_text || response?.status || "";
  const orderStatus = mapSteadfastStatusToOrderStatus(steadfastStatus);
  await order.update({
    ...(orderStatus ? { status: orderStatus } : {}),
    courier: "Steadfast",
    note: mergeCourierMeta(order, "steadfast", {
      ...meta,
      lookupValue,
      status: steadfastStatus,
      lastStatusResponse: response,
    }),
  });

  return {
    orderId: order.Id,
    invoice: order.orderId,
    status: order.status,
    steadfastStatus,
    response,
  };
};

const syncPathaoStatusInDB = async (id) => {
  const order = await getOrderForCourier(id);
  const meta = getPathaoMeta(order);
  const lookupValue = meta.consignmentId || meta.trackingCode;
  if (!lookupValue) {
    throw new ApiError(400, "Pathao consignment id is required to sync status");
  }

  const response = await pathaoRequestFirst([
    `/aladdin/api/v1/orders/${encodeURIComponent(lookupValue)}/info`,
    `/aladdin/api/v1/orders/${encodeURIComponent(lookupValue)}`,
  ]);
  const data = response?.data || response || {};
  const pathaoStatus =
    data.order_status_slug ||
    data.order_status ||
    data.status_slug ||
    data.status ||
    response?.order_status_slug ||
    response?.order_status ||
    response?.status ||
    "";
  const orderStatus = mapPathaoStatusToOrderStatus(pathaoStatus);

  await order.update({
    ...(orderStatus ? { status: orderStatus } : {}),
    courier: "Pathao",
    note: mergeCourierMeta(order, "pathao", {
      ...meta,
      lookupValue,
      status: pathaoStatus,
      lastStatusResponse: data,
    }),
  });

  return {
    orderId: order.Id,
    invoice: order.orderId,
    status: order.status,
    pathaoStatus,
    response,
  };
};

const getSteadfastBalanceFromProvider = () => steadfastRequest("/get_balance");

const createSteadfastReturnRequestInDB = async (id, reason = "") => {
  const order = await getOrderForCourier(id);
  const meta = getSteadfastMeta(order);
  const consignment = meta.consignmentId || meta.trackingCode || order.orderId;
  const response = await steadfastRequest("/create_return_request", {
    method: "POST",
    body: compactObject({
      consignment_id: consignment,
      reason: String(reason || "").trim() || undefined,
    }),
  });
  await order.update({
    note: mergeCourierMeta(order, "steadfast", {
      ...meta,
      lastReturnRequest: response,
    }),
  });
  return response;
};

const getSteadfastReturnRequestsFromProvider = () => steadfastRequest("/get_return_requests");

const getSteadfastPaymentsFromProvider = (paymentId) =>
  steadfastRequest(paymentId ? `/payments/${encodeURIComponent(paymentId)}` : "/payments");

const getSteadfastPoliceStationsFromProvider = () => steadfastRequest("/police_stations");

const updateOrderStatusInDB = async (id, status, actorUserId) => {
  const nextStatus = await validateOrderStatus(status);
  const order = await Order.findByPk(id);
  if (!order) throw new ApiError(404, "Order not found");
  await order.update({ status: nextStatus });
  await NotificationService.createForRoles(
    ["superAdmin", "admin", "cs", "logistics"],
    {
      title: "Order status updated",
      message: `${order.orderId || `Order #${order.Id}`} is now ${nextStatus}`,
      type: "order_status",
      priority: ["cancelled", "returned", "incomplete"].includes(nextStatus) ? "high" : "normal",
      url: `/#page=orders&orderStatus=${encodeURIComponent(nextStatus)}`,
      data: { orderId: order.Id, invoiceId: order.orderId, status: nextStatus },
      excludeUserId: actorUserId,
    },
  ).catch((error) => console.error("Order status notification failed:", error.message));
  return order;
};

const OrderService = {
  createOrderInDB,
  saveIncompleteOrderInDB,
  getOrdersFromDB,
  getOrderStatusCountsFromDB,
  getOrderByIdFromDB,
  trackOrdersByPhoneFromDB,
  sendOrderReconfirmOtpInDB,
  verifyOrderReconfirmOtpInDB,
  updateOrderInDB,
  getAssignableEmployeesFromDB,
  bulkAssignOrdersToEmployeeInDB,
  deleteOrderFromDB,
  updateOrderStatusInDB,
  sendOrderToSteadfastInDB,
  sendOrderToPathaoInDB,
  bulkSendOrdersToSteadfastInDB,
  bulkSendOrdersToPathaoInDB,
  syncSteadfastStatusInDB,
  syncPathaoStatusInDB,
  getSteadfastBalanceFromProvider,
  createSteadfastReturnRequestInDB,
  getSteadfastReturnRequestsFromProvider,
  getSteadfastPaymentsFromProvider,
  getSteadfastPoliceStationsFromProvider,
};

module.exports = OrderService;
