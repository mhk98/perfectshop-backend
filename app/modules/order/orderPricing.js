const { Op } = require("sequelize");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const {
  getVariationOptions,
  variationSalePrice,
  isVariationAvailable,
  variantLabel,
} = require("../../../shared/productVariants");

const MAX_ITEM_QTY = 1000;
// Also the minimum: a lower charge in settings or on a landing page is raised to these.
const DEFAULT_DHAKA_CHARGE = 80;
const DEFAULT_OUTSIDE_DHAKA_CHARGE = 130;

const toQty = (value) => Math.min(Math.max(1, Math.floor(Number(value) || 1)), MAX_ITEM_QTY);

const toPositiveNumber = (value, fallback = 0) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
};

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const parseObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Mirrors buildProductOptions() in the storefront landing page so the server charges
// exactly the price the customer was shown.
const getLandingOptions = (page) => {
  const regularData = parseObject(page.regularData);
  const configured = Array.isArray(regularData.productOptions) ? regularData.productOptions : [];
  const options = configured
    .map((item) => ({
      productId: item.productId || item.id || page.productId || page.Id,
      linkedProductId: item.productId || page.productId || null,
      name: String(item.name || page.product || page.title || "Landing Product"),
      price: toPositiveNumber(item.price, toPositiveNumber(page.price, 1899)),
    }))
    .filter((item) => item.name && item.price > 0);
  if (options.length) return options;

  return [{
    productId: page.productId || page.Id,
    linkedProductId: page.productId || null,
    name: page.product || page.title || "Product",
    price: toPositiveNumber(page.price, 0),
  }];
};

// Mirrors getDeliveryChargeForDistrict() in the storefront shipping service.
const hasInsideDhakaText = (note) =>
  /ঢাকার\s*ভিতরে|ঢাকা\s*ভিতরে|inside\s*dhaka|in\s*dhaka/i.test(note);
const hasOutsideDhakaText = (note) =>
  /ঢাকার\s*বাইরে|ঢাকা\s*বাইরে|outside\s*dhaka|out\s*of\s*dhaka/i.test(note);

const chargeAmount = (charge) => {
  const amount = Number(charge?.amount);
  return charge && Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const getWebsiteDeliveryCharge = async (district) => {
  const isDhaka = String(district || "").trim().toLowerCase() === "dhaka";
  const minimum = isDhaka ? DEFAULT_DHAKA_CHARGE : DEFAULT_OUTSIDE_DHAKA_CHARGE;
  const charges = db.deliveryCharge
    ? await db.deliveryCharge.findAll({
        order: [["date", "DESC"], ["createdAt", "DESC"]],
        limit: 100,
        raw: true,
      })
    : [];
  const matcher = isDhaka ? hasInsideDhakaText : hasOutsideDhakaText;
  const matched = chargeAmount(charges.find((charge) => matcher(String(charge.note || ""))));
  if (matched !== null) return Math.max(matched, minimum);
  const fallback = chargeAmount(charges[isDhaka ? 0 : 1]);
  if (fallback !== null) return Math.max(fallback, minimum);
  return minimum;
};

const loadProducts = async (ids) => {
  const cleanIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
  if (!cleanIds.length) return new Map();
  const products = await db.product.findAll({
    where: { Id: { [Op.in]: cleanIds } },
    include: [{ model: db.variation, as: "variations" }],
  });
  return new Map(products.map((product) => [Number(product.Id), product]));
};

// Picks the variation an item refers to. Old carts carry no variantId, so a product
// with a single variation, or a legacy size/color match, is accepted too.
const findVariation = (product, item) => {
  const variations = product.variations || [];
  if (item.variantId) {
    return variations.find((variation) => Number(variation.Id) === Number(item.variantId)) || null;
  }
  if (variations.length === 1) return variations[0];
  const wanted = [item.size, item.color].filter(Boolean).map(String);
  if (!wanted.length) return null;
  const matches = variations.filter((variation) => {
    const values = Object.values(getVariationOptions(variation));
    return wanted.every((value) => values.includes(value));
  });
  return matches.length === 1 ? matches[0] : null;
};

const describeVariation = (variation) => {
  const options = getVariationOptions(variation);
  return { options, variant: variantLabel(options) || undefined };
};

const priceLandingOrder = async (payload, landingPageId, strict) => {
  const page = await db.landingPage.findOne({ where: { Id: landingPageId } });
  if (!page) {
    if (strict) throw new ApiError(400, "Landing page not found");
    return payload;
  }
  const options = getLandingOptions(page);
  const products = await loadProducts(options.map((option) => option.linkedProductId).filter(Boolean));
  let allFreeShipping = payload.items.length > 0;

  const items = payload.items.map((item) => {
    const byId = options.filter((option) => Number(option.productId) === Number(item.id));
    const option = byId.find((candidate) => candidate.name === item.name) || byId[0] ||
      options.find((candidate) => candidate.name === item.name);
    if (!option) {
      if (strict) throw new ApiError(400, `"${item.name || "Product"}" এই অফারে পাওয়া যাচ্ছে না`);
      allFreeShipping = false;
      return item;
    }
    // Landing offers keep their own price; a single-variant product is still linked for stock.
    const product = option.linkedProductId && products.get(Number(option.linkedProductId));
    const variation = product && product.variations?.length === 1 ? product.variations[0] : null;
    const freeShipping = Boolean(product?.freeShipping);
    if (!freeShipping) allFreeShipping = false;
    return {
      ...item,
      variantId: variation ? variation.Id : undefined,
      name: option.name,
      price: option.price,
      qty: toQty(item.qty),
      freeShipping,
    };
  });

  const regularData = parseObject(page.regularData);
  const outside = String(payload.customerDistrict || "").trim().toLowerCase() === "outside";
  let deliveryCharge = 0;
  if (!allFreeShipping) {
    deliveryCharge = outside
      ? Math.max(toPositiveNumber(regularData.deliveryOutside, 0), DEFAULT_OUTSIDE_DHAKA_CHARGE)
      : Math.max(toPositiveNumber(regularData.deliveryInside, 0), DEFAULT_DHAKA_CHARGE);
  }

  return { ...payload, items, deliveryCharge };
};

const priceWebsiteOrder = async (payload, strict) => {
  const products = await loadProducts(payload.items.map((item) => item.id));
  let allFreeShipping = payload.items.length > 0;

  const items = payload.items.map((item) => {
    const qty = toQty(item.qty);
    const product = products.get(Number(item.id));
    const fail = (message) => {
      if (strict) throw new ApiError(400, message);
      allFreeShipping = false;
      return { ...item, qty };
    };
    if (!product || product.status === "Inactive") {
      return fail(`"${item.name || "Product"}" পণ্যটি আর পাওয়া যাচ্ছে না`);
    }

    const variation = findVariation(product, item);
    if (!variation) return fail(`"${product.name}" এর variant (size/color/ml) বাছাই করুন`);

    const price = variationSalePrice(variation);
    if (!(price > 0)) return fail(`"${product.name}" এর দাম সেট করা নেই`);
    if (strict && !isVariationAvailable(variation, qty)) {
      throw new ApiError(400, `"${product.name}" এর পর্যাপ্ত stock নেই`);
    }

    const freeShipping = Boolean(product.freeShipping);
    if (!freeShipping) allFreeShipping = false;
    return {
      ...item,
      id: product.Id,
      variantId: variation.Id,
      name: product.name,
      ...describeVariation(variation),
      price,
      qty,
      freeShipping,
    };
  });

  // The storefront only charges delivery once a district is picked; a final order without
  // one (outdated client) is charged the outside-Dhaka rate rather than nothing.
  const district = String(payload.customerDistrict || "").trim();
  let deliveryCharge = 0;
  if (!allFreeShipping && (district || strict)) {
    deliveryCharge = await getWebsiteDeliveryCharge(district || "outside");
  }

  return { ...payload, items, deliveryCharge };
};

/**
 * Public checkout: replaces client-sent names, prices and delivery charge with the ones
 * stored in the database. strict=false (incomplete drafts) keeps unresolvable items.
 */
const priceOrderItems = async (payload = {}, { strict = true } = {}) => {
  if (!Array.isArray(payload.items)) throw new ApiError(400, "No items in order");
  if (strict && !payload.items.length) throw new ApiError(400, "No items in order");

  const landingPageId = Number(payload.tracking?.landingPageId || 0);
  const isLanding = landingPageId > 0 &&
    String(payload.orderSource || payload.source || "").toLowerCase() === "landing page";

  const priced = isLanding
    ? await priceLandingOrder(payload, landingPageId, strict)
    : await priceWebsiteOrder(payload, strict);

  // Customers cannot mark money as already paid; staff record advances from the panel.
  return { ...priced, advance: 0 };
};

/**
 * Staff orders (POS / order edit): staff set prices and per-line discounts, but every
 * product line must point at a real variant so stock is tracked. Lines without a product
 * id are kept as free-text lines (legacy orders).
 */
const resolveStaffItems = async (items = []) => {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, "No items in order");
  const products = await loadProducts(items.map((item) => item.id));

  return items.map((item) => {
    const qty = toQty(item.qty);
    const price = toMoney(item.price);
    const disc = Math.min(toMoney(item.disc), price * qty);
    const base = {
      name: String(item.name || "Product"),
      image: item.image || null,
      price,
      qty,
      disc,
    };
    if (!item.id) return base;

    const product = products.get(Number(item.id));
    if (!product) throw new ApiError(400, `"${item.name || "Product"}" পণ্যটি পাওয়া যায়নি`);
    const variation = findVariation(product, item);
    if (!variation) throw new ApiError(400, `"${product.name}" এর variant বাছাই করুন`);

    return {
      ...base,
      id: product.Id,
      variantId: variation.Id,
      name: product.name,
      ...describeVariation(variation),
    };
  });
};

const calculateStaffTotals = (items, { deliveryCharge, discount }) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty - (item.disc || 0), 0);
  const delivery = toMoney(deliveryCharge);
  const orderDiscount = Math.min(toMoney(discount), subtotal + delivery);
  return {
    subtotal,
    deliveryCharge: delivery,
    discount: orderDiscount,
    total: Math.max(0, subtotal + delivery - orderDiscount),
  };
};

module.exports = {
  priceOrderItems,
  resolveStaffItems,
  calculateStaffTotals,
  getLandingOptions,
};
