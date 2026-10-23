const { Op } = require("sequelize");
const db = require("../../../models");
const ApiError = require("../../../error/ApiError");
const { courierClient: courier } = require("../order/order.service");
const { getDeliveryCharges, chargeFor } = require("./scratchCard.delivery");

const ScratchCard = () => db.scratchCard;

// Once a card is with the courier its status is the courier's own status,
// shown as-is ("in_review" -> "In Review").
const humanizeCourierStatus = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "In Courier";

// Groups a courier's own status into a stage the admin can filter on:
// in_courier, on_hold, delivered, returned or cancelled.
const courierStage = (provider, rawStatus) => {
  const map = provider === "Pathao" ? courier.mapPathaoStatusToOrderStatus : courier.mapSteadfastStatusToOrderStatus;
  return map(rawStatus) || "in_courier";
};

// Delivered, cancelled and returned parcels no longer change, so the sync stops checking them.
const isFinal = (mappedOrderStatus) => ["delivered", "cancelled", "returned"].includes(mappedOrderStatus);

// A courier's "Pending" (booked, not picked up yet) would read like our own
// pre-approval Pending, so it is shown as "In Courier" instead.
const displayCourierStatus = (rawStatus) => {
  const status = humanizeCourierStatus(rawStatus);
  return status === "Pending" ? "In Courier" : status;
};

const courierFields = (provider, rawStatus, mappedOrderStatus, extra = {}) => ({
  courier: provider,
  courierStatus: String(rawStatus || "").slice(0, 64) || null,
  courierFinal: isFinal(mappedOrderStatus),
  status: displayCourierStatus(rawStatus).slice(0, 32),
  ...extra,
});

// The prize is free; the customer pays only the delivery charge, collected as COD.
const steadfastPayload = (card, codAmount) => courier.compactObject({
  invoice: card.referenceCode,
  recipient_name: String(card.fullName).slice(0, 100),
  recipient_phone: courier.normalizeCourierPhone(card.phone),
  recipient_address: String(card.address).replace(/\s+/g, " ").trim().slice(0, 250),
  cod_amount: codAmount,
  item_description: `Scratch card prize: ${card.prize}`.slice(0, 250),
  note: `Scratch card ${card.referenceCode}. Collect delivery charge only (${codAmount} Tk)`,
});

const pathaoPayload = (card, config, codAmount) => courier.compactObject({
  store_id: config.storeId,
  merchant_order_id: card.referenceCode,
  recipient_name: String(card.fullName).slice(0, 100),
  recipient_phone: courier.normalizeCourierPhone(card.phone),
  recipient_address: String(card.address).replace(/\s+/g, " ").trim().slice(0, 220),
  recipient_city: config.recipientCity,
  recipient_zone: config.recipientZone,
  recipient_area: config.recipientArea,
  delivery_type: config.deliveryType,
  item_type: config.itemType,
  item_quantity: 1,
  item_weight: config.itemWeight,
  item_description: `Scratch card prize: ${card.prize}`.slice(0, 250),
  special_instruction: `Collect delivery charge only (${codAmount} Tk)`,
  amount_to_collect: codAmount,
});

// Splits the selection into cards that can go now and the reasons the rest can't.
const loadSendable = async (ids, provider) => {
  const cardIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!cardIds.length) throw new ApiError(400, "Scratch card IDs are required");
  if (cardIds.length > 500) throw new ApiError(400, "At most 500 scratch cards can be sent at once");

  const cards = await ScratchCard().findAll({ where: { Id: { [Op.in]: cardIds } } });
  const byId = new Map(cards.map((card) => [card.Id, card]));
  const ready = [];
  const skipped = [];
  for (const id of cardIds) {
    const card = byId.get(id);
    const ref = card?.referenceCode || id;
    if (!card) skipped.push({ reference: ref, message: "Scratch card not found" });
    else if (card.courier) skipped.push({ reference: ref, message: `Already sent to ${card.courier}` });
    else if (card.status !== "Approved") skipped.push({ reference: ref, message: `Only Approved cards can be sent (this one is ${card.status})` });
    else if (provider === "Pathao" && String(card.address).trim().length < 10) {
      skipped.push({ reference: ref, message: "Pathao needs an address of at least 10 characters" });
    } else ready.push(card);
  }
  return { ready, skipped };
};

const sendToSteadfast = async (ids) => {
  const { ready, skipped } = await loadSendable(ids, "Steadfast");
  if (!ready.length) return { sent: [], skipped };

  const charges = await getDeliveryCharges();
  const codAmounts = ready.map((card) => chargeFor(card, charges));
  const payloads = ready.map((card, index) => steadfastPayload(card, codAmounts[index]));
  const response = await courier.steadfastRequest("/create_order/bulk-order", {
    method: "POST",
    body: { data: JSON.stringify(payloads) },
  });
  const rows = Array.isArray(response) ? response : response?.data || [];
  const sent = [];
  await Promise.all(ready.map(async (card, index) => {
    const row = rows[index] || {};
    const ok = String(row.status || "").toLowerCase() === "success" || row.tracking_code || row.consignment_id;
    if (!ok) {
      skipped.push({ reference: card.referenceCode, message: row.message || "Steadfast rejected this card" });
      return;
    }
    const rawStatus = row.delivery_status || "in_review";
    await card.update(courierFields("Steadfast", rawStatus, courier.mapSteadfastStatusToOrderStatus(rawStatus), {
      consignmentId: row.consignment_id ? String(row.consignment_id) : null,
      trackingCode: row.tracking_code || null,
      courierSentAt: new Date(),
      codAmount: codAmounts[index],
    }));
    sent.push({ reference: card.referenceCode, trackingCode: row.tracking_code || null });
  }));
  return { sent, skipped };
};

const sendToPathao = async (ids) => {
  const { ready, skipped } = await loadSendable(ids, "Pathao");
  if (!ready.length) return { sent: [], skipped };

  const config = await courier.getPathaoConfig();
  const token = await courier.pathaoToken(config);
  const charges = await getDeliveryCharges();
  const sent = [];
  for (const card of ready) {
    try {
      const codAmount = chargeFor(card, charges);
      const response = await courier.pathaoRequest("/aladdin/api/v1/orders", {
        method: "POST", body: pathaoPayload(card, config, codAmount), config, token,
      });
      const data = response?.data || response || {};
      const rawStatus = data.order_status || data.status || "Pending";
      const consignmentId = data.consignment_id || data.consignmentId || null;
      await card.update(courierFields("Pathao", rawStatus, courier.mapPathaoStatusToOrderStatus(rawStatus), {
        consignmentId: consignmentId ? String(consignmentId) : null,
        trackingCode: consignmentId ? String(consignmentId) : null,
        courierSentAt: new Date(),
        codAmount,
      }));
      sent.push({ reference: card.referenceCode, trackingCode: consignmentId });
    } catch (error) {
      skipped.push({ reference: card.referenceCode, message: error.message || "Pathao rejected this card" });
    }
  }
  return { sent, skipped };
};

const sendToCourier = (provider, ids) => {
  if (provider === "steadfast") return sendToSteadfast(ids);
  if (provider === "pathao") return sendToPathao(ids);
  throw new ApiError(400, "Unknown courier");
};

// The background sync must not overwrite a card that changed while the
// courier was answering, so it only writes if the card is as it read it.
const saveSync = async (card, values, automatic) => {
  if (!automatic) return card.update(values);
  await ScratchCard().update(values, {
    where: { Id: card.Id, courier: card.courier, courierStatus: card.courierStatus },
  });
};

const syncSteadfastStatusInDB = async (id, { automatic = false } = {}) => {
  const card = await ScratchCard().findOne({ where: { Id: id } });
  if (!card || card.courier !== "Steadfast") throw new ApiError(404, "Scratch card is not with Steadfast");
  const path = card.consignmentId
    ? `/status_by_cid/${encodeURIComponent(card.consignmentId)}`
    : `/status_by_invoice/${encodeURIComponent(card.referenceCode)}`;
  const response = await courier.steadfastRequest(path);
  const rawStatus = response?.delivery_status || response?.status_text || "";
  if (!rawStatus) return card;
  await saveSync(card, courierFields("Steadfast", rawStatus, courier.mapSteadfastStatusToOrderStatus(rawStatus)), automatic);
  return card;
};

const syncPathaoStatusInDB = async (id, { automatic = false } = {}) => {
  const card = await ScratchCard().findOne({ where: { Id: id } });
  if (!card || card.courier !== "Pathao") throw new ApiError(404, "Scratch card is not with Pathao");
  if (!card.consignmentId) throw new ApiError(400, "Pathao consignment id is missing");
  const response = await courier.pathaoRequestFirst([
    `/aladdin/api/v1/orders/${encodeURIComponent(card.consignmentId)}/info`,
    `/aladdin/api/v1/orders/${encodeURIComponent(card.consignmentId)}`,
  ]);
  const data = response?.data || response || {};
  const rawStatus = data.order_status_slug || data.order_status || data.status_slug || data.status || "";
  if (!rawStatus) return card;
  await saveSync(card, courierFields("Pathao", rawStatus, courier.mapPathaoStatusToOrderStatus(rawStatus)), automatic);
  return card;
};

// Manual "Sync status" from the admin list.
const syncSelected = async (ids) => {
  const cardIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!cardIds.length) throw new ApiError(400, "Scratch card IDs are required");
  const cards = await ScratchCard().findAll({
    where: { Id: { [Op.in]: cardIds }, courier: { [Op.in]: ["Steadfast", "Pathao"] } },
    attributes: ["Id", "referenceCode", "courier"],
  });
  const synced = [];
  const failed = [];
  for (const card of cards) {
    try {
      const sync = card.courier === "Steadfast" ? syncSteadfastStatusInDB : syncPathaoStatusInDB;
      await sync(card.Id);
      synced.push(card.referenceCode);
    } catch (error) {
      failed.push({ reference: card.referenceCode, message: error.message });
    }
  }
  return { synced, failed, notWithCourier: cardIds.length - cards.length };
};

module.exports = { courierStage, sendToCourier, syncSelected, syncSteadfastStatusInDB, syncPathaoStatusInDB };
