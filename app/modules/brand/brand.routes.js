const { ENUM_USER_ROLE } = require("../../enums/user");
const auth = require("../../middlewares/auth");
const BrandController = require("./brand.controller");
const router = require("express").Router();

router.post("/create", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.ACCOUNTANT), BrandController.insertIntoDB);
router.get("/public", BrandController.getPublicBrands);
router.get("/", auth(), BrandController.getAllFromDB);
router.get("/all", auth(), BrandController.getAllFromDBWithoutQuery);
router.get("/:id", auth(), BrandController.getDataById);
router.put("/:id", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.ACCOUNTANT), BrandController.updateOneFromDB);
router.delete("/:id", auth(ENUM_USER_ROLE.SUPER_ADMIN, ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.ACCOUNTANT), BrandController.deleteIdFromDB);

const BrandRoutes = router;
module.exports = BrandRoutes;
