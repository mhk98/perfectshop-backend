/**
 * One-time migration: rows saved before helpers/inlineImages existed still hold
 * base64 image data URIs (the site logo alone was 2 MB). They are embedded in
 * every storefront page, so the home page HTML grew to ~30 MB. This uploads each
 * data URI to Cloudinary and stores only the URL, using the same helper new
 * saves go through.
 *
 * Scans every TEXT/STRING/JSON column of every model, so nothing is missed.
 *
 * Usage:
 *   node tools/migrateInlineImagesToCloudinary.js --dry-run   # report only
 *   node tools/migrateInlineImagesToCloudinary.js             # upload + update
 */
require("dotenv").config();

const { Op } = require("sequelize");
const db = require("../models");
const { isCloudinaryEnabled } = require("../helpers/cloudinary");
const { replaceInlineImages } = require("../helpers/inlineImages");

const dryRun = process.argv.includes("--dry-run");
const MARKER = "data:image/";
// Audit logs keep truncated request bodies: the data URIs there are partial,
// never rendered, and the log should stay as recorded.
const SKIP_MODELS = new Set(["UserLogHistory"]);

const textColumns = (model) =>
  Object.entries(model.rawAttributes)
    .filter(([, attr]) => ["TEXT", "STRING", "JSON", "CHAR"].includes(attr.type?.key))
    .map(([name, attr]) => ({ name, field: attr.field || name }));

const size = (value) =>
  Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? ""));

async function migrateModel(model) {
  const columns = textColumns(model);
  if (!columns.length) return { rows: 0, saved: 0 };

  const { sequelize } = model;
  const rows = await model.findAll({
    attributes: [...model.primaryKeyAttributes, ...columns.map((c) => c.name)],
    where: {
      [Op.or]: columns.map((c) =>
        sequelize.where(sequelize.cast(sequelize.col(c.field), "CHAR"), { [Op.like]: `%${MARKER}%` }),
      ),
    },
    paranoid: false,
  });

  let saved = 0;
  for (const row of rows) {
    const id = model.primaryKeyAttributes.map((key) => row.get(key)).join("/");
    const changes = {};
    for (const { name } of columns) {
      const value = row.get(name);
      if (!JSON.stringify(value ?? "").includes(MARKER)) continue;
      if (dryRun) {
        console.log(`  ${model.name}#${id}.${name}: ${(size(value) / 1024).toFixed(0)} KB`);
        continue;
      }
      const next = await replaceInlineImages(value);
      saved += size(value) - size(next);
      changes[name] = next;
      if (JSON.stringify(next).includes(MARKER)) {
        console.warn(`  ${model.name}#${id}.${name}: some inline data could not be recognised; check it manually`);
      }
    }
    if (Object.keys(changes).length) {
      await model.update(changes, {
        where: Object.fromEntries(model.primaryKeyAttributes.map((key) => [key, row.get(key)])),
        paranoid: false,
        hooks: false,
        silent: true,
      });
      console.log(`OK    ${model.name}#${id} (${Object.keys(changes).join(", ")})`);
    }
  }
  return { rows: rows.length, saved };
}

async function main() {
  if (!dryRun && !isCloudinaryEnabled) {
    console.error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET first.");
    process.exit(1);
  }
  await db.sequelize.authenticate();
  // models/index.js runs its schema checks on load; wait so we don't close the
  // connection underneath them. Over a remote connection this takes a while.
  console.log("Waiting for model schema checks...");
  let started = Date.now();
  await db.ready;
  console.log(`Schema checks done (${((Date.now() - started) / 1000).toFixed(0)}s). Scanning tables...`);

  let totalRows = 0;
  let totalSaved = 0;
  const failed = [];
  for (const model of Object.values(db.sequelize.models)) {
    if (SKIP_MODELS.has(model.name)) continue;
    try {
      started = Date.now();
      process.stdout.write(`  ${model.name}... `);
      const { rows, saved } = await migrateModel(model);
      console.log(`${rows} row(s) with inline images (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      totalRows += rows;
      totalSaved += saved;
    } catch (error) {
      failed.push(model.name);
      console.error(`FAIL  ${model.name}: ${error.message}`);
    }
  }

  console.log(`\n${dryRun ? "Dry run" : "Done"}. Rows: ${totalRows}` +
    (dryRun ? "" : `, removed ${(totalSaved / 1024 / 1024).toFixed(1)} MB of inline data`) +
    (failed.length ? `, failed: ${failed.join(", ")}` : ""));
  if (failed.length) process.exitCode = 1;
  await db.sequelize.close();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await db.sequelize.close().catch(() => {});
});
