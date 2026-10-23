// The customer pays the delivery charge for a prize, so the courier collects it
// as COD. Prize delivery has its own fixed charges, separate from the website's.
const DELIVERY_AREAS = ["inside", "outside"];
const DELIVERY_CHARGES = { inside: 100, outside: 150 };

// The claim form has a free-text address and no district. Dhaka anywhere in it
// counts as inside Dhaka, as the storefront treats Dhaka district; an admin can
// override a wrong guess per card (deliveryArea).
const DHAKA_PATTERN = /dhaka|ঢাকা/i;
const detectArea = (address) => (DHAKA_PATTERN.test(String(address || "")) ? "inside" : "outside");

const effectiveArea = (card) =>
  DELIVERY_AREAS.includes(card.deliveryArea) ? card.deliveryArea : detectArea(card.address);

// Async so callers don't change if the charges move to settings later.
const getDeliveryCharges = async () => ({ ...DELIVERY_CHARGES });

// codAmount set before sending is an admin's own charge for this card; once
// sent it is the amount the courier was told to collect.
const chargeFor = (card, charges) =>
  card.codAmount != null ? Number(card.codAmount) : charges[effectiveArea(card)];

module.exports = { DELIVERY_AREAS, effectiveArea, getDeliveryCharges, chargeFor };
