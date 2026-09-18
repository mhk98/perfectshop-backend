const catchAsync   = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const Service      = require("./visitorStat.service");

const track    = catchAsync(async (req, res) => { const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip; const r = await Service.track(ip); sendResponse(res, { statusCode: 200, success: true, message: "Tracked", data: r }); });
const getStats = catchAsync(async (req, res) => { const r = await Service.getStats(); sendResponse(res, { statusCode: 200, success: true, message: "Stats fetched", data: r }); });

module.exports = { track, getStats };
