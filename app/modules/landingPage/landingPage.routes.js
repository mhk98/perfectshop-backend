const router = require("express").Router();
const { ENUM_USER_ROLE } = require("../../enums/user");
const auth = require("../../middlewares/auth");
const Controller = require("./landingPage.controller");

router.post("/create", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.insertIntoDB);
router.get("/header/public", Controller.getHeaderFromDB);
router.get("/header", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.getHeaderFromDB);
router.put("/header", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.upsertHeaderIntoDB);
router.get("/footer/public", Controller.getFooterFromDB);
router.get("/footer", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.getFooterFromDB);
router.put("/footer", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.upsertFooterIntoDB);
router.get("/public/:id", Controller.getPublicOneFromDB);
router.get("/", auth(), Controller.getAllFromDB);
router.get("/:id", auth(), Controller.getOneFromDB);
router.put("/:id", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.updateOneFromDB);
router.delete("/:id", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN), Controller.deleteIdFromDB);

module.exports = router;
