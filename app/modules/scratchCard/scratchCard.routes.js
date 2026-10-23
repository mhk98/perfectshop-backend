const router = require("express").Router();
const { ENUM_USER_ROLE } = require("../../enums/user");
const auth = require("../../middlewares/auth");
const { uploadSingle } = require("../../middlewares/upload");
const ApiError = require("../../../error/ApiError");
const Controller = require("./scratchCard.controller");
const { isCustomer } = require("./scratchCard.service");

router.get(   "/check",  Controller.checkPhone);
router.get(   "/track",  Controller.trackByPhone);
router.post(  "/submit", uploadSingle, Controller.submit);
// Every staff role other than admin/superAdmin is an agent and gets its own
// assigned claims only; the service enforces that. Customers are kept out.
const ADMINS = [ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN];
const staffOnly = (req, res, next) =>
  isCustomer(req.user) ? next(new ApiError(403, "Forbidden")) : next();
const ADMINS_AND_AGENTS = [auth(), staffOnly];
// Leaders see and work every claim like an admin, but cannot assign or delete.
const ADMINS_AND_LEADERS = [...ADMINS, ENUM_USER_ROLE.LEADER];

router.get(   "/agents", auth(...ADMINS_AND_LEADERS), Controller.getAgents);
router.post(  "/assign", auth(...ADMINS), Controller.assignToAgent);
router.post(  "/courier/sync",      auth(...ADMINS_AND_LEADERS), Controller.syncCourierStatus);
router.post(  "/courier/:provider", auth(...ADMINS_AND_LEADERS), Controller.sendToCourier);
router.get(   "/",       ...ADMINS_AND_AGENTS, Controller.getAllFromDB);
router.put(   "/:id",    ...ADMINS_AND_AGENTS, Controller.updateOneFromDB);
router.delete("/:id",    auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.deleteIdFromDB);

module.exports = router;
