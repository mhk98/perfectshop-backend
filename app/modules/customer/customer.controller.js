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
  const result = await Service.getOrders(req.user, req.query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Customer orders fetched successfully",
    meta: result.meta,
    data: result.orders,
  });
});

const getProfile = catchAsync(async (req, res) => {
  const result = await Service.getProfile(req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Customer profile fetched successfully",
    data: result,
  });
});

const updateProfile = catchAsync(async (req, res) => {
  const result = await Service.updateProfile(req.user, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Profile updated successfully",
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

const updatePhoto = catchAsync(async (req, res) => {
  const result = await Service.updatePhoto(req.user, req.file);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Profile photo updated successfully",
    data: result,
  });
});

const removePhoto = catchAsync(async (req, res) => {
  const result = await Service.removePhoto(req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Profile photo removed successfully",
    data: result,
  });
});

module.exports = {
  register, login, getOrders, getProfile, updateProfile, updatePhoto, removePhoto, changePassword,
};
