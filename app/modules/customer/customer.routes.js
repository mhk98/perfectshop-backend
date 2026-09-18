const router = require("express").Router();
const auth = require("../../middlewares/auth");
const C = require("./customer.controller");

router.post("/register", C.register);
router.post("/login", C.login);
router.get("/orders", auth(), C.getOrders);
router.patch("/change-password", auth(), C.changePassword);

module.exports = router;
