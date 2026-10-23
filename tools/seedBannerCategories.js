/**
 * Adds the storefront's banner categories, with the recommended image size in
 * the name so admins know what to upload. Existing categories (matched by the
 * placement keyword, case-insensitive) are left untouched, so this is safe to
 * re-run; a category an admin deleted is not recreated by server startup.
 *
 * The placement keyword in each name is what banner.service.js `categoryType`
 * uses to decide where a banner is shown, so keep it when renaming.
 *
 * Usage: node tools/seedBannerCategories.js
 */
require("dotenv").config();

const { Op } = require("sequelize");
const db = require("../models");

const CATEGORIES = [
  // Home hero, left (about 65% wide, 490px tall on desktop; full width, 210px on mobile).
  { keyword: "main slider", name: "Main Slider (1200x630)", sortOrder: 1 },
  // Home hero, right column: 2 banners stacked on desktop, side by side under the slider on mobile.
  { keyword: "slider right", name: "Slider Right (800x400)", sortOrder: 2 },
  // Home page popup shown once on load (first active banner only).
  { keyword: "popup", name: "Popup (720x420)", sortOrder: 3 },
  // Top of the scratch card submit / another card / track pages.
  { keyword: "scratch card (", name: "Scratch Card (1920x480)", sortOrder: 4 },
  // Optional: replaces the banner above on phones (600px and narrower) when set.
  { keyword: "scratch card mobile", name: "Scratch Card Mobile (1080x540)", sortOrder: 5 },
];

async function main() {
  await db.ready;
  for (const { keyword, name, sortOrder } of CATEGORIES) {
    const existing = await db.bannerCategory.findOne({
      where: { name: { [Op.like]: `%${keyword}%` } },
    });
    if (existing) {
      console.log(`SKIP  "${existing.name}" already exists`);
      continue;
    }
    await db.bannerCategory.create({ name, status: "Active", sortOrder });
    console.log(`ADD   "${name}"`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
