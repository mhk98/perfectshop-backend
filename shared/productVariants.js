// Shared variant helpers used by product (admin + storefront) and order pricing.

const MAX_OPTION_LENGTH = 100;

const parseJsonValue = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const cleanText = (value) => String(value ?? "").trim().slice(0, MAX_OPTION_LENGTH);

// { "Volume": " 6ml ", "": "x", "Color": "" } -> { "Volume": "6ml" }  (null when empty)
const normalizeVariantOptions = (raw) => {
  const value = parseJsonValue(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  Object.entries(value).forEach(([name, optionValue]) => {
    const key = cleanText(name);
    const text = cleanText(optionValue);
    if (key && text) result[key] = text;
  });
  return Object.keys(result).length ? result : null;
};

// Order-independent identity of an option combination.
const variantOptionKey = (options) =>
  Object.keys(options || {})
    .sort()
    .map((name) => `${name.toLowerCase()}=${String(options[name]).toLowerCase()}`)
    .join("|");

// Options for a stored variation, falling back to the legacy colorId/attribute columns.
const getVariationOptions = (variation = {}, colorName = null) => {
  const options = normalizeVariantOptions(variation.options);
  if (options) return options;
  const legacy = {};
  if (colorName) legacy.Color = colorName;
  if (variation.attribute) legacy.Option = cleanText(variation.attribute);
  return Object.keys(legacy).length ? legacy : {};
};

const variationSalePrice = (variation = {}) =>
  Number(variation.newPrice || variation.oldPrice || variation.purchasePrice || 0);

const variationRegularPrice = (variation = {}) =>
  Number(variation.oldPrice || variation.newPrice || variation.purchasePrice || 0);

const isVariationAvailable = (variation = {}, qty = 1) =>
  variation.availability !== "out of stock" && Number(variation.stock || 0) >= qty;

const variantLabel = (options = {}) =>
  Object.entries(options)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");

module.exports = {
  normalizeVariantOptions,
  variantOptionKey,
  getVariationOptions,
  variationSalePrice,
  variationRegularPrice,
  isVariationAvailable,
  variantLabel,
};
