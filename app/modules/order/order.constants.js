const ORDER_STATUS = {
  PENDING: "pending",
  PACKAGING: "packaging",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  RETURNED: "returned",
  ON_HOLD: "on_hold",
  IN_COURIER: "in_courier",
  DELIVERED: "delivered",
  INCOMPLETE: "incomplete",
};

const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);

const COURIER_OPTIONS = ["Pathao", "Steadfast", "Redx", "Paperfly", "eCourier"];

const ORDER_SEARCHABLE_FIELDS = ["customerName", "customerPhone", "orderId", "ipAddress"];

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  COURIER_OPTIONS,
  ORDER_SEARCHABLE_FIELDS,
};
