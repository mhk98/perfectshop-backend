const catchAsync = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const VisitorStatService = require("../visitorStat/visitorStat.service");
const { clearTrackingCache } = require("../tracking/tracking.cache");

const clear = catchAsync(async (_req, res) => {
  const cleared = [VisitorStatService.clearRuntimeCache(), clearTrackingCache()];
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Application cache cleared successfully",
    data: { cleared, clearedAt: new Date().toISOString() },
  });
});

module.exports = { clear };
