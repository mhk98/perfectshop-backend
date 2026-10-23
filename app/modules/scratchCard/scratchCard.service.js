const { Op } = require("sequelize");
const paginationHelpers = require("../../../helpers/paginationHelper");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const {
  SCRATCH_CARD_STATUSES,
  SCRATCH_CARD_CLAIM_TYPES,
} = require("./scratchCard.constants");
const { generateReferenceCode, normalizeReferenceCode } = require("./scratchCard.reference");
const { DELIVERY_AREAS, effectiveArea, getDeliveryCharges, chargeFor } = require("./scratchCard.delivery");
const { courierStage } = require("./scratchCard.courier");
const ScratchCard = () => db.scratchCard;

const PHONE_PATTERN = /^01\d{9}$/;
// The admin list lets staff pick up to this many rows per page (the shared
// pagination helper stops at 100).
const MAX_PAGE_SIZE = 5000;

const countClaimsForPhone = (phone) => ScratchCard().count({ where: { phone } });

// Lets the storefront warn about an earlier claim before the card image is uploaded.
const checkPhone = async (phone) => {
  const normalized = String(phone || "").trim();
  if (!PHONE_PATTERN.test(normalized)) throw new ApiError(400, "Invalid phone number");
  return { claimed: (await countClaimsForPhone(normalized)) > 0 };
};

// Public tracking by phone. Returns only what the customer needs to follow a
// claim; name, address, card image and admin notes stay private.
const trackByPhone = async (phone) => {
  const normalized = String(phone || "").trim();
  if (!PHONE_PATTERN.test(normalized)) throw new ApiError(400, "Invalid phone number");
  return ScratchCard().findAll({
    where: { phone: normalized },
    attributes: ["Id", "referenceCode", "prize", "status", "claimType", "courier", "trackingCode", "createdAt", "updatedAt"],
    order: [["createdAt", "DESC"]],
  });
};

const submit = async (data, file) => {
  const fullName = String(data.fullName || "").trim();
  const phone = String(data.phone || "").trim();
  const address = String(data.address || "").trim();
  const prize = String(data.prize || "").trim();

  if (!fullName || !phone || !address || !prize) {
    throw new ApiError(400, "Full name, phone, address and prize are required");
  }
  if (!PHONE_PATTERN.test(phone)) throw new ApiError(400, "Invalid phone number");
  if (prize.length > 64) throw new ApiError(400, "Prize name is too long");
  if (!file) throw new ApiError(400, "Scratch card image is required");

  // A phone that already claimed may only submit again through the
  // "another card" form, and that claim is kept apart for verification.
  const previousClaims = await countClaimsForPhone(phone);
  const isAdditional = String(data.additional || "") === "true";
  if (previousClaims > 0 && !isAdditional) {
    throw new ApiError(409, "This phone number has already claimed a scratch card prize");
  }

  // A clash on the unique reference code is very unlikely; just draw a new one.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ScratchCard().create({
        referenceCode: generateReferenceCode(),
        fullName,
        phone,
        address,
        prize,
        image: file.filename,
        claimType: previousClaims > 0 ? "repeat" : "first",
      });
    } catch (error) {
      if (error.name !== "SequelizeUniqueConstraintError" || attempt >= 4) throw error;
    }
  }
};

// Earlier claims from the same phones, so a repeat claim can be checked
// against what that customer already received.
const attachPreviousClaims = async (rows) => {
  const phones = [...new Set(rows.map((row) => row.phone))];
  if (!phones.length) return rows;
  const claims = await ScratchCard().findAll({
    where: { phone: { [Op.in]: phones } },
    attributes: ["Id", "phone", "prize", "status", "claimType", "createdAt"],
    order: [["createdAt", "ASC"]],
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true });
    plain.previousClaims = claims
      .filter((claim) => claim.phone === row.phone && claim.createdAt < row.createdAt)
      .map((claim) => claim.get({ plain: true }));
    return plain;
  });
};

// Admin date filters arrive as "YYYY-MM-DD" and mean whole days in
// Bangladesh time, whatever timezone the server runs in.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dayRange = (column, from, to) => {
  const range = {};
  if (from) {
    if (!DATE_PATTERN.test(from)) throw new ApiError(400, "Invalid date");
    range[Op.gte] = new Date(`${from}T00:00:00.000+06:00`);
  }
  if (to) {
    if (!DATE_PATTERN.test(to)) throw new ApiError(400, "Invalid date");
    range[Op.lte] = new Date(`${to}T23:59:59.999+06:00`);
  }
  return from || to ? { [column]: range } : null;
};

// Every staff role except admin/superAdmin/leader can be assigned claims and
// works as an agent. Leaders see every claim like an admin but cannot assign.
// "user" is the storefront customer role, never an agent.
const NON_AGENT_ROLES = ["superadmin", "admin", "leader", "user"];
const normalizedRole = (user) => String(user?.role || "").trim().toLowerCase();
const isAgent = (user) => !NON_AGENT_ROLES.includes(normalizedRole(user));
const isCustomer = (user) => normalizedRole(user) === "user";

const displayName = (user) =>
  [user.FirstName, user.LastName].filter(Boolean).join(" ").trim() || user.Email || user.Phone || `User ${user.Id}`;

const activeAgentsWhere = {
  [Op.and]: [
    db.sequelize.where(db.sequelize.fn("LOWER", db.sequelize.fn("TRIM", db.sequelize.col("role"))), { [Op.notIn]: NON_AGENT_ROLES }),
    db.sequelize.where(db.sequelize.fn("LOWER", db.sequelize.col("status")), "active"),
  ],
};

const getAgents = async () => {
  const agents = await db.user.findAll({
    where: activeAgentsWhere,
    attributes: ["Id", "FirstName", "LastName", "Email", "Phone", "role"],
    order: [["FirstName", "ASC"]],
  });
  return agents.map((agent) => ({ Id: agent.Id, name: displayName(agent), role: agent.role }));
};

// agentId null/"" clears the assignment.
const assignToAgent = async (ids, agentId, actor) => {
  const cardIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!cardIds.length) throw new ApiError(400, "Scratch card IDs are required");

  let assignment = { assignedAgentId: null, assignedAgentName: null, assignedById: null, assignedAt: null };
  if (agentId) {
    const agent = await db.user.findOne({ where: { [Op.and]: [{ Id: Number(agentId) }, activeAgentsWhere] } });
    if (!agent) throw new ApiError(404, "Active agent not found");
    assignment = {
      assignedAgentId: agent.Id,
      assignedAgentName: displayName(agent),
      assignedById: actor?.Id || null,
      assignedAt: new Date(),
    };
  }
  const [updated] = await ScratchCard().update(assignment, { where: { Id: { [Op.in]: cardIds } } });
  return { updated, ...assignment };
};

// The courier status filter: "none" = not sent yet, "courier:<name>" = sent to
// that courier, "stage:<stage>" = see courierStage, "status:<status>" = one exact status.
const courierStatusCondition = async (value) => {
  const [kind, ...rest] = String(value || "").split(":");
  const arg = rest.join(":");
  if (kind === "none") return { courier: null };
  if (kind === "courier" && arg) return { courier: arg };
  if (kind === "status" && arg) return { courier: { [Op.ne]: null }, status: arg };
  if (kind === "stage" && arg) {
    // Couriers report many raw statuses, so match the ones in use that fall in this stage.
    const pairs = await ScratchCard().findAll({
      attributes: ["courier", "courierStatus"],
      where: { courier: { [Op.ne]: null } },
      group: ["courier", "courierStatus"],
      raw: true,
    });
    const matches = pairs.filter((p) => courierStage(p.courier, p.courierStatus) === arg);
    if (!matches.length) return { Id: null };
    return { [Op.or]: matches.map((p) => ({ courier: p.courier, courierStatus: p.courierStatus })) };
  }
  throw new ApiError(400, "Invalid courier status filter");
};

const getAllFromDB = async (filters, options, user) => {
  const { page } = paginationHelpers.calculatePagination(options);
  const limit = Math.min(Math.max(Math.floor(Number(options?.limit)) || 10, 1), MAX_PAGE_SIZE);
  const skip = (page - 1) * limit;
  const { searchTerm, status, claimType } = filters || {};
  const reference = normalizeReferenceCode(filters?.reference);
  const phone = String(filters?.phone || "").trim();
  const prize = String(filters?.prize || "").trim();
  const andConditions = [];
  // An agent only ever sees the cards assigned to them.
  if (isAgent(user)) {
    andConditions.push({ assignedAgentId: user.Id });
  } else if (filters?.assignedAgentId === "unassigned") {
    andConditions.push({ assignedAgentId: null });
  } else if (filters?.assignedAgentId) {
    andConditions.push({ assignedAgentId: Number(filters.assignedAgentId) });
  }
  // A reference code finds that one claim; a phone finds every claim from it.
  // Both look across first and repeat claims so nothing for the customer is hidden.
  if (reference) andConditions.push({ referenceCode: reference });
  if (phone) andConditions.push({ phone });
  if (searchTerm) {
    andConditions.push({
      [Op.or]: [
        { fullName: { [Op.like]: `%${searchTerm}%` } },
        { phone:    { [Op.like]: `%${searchTerm}%` } },
        { referenceCode: { [Op.like]: `%${searchTerm}%` } },
        { prize:    { [Op.like]: `%${searchTerm}%` } },
      ],
    });
  }
  // Status is the manual one, so it only covers cards not yet sent to a courier.
  if (status) andConditions.push({ status, courier: null });
  if (filters?.courierStatus) andConditions.push(await courierStatusCondition(filters.courierStatus));
  // Claims made before the wall watch was renamed still say "Big Size Wall Watch".
  if (prize) andConditions.push({ prize: prize === "Luxury Wall Watch" ? [prize, "Big Size Wall Watch"] : prize });
  if (claimType && !reference && !phone) {
    if (!SCRATCH_CARD_CLAIM_TYPES.includes(claimType)) throw new ApiError(400, "Invalid claim type");
    andConditions.push({ claimType });
  }
  const submitted = dayRange("createdAt", filters?.submittedFrom, filters?.submittedTo);
  if (submitted) andConditions.push(submitted);
  const approved = dayRange("approvedAt", filters?.approvedFrom, filters?.approvedTo);
  if (approved) andConditions.push(approved);
  const where = andConditions.length ? { [Op.and]: andConditions } : {};
  const [data, count, statusRows, courierStatusRows, deliveryCharges] = await Promise.all([
    ScratchCard().findAll({ where, offset: skip, limit, order: [["createdAt", "DESC"]] }),
    ScratchCard().count({ where }),
    ScratchCard().findAll({ attributes: ["status"], where: { courier: null }, group: ["status"], raw: true }),
    // Courier statuses vary, so the courier status filter offers whatever is in use.
    ScratchCard().findAll({ attributes: ["status"], where: { courier: { [Op.ne]: null } }, group: ["status"], raw: true }),
    getDeliveryCharges(),
  ]);
  const statuses = [...new Set([...SCRATCH_CARD_STATUSES, ...statusRows.map((r) => r.status).filter(Boolean)])];
  const rows = claimType === "repeat" ? await attachPreviousClaims(data) : data;
  return {
    meta: {
      count, page, limit, statuses, deliveryCharges,
      courierStatuses: courierStatusRows.map((r) => r.status).filter(Boolean).sort(),
    },
    // The delivery charge the courier will collect; a sent card shows what was actually sent.
    data: rows.map((row) => {
      const plain = typeof row.get === "function" ? row.get({ plain: true }) : row;
      return {
        ...plain,
        deliveryArea: effectiveArea(plain),
        deliveryCharge: chargeFor(plain, deliveryCharges),
      };
    }),
  };
};

const updateOneFromDB = async (id, payload, user) => {
  const row = await ScratchCard().findOne({ where: { Id: id } });
  if (!row || (isAgent(user) && row.assignedAgentId !== user.Id)) {
    throw new ApiError(404, "Scratch card not found");
  }
  const { status, note } = payload || {};
  if (status !== undefined && !SCRATCH_CARD_STATUSES.includes(status)) {
    throw new ApiError(400, "Invalid status");
  }
  if (status !== undefined && row.courier) {
    throw new ApiError(400, `This card is with ${row.courier}; its status comes from the courier`);
  }
  const changes = { ...(status !== undefined && { status }), ...(note !== undefined && { note }) };
  // Admins can correct the prize a customer typed; agents cannot.
  if (payload?.prize !== undefined) {
    if (isAgent(user)) throw new ApiError(403, "Agents cannot change the prize");
    const prize = String(payload.prize).trim();
    if (!prize) throw new ApiError(400, "Prize is required");
    if (prize.length > 64) throw new ApiError(400, "Prize name is too long");
    changes.prize = prize;
  }
  // The courier delivers to this address, so it is fixed once the card is sent.
  if (payload?.address !== undefined) {
    if (isAgent(user)) throw new ApiError(403, "Agents cannot change the address");
    if (row.courier) throw new ApiError(400, `This card is already with ${row.courier}`);
    const address = String(payload.address).trim();
    if (!address) throw new ApiError(400, "Address is required");
    changes.address = address;
  }
  // Inside/outside Dhaka decides the delivery charge collected by the courier;
  // picking an area drops any custom charge so the area's charge applies.
  if (payload?.deliveryArea !== undefined) {
    if (isAgent(user)) throw new ApiError(403, "Agents cannot change the delivery area");
    if (!DELIVERY_AREAS.includes(payload.deliveryArea)) throw new ApiError(400, "Invalid delivery area");
    if (row.courier) throw new ApiError(400, `This card is already with ${row.courier}`);
    changes.deliveryArea = payload.deliveryArea;
    changes.codAmount = null;
  }
  // A custom delivery charge for this card; null goes back to the area's charge.
  if (payload?.deliveryCharge !== undefined) {
    if (isAgent(user)) throw new ApiError(403, "Agents cannot change the delivery charge");
    if (row.courier) throw new ApiError(400, `This card is already with ${row.courier}`);
    if (payload.deliveryCharge === null || payload.deliveryCharge === "") {
      changes.codAmount = null;
    } else {
      const amount = Number(payload.deliveryCharge);
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new ApiError(400, "Invalid delivery charge");
      changes.codAmount = Math.round(amount * 100) / 100;
    }
  }
  // Moving away from Approved withdraws the approval.
  if (status === "Approved") {
    if (!row.approvedAt) changes.approvedAt = new Date();
  } else if (status !== undefined) {
    changes.approvedAt = null;
  }
  await row.update(changes);
  const plain = row.get({ plain: true });
  // The list shows these two derived fields; keep the row the admin page merges in complete.
  return {
    ...plain,
    deliveryArea: effectiveArea(plain),
    deliveryCharge: chargeFor(plain, await getDeliveryCharges()),
  };
};

const deleteIdFromDB = async (id) => {
  const row = await ScratchCard().findOne({ where: { Id: id } });
  if (!row) throw new ApiError(404, "Scratch card not found");
  await row.destroy();
  return { deleted: true };
};

module.exports = {
  isCustomer,
  checkPhone, trackByPhone, submit, getAllFromDB, updateOneFromDB, deleteIdFromDB, getAgents, assignToAgent,
};
