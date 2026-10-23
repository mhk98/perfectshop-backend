const catchAsync  = require("../../../shared/catchAsync");
const sendResponse = require("../../../shared/sendResponse");
const pick         = require("../../../shared/pick");
const Service      = require("./scratchCard.service");
const Courier      = require("./scratchCard.courier");

const checkPhone = catchAsync(async (req, res) => {
  const result = await Service.checkPhone(req.query.phone);
  sendResponse(res, { statusCode: 200, success: true, message: "Phone checked", data: result });
});

const trackByPhone = catchAsync(async (req, res) => {
  const result = await Service.trackByPhone(req.query.phone);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch cards tracked", data: result });
});

const submit = catchAsync(async (req, res) => {
  const result = await Service.submit(req.body, req.file);
  sendResponse(res, { statusCode: 201, success: true, message: "Scratch card submitted", data: result });
});

const getAllFromDB = catchAsync(async (req, res) => {
  const filters = pick(req.query, ["searchTerm", "status", "claimType", "reference", "phone", "submittedFrom", "submittedTo", "approvedFrom", "approvedTo", "assignedAgentId", "prize", "courierStatus"]);
  const options = pick(req.query, ["limit", "page", "sortBy", "sortOrder"]);
  const result = await Service.getAllFromDB(filters, options, req.user);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch cards fetched", meta: result.meta, data: result.data });
});

const updateOneFromDB = catchAsync(async (req, res) => {
  const result = await Service.updateOneFromDB(req.params.id, req.body, req.user);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch card updated", data: result });
});

const getAgents = catchAsync(async (req, res) => {
  const result = await Service.getAgents();
  sendResponse(res, { statusCode: 200, success: true, message: "Agents fetched", data: result });
});

const assignToAgent = catchAsync(async (req, res) => {
  const result = await Service.assignToAgent(req.body.ids, req.body.agentId, req.user);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch cards assigned", data: result });
});

const sendToCourier = catchAsync(async (req, res) => {
  const result = await Courier.sendToCourier(String(req.params.provider).toLowerCase(), req.body.ids);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch cards sent to courier", data: result });
});

const syncCourierStatus = catchAsync(async (req, res) => {
  const result = await Courier.syncSelected(req.body.ids);
  sendResponse(res, { statusCode: 200, success: true, message: "Courier status synced", data: result });
});

const deleteIdFromDB = catchAsync(async (req, res) => {
  const result = await Service.deleteIdFromDB(req.params.id);
  sendResponse(res, { statusCode: 200, success: true, message: "Scratch card deleted", data: result });
});

module.exports = {
  checkPhone, trackByPhone, submit, getAllFromDB, updateOneFromDB, deleteIdFromDB, getAgents, assignToAgent,
  sendToCourier, syncCourierStatus,
};
