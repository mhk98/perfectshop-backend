const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;

// File storage on Cloudinary. Enabled when either CLOUDINARY_URL
// (cloudinary://<key>:<secret>@<cloud_name>) or the cloud name, API key and
// API secret are all set; otherwise uploads fail with a clear error instead of
// writing to disk.

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const STORAGE_FOLDER = (process.env.CLOUDINARY_FOLDER || "perfectshop").replace(/^\/+|\/+$/g, "");
// Optional: where old "<uuid>.<ext>" records that were never copied to
// Cloudinary live, e.g. https://<bucket>.sgp1.digitaloceanspaces.com/holygift
const LEGACY_FILES_BASE_URL = (process.env.LEGACY_FILES_BASE_URL || "").replace(/\/+$/, "");

if (CLOUD_NAME && API_KEY && API_SECRET) {
  cloudinary.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET });
}
// The SDK reads CLOUDINARY_URL by itself; always serve over https and keep
// generated URLs free of the SDK's analytics query string.
cloudinary.config({ secure: true, analytics: false });

const { cloud_name, api_key, api_secret } = cloudinary.config();
const isStorageEnabled = Boolean(cloud_name && api_key && api_secret);

const STORAGE_NOT_CONFIGURED_MESSAGE =
  "File storage is not configured (Cloudinary credentials missing)";

// PDFs go up as "raw" files: Cloudinary blocks delivery of PDFs uploaded as
// images on most accounts.
const RAW_EXTENSIONS = new Set([".pdf"]);
const FORMAT_BY_EXT = { ".jpeg": "jpg" };

const isRaw = (name) => RAW_EXTENSIONS.has(path.extname(name).toLowerCase());

// Image public IDs drop the extension (Cloudinary adds the format); raw files
// keep it because it is part of their URL.
const publicIdFor = (name) => {
  const base = isRaw(name) ? name : name.slice(0, name.length - path.extname(name).length);
  return STORAGE_FOLDER ? `${STORAGE_FOLDER}/${base}` : base;
};

// Public URL of a file uploaded under `name` (used for legacy /images/<name> links).
const publicUrlForFile = (name) => {
  if (LEGACY_FILES_BASE_URL) return `${LEGACY_FILES_BASE_URL}/${name}`;
  if (isRaw(name)) return cloudinary.url(publicIdFor(name), { resource_type: "raw" });
  const ext = path.extname(name).toLowerCase();
  return cloudinary.url(publicIdFor(name), {
    resource_type: "image",
    format: FORMAT_BY_EXT[ext] || ext.slice(1),
  });
};

const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(options, (error, result) => (error ? reject(error) : resolve(result)))
      .end(buffer);
  });

/**
 * Upload a buffer (multer memoryStorage), a base64 data URI or a local file
 * path to Cloudinary. `name` is the file name without folder, e.g.
 * "<uuid>.jpg". Resolves to { url, key } where key is the Cloudinary public ID.
 */
const uploadFile = async (source, name) => {
  if (!isStorageEnabled) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const options = {
    public_id: publicIdFor(name),
    resource_type: isRaw(name) ? "raw" : "image",
    // Names are random UUIDs, so an existing asset is the same file.
    overwrite: false,
  };

  let result;
  try {
    if (Buffer.isBuffer(source)) {
      result = await uploadBuffer(source, options);
    } else if (typeof source === "string" && source.startsWith("data:")) {
      result = await cloudinary.uploader.upload(source, options);
    } else {
      result = await uploadBuffer(fs.readFileSync(source), options);
    }
  } catch (error) {
    // The SDK rejects with a plain object ({ message, http_code }).
    throw error instanceof Error ? error : new Error(error?.message || "Cloudinary upload failed");
  }
  return { url: result.secure_url, key: result.public_id };
};

module.exports = {
  isStorageEnabled,
  uploadFile,
  publicUrlForFile,
  STORAGE_FOLDER,
  STORAGE_NOT_CONFIGURED_MESSAGE,
};
