const catchAsync = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const pick = require("../../../shared/pick");
const OrderService = require("./order.service");
const OrderFraudCheckService = require("./orderFraudCheck.service");

const resolveIpAddress = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "").split(",")[0];
  return (rawIp || req.ip || req.socket?.remoteAddress || "")
    .replace(/^::ffff:/, "")
    .trim() || null;
};

const createOrder = catchAsync(async (req, res) => {
  const result = await OrderService.createOrderInDB({
    ...req.body,
    ipAddress: req.body.ipAddress || resolveIpAddress(req),
  });
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Order created successfully",
    data: result,
  });
});

const saveIncompleteOrder = catchAsync(async (req, res) => {
  const result = await OrderService.saveIncompleteOrderInDB({
    ...req.body,
    ipAddress: req.body.ipAddress || resolveIpAddress(req),
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Incomplete order saved successfully",
    data: result,
  });
});

const getOrders = catchAsync(async (req, res) => {
  const filters = pick(req.query, ["status", "search", "fromDate", "toDate", "assignedEmployeeId"]);
  const paginationOptions = pick(req.query, ["page", "limit", "sortBy", "sortOrder"]);
  const result = await OrderService.getOrdersFromDB(filters, paginationOptions, req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders fetched successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getOrderStatusCounts = catchAsync(async (req, res) => {
  const result = await OrderService.getOrderStatusCountsFromDB(req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order status counts fetched successfully",
    data: result,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const result = await OrderService.getOrderByIdFromDB(req.params.id, req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order fetched successfully",
    data: result,
  });
});

const getOrderFraudCheck = catchAsync(async (req, res) => {
  const result = await OrderFraudCheckService.getFraudCheckFromDB(req.params.id, {
    refresh: req.query.refresh === "1" || req.query.refresh === "true",
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order fraud check fetched successfully",
    data: result,
  });
});

const getAssignableEmployees = catchAsync(async (req, res) => {
  const result = await OrderService.getAssignableEmployeesFromDB();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Assignable employees fetched successfully",
    data: result,
  });
});

const bulkAssignOrdersToEmployee = catchAsync(async (req, res) => {
  const result = await OrderService.bulkAssignOrdersToEmployeeInDB(
    req.body.orderIds || [],
    req.body.employeeId,
    req.user,
  );
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders assigned successfully",
    data: result,
  });
});

const trackOrdersByPhone = catchAsync(async (req, res) => {
  const result = await OrderService.trackOrdersByPhoneFromDB(req.query.phone, req.query.invoiceId, {
    includeHistory: req.query.history === "true",
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders tracked successfully",
    data: result,
  });
});

const sendReconfirmOtp = catchAsync(async (req, res) => {
  const result = await OrderService.sendOrderReconfirmOtpInDB(req.params.id, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: result.alreadyConfirmed
      ? "Order is already confirmed"
      : "OTP sent successfully",
    data: result,
  });
});

const verifyReconfirmOtp = catchAsync(async (req, res) => {
  const result = await OrderService.verifyOrderReconfirmOtpInDB(req.params.id, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order confirmed successfully",
    data: result,
  });
});

const updateOrder = catchAsync(async (req, res) => {
  const result = await OrderService.updateOrderInDB(req.params.id, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order updated successfully",
    data: result,
  });
});

const updateOrderStatus = catchAsync(async (req, res) => {
  const result = await OrderService.updateOrderStatusInDB(req.params.id, req.body.status, req.user.Id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order status updated successfully",
    data: result,
  });
});

const sendOrderToSteadfast = catchAsync(async (req, res) => {
  const result = await OrderService.sendOrderToSteadfastInDB(req.params.id, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order sent to Steadfast successfully",
    data: result,
  });
});

const sendOrderToPathao = catchAsync(async (req, res) => {
  const result = await OrderService.sendOrderToPathaoInDB(req.params.id, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order sent to Pathao successfully",
    data: result,
  });
});

const bulkSendOrdersToSteadfast = catchAsync(async (req, res) => {
  const result = await OrderService.bulkSendOrdersToSteadfastInDB(req.body.orderIds || [], req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders sent to Steadfast successfully",
    data: result,
  });
});

const bulkSendOrdersToPathao = catchAsync(async (req, res) => {
  const result = await OrderService.bulkSendOrdersToPathaoInDB(req.body.orderIds || [], req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Orders sent to Pathao successfully",
    data: result,
  });
});

const syncSteadfastStatus = catchAsync(async (req, res) => {
  const result = await OrderService.syncSteadfastStatusInDB(req.params.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast status synced successfully",
    data: result,
  });
});

const syncPathaoStatus = catchAsync(async (req, res) => {
  const result = await OrderService.syncPathaoStatusInDB(req.params.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Pathao status synced successfully",
    data: result,
  });
});

const getSteadfastBalance = catchAsync(async (req, res) => {
  const result = await OrderService.getSteadfastBalanceFromProvider();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast balance fetched successfully",
    data: result,
  });
});

const createSteadfastReturnRequest = catchAsync(async (req, res) => {
  const result = await OrderService.createSteadfastReturnRequestInDB(req.params.id, req.body.reason);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast return request created successfully",
    data: result,
  });
});

const getSteadfastReturnRequests = catchAsync(async (req, res) => {
  const result = await OrderService.getSteadfastReturnRequestsFromProvider();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast return requests fetched successfully",
    data: result,
  });
});

const getSteadfastPayments = catchAsync(async (req, res) => {
  const result = await OrderService.getSteadfastPaymentsFromProvider(req.params.paymentId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast payments fetched successfully",
    data: result,
  });
});

const getSteadfastPoliceStations = catchAsync(async (req, res) => {
  const result = await OrderService.getSteadfastPoliceStationsFromProvider();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Steadfast police stations fetched successfully",
    data: result,
  });
});

const deleteOrder = catchAsync(async (req, res) => {
  const result = await OrderService.deleteOrderFromDB(req.params.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: result.message,
    data: null,
  });
});

const OrderController = {
  createOrder,
  saveIncompleteOrder,
  getOrders,
  getOrderStatusCounts,
  getOrderById,
  getOrderFraudCheck,
  getAssignableEmployees,
  bulkAssignOrdersToEmployee,
  trackOrdersByPhone,
  sendReconfirmOtp,
  verifyReconfirmOtp,
  updateOrder,
  updateOrderStatus,
  sendOrderToSteadfast,
  sendOrderToPathao,
  bulkSendOrdersToSteadfast,
  bulkSendOrdersToPathao,
  syncSteadfastStatus,
  syncPathaoStatus,
  getSteadfastBalance,
  createSteadfastReturnRequest,
  getSteadfastReturnRequests,
  getSteadfastPayments,
  getSteadfastPoliceStations,
  deleteOrder,
};

module.exports = OrderController;
