const catchAsync = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const Service = require("./tracking.service");

const getPublicConfig = catchAsync(async (req, res) => {
  const result = await Service.getPublicConfig();
  // Loaded on every storefront page; matches the server-side cache lifetime.
  res.set("Cache-Control", "public, max-age=300");
  sendResponse(res, { statusCode: 200, success: true, message: "Tracking config fetched", data: result });
});

const trackEvent = catchAsync(async (req, res) => {
  const result = Service.queueEvent(req.body, req);
  sendResponse(res, { statusCode: 202, success: true, message: "Tracking event accepted", data: result });
});

module.exports = { getPublicConfig, trackEvent };
