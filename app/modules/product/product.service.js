const { Op, where } = require("sequelize"); // Ensure Op is imported
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const { ProductSearchableFields } = require("./product.constants");
const Product = db.product;
const Variation = db.variation;
const SupplierHistory = db.supplierHistory;
const InventoryMaster = db.inventoryMaster;

const productNameSyncModels = [
  { Model: db.purchaseRequisition, reference: "product" },
  { Model: db.receivedProduct, reference: "product" },
  { Model: db.purchaseReturnProduct, reference: "inventory" },
  { Model: db.inTransitProduct, reference: "inventory" },
  { Model: db.returnProduct, reference: "inventory" },
  { Model: db.damageStock, reference: "product" },
  { Model: db.damageProduct, reference: "inventory" },
  { Model: db.damageRepair, reference: "damageStock" },
  { Model: db.damageReparingStock, reference: "product" },
  { Model: db.damageRepaired, reference: "repairingStock" },
];

const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hasAttribute = (Model, attribute) =>
  Boolean(Model?.rawAttributes?.[attribute]);

const optionalId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
};

const createSupplierPaymentIfNeeded = async ({
  purchaseEnabled,
  supplierId,
  payAmount,
  purchaseDate,
  productName,
  transaction,
}) => {
  const enabled = purchaseEnabled === true || purchaseEnabled === "true" || purchaseEnabled === "1" || purchaseEnabled === 1;
  const resolvedSupplierId = optionalId(supplierId);
  const amount = Number(payAmount || 0);
  if (!enabled || !SupplierHistory || !resolvedSupplierId || !amount) return null;

  return SupplierHistory.create({
    supplierId: resolvedSupplierId,
    amount,
    status: "Paid",
    date: String(purchaseDate || new Date().toISOString()).slice(0, 10),
    file: productName ? `Product purchase: ${productName}` : null,
  }, transaction ? { transaction } : undefined);
};

const buildJoinedName = (items = []) =>
  items
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .join(", ");

const renameItemsByReference = (
  items = [],
  referenceIds = [],
  nextName,
  previousNames = [],
) => {
  const idSet = new Set(referenceIds.map((item) => Number(item)));
  const previousNameSet = new Set(
    previousNames.map((item) => String(item || "").trim()).filter(Boolean),
  );
  let changed = false;

  const renamedItems = items.map((item) => {
    const itemProductId = Number(item?.productId ?? item?.receivedId);
    const itemName = String(item?.name || "").trim();
    if (!idSet.has(itemProductId) && !previousNameSet.has(itemName)) {
      return item;
    }

    changed = true;
    return {
      ...item,
      name: nextName,
    };
  });

  return { changed, items: renamedItems };
};

const syncNameRows = async (
  Model,
  referenceIds,
  nextName,
  transaction,
  previousNames = [],
) => {
  if (!Model) return;

  const previousNameSet = new Set(
    previousNames.map((item) => String(item || "").trim()).filter(Boolean),
  );
  if (!referenceIds.length && !previousNameSet.size) return;

  const attributes = ["Id", "name"];
  if (hasAttribute(Model, "productId")) attributes.push("productId");
  if (hasAttribute(Model, "items")) attributes.push("items");

  const rows = await Model.findAll({
    attributes,
    transaction,
    paranoid: false,
  });

  await Promise.all(
    rows.map(async (row) => {
      const rowProductId = Number(row.productId);
      const items = parseItems(row.items);
      const data = {};

      if (items.length) {
        const renamed = renameItemsByReference(
          items,
          referenceIds,
          nextName,
          previousNames,
        );
        if (!renamed.changed) return;

        data.items = renamed.items;
        data.name = buildJoinedName(renamed.items) || nextName;
      } else if (
        referenceIds.includes(rowProductId) ||
        previousNameSet.has(String(row.name || "").trim())
      ) {
        data.name = nextName;
      } else {
        return;
      }

      await row.update(data, { transaction });
    }),
  );
};

const syncProductNameReferences = async (
  productId,
  nextName,
  transaction,
  previousNames = [],
) => {
  const fetchIds = async (Model, where) => {
    if (!Model) return [];
    const rows = await Model.findAll({ attributes: ["Id"], where, transaction, paranoid: false });
    return rows.map((row) => Number(row.Id));
  };

  const [inventoryIds, damageStockIds, repairingStockIds] = await Promise.all([
    fetchIds(InventoryMaster, { productId }),
    fetchIds(db.damageStock, { productId }),
    fetchIds(db.damageReparingStock, { productId }),
  ]);

  if (InventoryMaster) {
    await InventoryMaster.update(
      { name: nextName },
      { where: { productId }, transaction, paranoid: false },
    );
  }

  await Promise.all(
    productNameSyncModels.map(({ Model, reference }) => {
      const referenceIds = {
        damageStock: damageStockIds,
        inventory: inventoryIds,
        product: [productId],
        repairingStock: repairingStockIds,
      }[reference];

      return syncNameRows(
        Model,
        referenceIds || [],
        nextName,
        transaction,
        previousNames,
      );
    }),
  );
};

const insertIntoDB = async (data, files = []) => {
  const {
    name, slug, sku,
    categoryId, subcategoryId, childcategoryId, brandId,
    productVideo, advanceAmount, stockAlert,
    description, shortDescription,
    metaTitle, metaKeyword, metaDescription,
    giftTitle, giftPrice,
    bestDeals, freeShipping, status,
    variations: variationsRaw,
    purchaseEnabled, supplierId, payAmount, purchaseDate,
  } = data;

  // collect uploaded image paths
  const imagePaths = files.map(f => f.filename || f.path);

  const payload = {
    name,
    slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    sku:             sku             || null,
    categoryId:      categoryId      ? Number(categoryId)      : null,
    subcategoryId:   subcategoryId   ? Number(subcategoryId)   : null,
    childcategoryId: childcategoryId ? Number(childcategoryId) : null,
    brandId:         brandId         ? Number(brandId)         : null,
    productVideo:    productVideo    || null,
    advanceAmount:   advanceAmount   ? Number(advanceAmount)   : null,
    stockAlert:      stockAlert      ? Number(stockAlert)      : null,
    description:     description     || null,
    shortDescription:shortDescription|| null,
    metaTitle:       metaTitle       || null,
    metaKeyword:     metaKeyword     || null,
    metaDescription: metaDescription || null,
    giftTitle:       giftTitle       || null,
    giftPrice:       giftPrice       ? Number(giftPrice)       : null,
    images:          imagePaths.length ? imagePaths : null,
    bestDeals:       bestDeals === 'true'    || bestDeals === true,
    freeShipping:    freeShipping === 'true' || freeShipping === true,
    status:          status || "Active",
    date:            new Date().toISOString().slice(0, 10),
  };

  const product = await Product.create(payload);

  // create variations
  let parsedVariations = [];
  if (variationsRaw) {
    try {
      parsedVariations = typeof variationsRaw === 'string' ? JSON.parse(variationsRaw) : variationsRaw;
    } catch { parsedVariations = []; }
  }

  if (parsedVariations.length) {
    await Promise.all(parsedVariations.map(v =>
      Variation.create({
        productId:     product.Id,
        colorId:       v.colorId ? Number(v.colorId) : null,
        colorImage:    v.colorImage || null,
        attribute:     v.attribute || null,
        availability:  v.availability || "in stock",
        purchasePrice: v.purchasePrice ? Number(v.purchasePrice) : null,
        oldPrice:      v.oldPrice      ? Number(v.oldPrice)      : null,
        newPrice:      v.newPrice      ? Number(v.newPrice)      : null,
        stock:         v.stock         ? Number(v.stock)         : 0,
      })
    ));
  }

  await createSupplierPaymentIfNeeded({
    purchaseEnabled,
    supplierId,
    payAmount,
    purchaseDate,
    productName: product.name,
  });

  return product;
};

const getAllFromDB = async (filters, options) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);

  const { searchTerm, startDate, endDate, ...otherFilters } = filters;

  const andConditions = [];

  // ✅ Search by product name or SKU/barcode. MySQL uses LIKE.
  if (searchTerm && searchTerm.trim()) {
    andConditions.push({
      [Op.or]: ProductSearchableFields.map((field) => ({
        [field]: { [Op.like]: `%${searchTerm.trim()}%` },
      })),
    });
  }

  // ✅ Exact filters (e.g. name)
  if (Object.keys(otherFilters).length) {
    andConditions.push(
      ...Object.entries(otherFilters).map(([key, value]) => ({
        [key]: { [Op.eq]: value },
      })),
    );
  }

  // ✅ Date range filter (createdAt)
  if (startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    andConditions.push({
      date: { [Op.between]: [start, end] },
    });
  }

  // ✅ Exclude soft deleted records
  andConditions.push({
    deletedAt: { [Op.is]: null }, // Only include records with deletedAt as null (not deleted)
  });

  const whereConditions = andConditions.length
    ? { [Op.and]: andConditions }
    : {};

  const result = await Product.findAll({
    where: whereConditions,
    offset: skip,
    limit,
    include: [
      {
        model: Variation,
        as: "variations",
      },
    ],
    paranoid: true,
    order: (() => {
      const ALLOWED_SORT_COLUMNS = new Set([
        "createdAt", "updatedAt", "name", "price", "stock",
      ]);
      const ALLOWED_SORT_ORDERS = new Set(["ASC", "DESC"]);
      const col = options.sortBy;
      const ord = (options.sortOrder || "").toUpperCase();
      if (col && ALLOWED_SORT_COLUMNS.has(col) && ALLOWED_SORT_ORDERS.has(ord)) {
        return [[col, ord]];
      }
      return [["createdAt", "DESC"]];
    })(),
  });

  const count = await Product.count({ where: whereConditions });

  return {
    meta: { count, page, limit },
    data: result,
  };
};

const getDataById = async (id) => {
  const result = await Product.findOne({
    where: {
      stockId: id,
    },
    include: [
      {
        model: db.variation,
        as: "variations",
      },
    ],
  });

  return result;
};

const deleteIdFromDB = async (id) => {
  const result = await Product.destroy({
    where: {
      Id: id,
    },
  });

  return result;
};

const updateOneFromDB = async (id, payload, files = []) => {
  const {
    name, slug, sku,
    categoryId, subcategoryId, childcategoryId, brandId,
    productVideo, advanceAmount, stockAlert,
    description, shortDescription,
    metaTitle, metaKeyword, metaDescription,
    giftTitle, giftPrice,
    bestDeals, freeShipping, status,
    variations: variationsRaw,
    keptImages: keptImagesRaw,
    purchaseEnabled, supplierId, payAmount, purchaseDate,
  } = payload;

  return db.sequelize.transaction(async (transaction) => {
    const existingProduct = await Product.findOne({ where: { Id: id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!existingProduct) throw new ApiError(404, "Product not found");

    // merge kept + new image filenames
    let keptImages = [];
    try { keptImages = typeof keptImagesRaw === 'string' ? JSON.parse(keptImagesRaw) : (keptImagesRaw || []); } catch { keptImages = []; }
    const newImagePaths = files.map(f => f.filename || f.path);
    const mergedImages = [...keptImages, ...newImagePaths];

    const data = {
      name,
      slug: slug || String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''),
      sku:             sku             || null,
      categoryId:      categoryId      ? Number(categoryId)      : null,
      subcategoryId:   subcategoryId   ? Number(subcategoryId)   : null,
      childcategoryId: childcategoryId ? Number(childcategoryId) : null,
      brandId:         brandId         ? Number(brandId)         : null,
      productVideo:    productVideo    || null,
      advanceAmount:   advanceAmount   ? Number(advanceAmount)   : null,
      stockAlert:      stockAlert      ? Number(stockAlert)      : null,
      description:     description     || null,
      shortDescription:shortDescription|| null,
      metaTitle:       metaTitle       || null,
      metaKeyword:     metaKeyword     || null,
      metaDescription: metaDescription || null,
      giftTitle:       giftTitle       || null,
      giftPrice:       giftPrice       ? Number(giftPrice)       : null,
      images:          mergedImages.length ? mergedImages : null,
      bestDeals:       bestDeals === 'true'    || bestDeals === true,
      freeShipping:    freeShipping === 'true' || freeShipping === true,
      status:          status || "Active",
    };

    await Product.update(data, { where: { Id: id }, transaction });

    const nextName = String(name || "").trim();
    const oldName  = String(existingProduct.name || "").trim();
    if (nextName) {
      await syncProductNameReferences(Number(id), nextName, transaction, oldName && oldName !== nextName ? [oldName] : []);
    }

    // replace variations
    let parsedVariations = [];
    try { parsedVariations = typeof variationsRaw === 'string' ? JSON.parse(variationsRaw) : (variationsRaw || []); } catch { parsedVariations = []; }

    if (parsedVariations.length) {
      await Variation.destroy({ where: { productId: id }, transaction });
      await Promise.all(parsedVariations.map(v =>
        Variation.create({
          productId:     id,
          colorId:       v.colorId ? Number(v.colorId) : null,
          colorImage:    v.colorImage || null,
          attribute:     v.attribute || null,
          availability:  v.availability || "in stock",
          purchasePrice: v.purchasePrice ? Number(v.purchasePrice) : null,
          oldPrice:      v.oldPrice      ? Number(v.oldPrice)      : null,
          newPrice:      v.newPrice      ? Number(v.newPrice)      : null,
          stock:         v.stock         ? Number(v.stock)         : 0,
        }, { transaction })
      ));
    }

    await createSupplierPaymentIfNeeded({
      purchaseEnabled,
      supplierId,
      payAmount,
      purchaseDate,
      productName: name || existingProduct.name,
      transaction,
    });

    return { id, updated: true };
  });
};

const getAllFromDBWithoutQuery = async () => {
  const result = await Product.findAll({
    paranoid: true,
    order: [["createdAt", "DESC"]],
  });

  return result;
};

const getReceivedDataById = async (id) => {
  const result = await Product.findOne({
    where: {
      Id: id,
    },
    include: [
      {
        model: db.variation,
        as: "variations",
      },
    ],
  });

  return result;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getNameMap = async (Model, ids) => {
  const cleanIds = [...new Set(ids.filter(Boolean).map((id) => Number(id)))];
  if (!Model || !cleanIds.length) return new Map();
  const rows = await Model.findAll({
    attributes: ["Id", "name"],
    where: { Id: { [Op.in]: cleanIds } },
    paranoid: true,
    raw: true,
  });
  return new Map(rows.map((row) => [Number(row.Id), row.name]));
};

const listValue = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value ? [value] : [];
    }
  }
  return value ? [value] : [];
};

const uniqueList = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
};

const toStorefrontProduct = (product, maps = {}) => {
  const plain = product.toJSON ? product.toJSON() : product;
  const variations = plain.variations || [];
  const firstVariation = variations[0] || {};
  const images = uniqueList([
    plain.file,
    ...parseJsonArray(plain.images),
    ...parseJsonArray(plain.gallery),
  ].filter(Boolean));
  const oldPrice = Number(firstVariation.oldPrice || firstVariation.purchasePrice || 0);
  const newPrice = Number(firstVariation.newPrice || firstVariation.oldPrice || firstVariation.purchasePrice || 0);
  const discount = oldPrice > 0 && newPrice > 0 && oldPrice > newPrice
    ? Math.round(((oldPrice - newPrice) / oldPrice) * 100)
    : 0;
  const stock = variations.reduce((sum, item) => sum + Number(item.stock || 0), 0);

  return {
    Id: plain.Id,
    name: plain.name,
    category: maps.categories?.get(Number(plain.categoryId)) || null,
    categoryId: plain.categoryId,
    subCategory: maps.subcategories?.get(Number(plain.subcategoryId)) || null,
    subCategoryId: plain.subcategoryId,
    childCategory: maps.childcategories?.get(Number(plain.childcategoryId)) || null,
    childCategoryId: plain.childcategoryId,
    sale_price: newPrice,
    original_price: oldPrice || newPrice,
    discount,
    quantity: stock,
    file: images[0] || null,
    gallery: images,
    features: plain.shortDescription ? [plain.shortDescription] : parseJsonArray(plain.features),
    variants: variations.map((variation) => ({
      colorId: variation.colorId || null,
      colorName: maps.colors?.get(Number(variation.colorId)) || null,
      attribute: variation.attribute || null,
      size: listValue(variation.size),
      color: variation.colorId && maps.colors?.get(Number(variation.colorId))
        ? [maps.colors.get(Number(variation.colorId))]
        : listValue(variation.color),
      weight: variation.weight || null,
      unit: variation.unit || null,
      oldPrice: variation.oldPrice,
      newPrice: variation.newPrice,
      stock: variation.stock,
      availability: variation.availability || null,
    })),
    sku: plain.sku,
    freeShipping: Boolean(plain.freeShipping),
    inStock: stock > 0,
    status: plain.status,
  };
};

const getStorefrontProducts = async () => {
  const products = await Product.findAll({
    where: { status: { [Op.ne]: "Inactive" } },
    include: [{ model: Variation, as: "variations" }],
    paranoid: true,
    order: [["createdAt", "DESC"]],
  });

  const variationColorIds = products.flatMap((product) =>
    (product.variations || []).map((variation) => variation.colorId),
  );

  const [categories, subcategories, childcategories, colors] = await Promise.all([
    getNameMap(db.category, products.map((product) => product.categoryId)),
    getNameMap(db.subcategory, products.map((product) => product.subcategoryId)),
    getNameMap(db.childcategory, products.map((product) => product.childcategoryId)),
    getNameMap(db.color, variationColorIds),
  ]);

  return products.map((product) =>
    toStorefrontProduct(product, { categories, subcategories, childcategories, colors }),
  );
};

const getStorefrontProductById = async (id) => {
  const product = await Product.findOne({
    where: { Id: id, status: { [Op.ne]: "Inactive" } },
    include: [{ model: Variation, as: "variations" }],
    paranoid: true,
  });
  if (!product) return null;

  const variationColorIds = (product.variations || []).map((variation) => variation.colorId);
  const [categories, subcategories, childcategories, colors] = await Promise.all([
    getNameMap(db.category, [product.categoryId]),
    getNameMap(db.subcategory, [product.subcategoryId]),
    getNameMap(db.childcategory, [product.childcategoryId]),
    getNameMap(db.color, variationColorIds),
  ]);

  return toStorefrontProduct(product, { categories, subcategories, childcategories, colors });
};

const ProductService = {
  getAllFromDB,
  insertIntoDB,
  deleteIdFromDB,
  updateOneFromDB,
  getDataById,
  getReceivedDataById,
  getStorefrontProducts,
  getStorefrontProductById,
  getAllFromDBWithoutQuery,
};

module.exports = ProductService;
