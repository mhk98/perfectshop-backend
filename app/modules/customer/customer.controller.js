const catchAsync = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const Service = require("./customer.service");

const register = catchAsync(async (req, res) => {
  const result = await Service.register(req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Customer registered successfully",
    data: result,
  });
});

const login = catchAsync(async (req, res) => {
  const result = await Service.login(req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Customer logged in successfully",
    data: result,
  });
});

const getOrders = catchAsync(async (req, res) => {
  const result = await Service.getOrders(req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Customer orders fetched successfully",
    data: result,
  });
});

const changePassword = catchAsync(async (req, res) => {
  await Service.changePassword(req.user, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Password changed successfully",
    data: null,
  });
});

module.exports = { register, login, getOrders, changePassword };
