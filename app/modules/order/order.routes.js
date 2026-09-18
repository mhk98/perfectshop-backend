const express = require("express");
const { ENUM_USER_ROLE } = require("../../enums/user");
const auth = require("../../middlewares/auth");
const OrderController = require("./order.controller");

const router = express.Router();

// Public — customers place orders from the website without login
router.post("/", OrderController.createOrder);
router.post("/create", OrderController.createOrder);
router.post("/incomplete", OrderController.saveIncompleteOrder);
router.get("/track", OrderController.trackOrdersByPhone);
router.post("/:id/reconfirm/send-otp", OrderController.sendReconfirmOtp);
router.post("/:id/reconfirm/verify", OrderController.verifyReconfirmOtp);

// Admin panel — require authentication
router.get("/status-counts", auth(), OrderController.getOrderStatusCounts);
router.get("/courier/steadfast/balance", auth(), OrderController.getSteadfastBalance);
router.get("/courier/steadfast/returns", auth(), OrderController.getSteadfastReturnRequests);
router.get("/courier/steadfast/payments", auth(), OrderController.getSteadfastPayments);
router.get("/courier/steadfast/payments/:paymentId", auth(), OrderController.getSteadfastPayments);
router.get("/courier/steadfast/police-stations", auth(), OrderController.getSteadfastPoliceStations);
router.get(
  "/assignees",
  auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN),
  OrderController.getAssignableEmployees,
);
router.post(
  "/assign",
  auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN),
  OrderController.bulkAssignOrdersToEmployee,
);
router.post(
  "/courier/steadfast/bulk",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.bulkSendOrdersToSteadfast,
);
router.post(
  "/courier/pathao/bulk",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.bulkSendOrdersToPathao,
);
router.get("/", auth(), OrderController.getOrders);
router.get("/:id/fraud-check", auth(), OrderController.getOrderFraudCheck);
router.post(
  "/:id/courier/steadfast",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.sendOrderToSteadfast,
);
router.post(
  "/:id/courier/pathao",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.sendOrderToPathao,
);
router.get("/:id/courier/steadfast/status", auth(), OrderController.syncSteadfastStatus);
router.get("/:id/courier/pathao/status", auth(), OrderController.syncPathaoStatus);
router.post(
  "/:id/courier/steadfast/return",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.createSteadfastReturnRequest,
);
router.get("/:id", auth(), OrderController.getOrderById);
router.put(
  "/:id/status",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.updateOrderStatus,
);
router.put(
  "/:id",
  auth(
    ENUM_USER_ROLE.SUPER_ADMIN,
    ENUM_USER_ROLE.ADMIN,
    ENUM_USER_ROLE.CS,
    ENUM_USER_ROLE.LOGISTICS,
  ),
  OrderController.updateOrder,
);
router.delete(
  "/:id",
  auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN),
  OrderController.deleteOrder,
);

const OrderRoutes = router;
module.exports = OrderRoutes;
