const router = require("express").Router();
const auth = require("../../middlewares/auth");
const { uploadAvatar } = require("../../middlewares/upload");
const C = require("./customer.controller");

router.post("/register", C.register);
router.post("/login", C.login);
router.get("/orders", auth(), C.getOrders);
router.get("/profile", auth(), C.getProfile);
router.patch("/profile", auth(), C.updateProfile);
router.patch("/profile/photo", auth(), uploadAvatar, C.updatePhoto);
router.delete("/profile/photo", auth(), C.removePhoto);
router.patch("/change-password", auth(), C.changePassword);

module.exports = router;
