/**
 * One-time migration: upload every file in UPLOAD_DIR (default ./images) to
 * DigitalOcean Spaces under the SAME name, so existing database values like
 * "<uuid>.jpg" or "images/<uuid>.jpg" keep working through the /images
 * redirect in server.js. Database rows are not modified.
 *
 * Usage:
 *   node tools/migrateUploadsToSpaces.js --dry-run   # list only
 *   node tools/migrateUploadsToSpaces.js             # upload
 *   node tools/migrateUploadsToSpaces.js /path/to/uploads
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  isStorageEnabled,
  uploadFile,
  STORAGE_FOLDER,
} = require("../helpers/storage");

const ALLOWED_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".gif", ".webp", ".pdf"]);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceDir = path.resolve(
  args.find((arg) => !arg.startsWith("--")) || process.env.UPLOAD_DIR || "images",
);

async function main() {
  if (!isStorageEnabled) {
    console.error("Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_REGION and DO_SPACES_BUCKET first.");
    process.exit(1);
  }
  if (!fs.existsSync(sourceDir)) {
    console.error(`Folder not found: ${sourceDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()));

  console.log(`${files.length} file(s) in ${sourceDir} -> Spaces folder "${STORAGE_FOLDER}"`);
  if (dryRun) {
    files.forEach((name) => console.log(`  ${name}`));
    return;
  }

  let uploaded = 0;
  const failed = [];
  for (const name of files) {
    try {
      const result = await uploadFile(path.join(sourceDir, name), name);
      uploaded += 1;
      console.log(`OK    ${name} -> ${result.url}`);
    } catch (error) {
      failed.push(name);
      console.error(`FAIL  ${name}: ${error.message}`);
    }
  }

  console.log(`\nDone. Uploaded: ${uploaded}, failed: ${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

main();
