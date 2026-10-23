const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// File storage on DigitalOcean Spaces (S3-compatible). Enabled only when the
// key, secret, region and bucket are all set; otherwise uploads fail with a
// clear error instead of writing to disk.

const SPACES_KEY = process.env.DO_SPACES_KEY;
const SPACES_SECRET = process.env.DO_SPACES_SECRET;
const SPACES_REGION = process.env.DO_SPACES_REGION; // e.g. "sgp1"
const SPACES_BUCKET = process.env.DO_SPACES_BUCKET;
const SPACES_ENDPOINT =
  process.env.DO_SPACES_ENDPOINT ||
  (SPACES_REGION ? `https://${SPACES_REGION}.digitaloceanspaces.com` : "");
// Optional CDN / custom domain, e.g. https://<bucket>.sgp1.cdn.digitaloceanspaces.com
const SPACES_CDN_URL = (process.env.DO_SPACES_CDN_URL || "").replace(/\/+$/, "");
const STORAGE_FOLDER = (process.env.DO_SPACES_FOLDER || "holygift").replace(/^\/+|\/+$/g, "");

const isStorageEnabled = Boolean(SPACES_KEY && SPACES_SECRET && SPACES_REGION && SPACES_BUCKET);

const STORAGE_NOT_CONFIGURED_MESSAGE =
  "File storage is not configured (DigitalOcean Spaces credentials missing)";

const s3 = isStorageEnabled
  ? new S3Client({
      endpoint: SPACES_ENDPOINT,
      region: SPACES_REGION,
      credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET },
      forcePathStyle: false,
    })
  : null;

const CONTENT_TYPE_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

const keyFor = (name) => (STORAGE_FOLDER ? `${STORAGE_FOLDER}/${name}` : name);

const publicUrlForKey = (key) =>
  SPACES_CDN_URL
    ? `${SPACES_CDN_URL}/${key}`
    : `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`;

// Public URL of a file uploaded under `name` (used for legacy /images/<name> links).
const publicUrlForFile = (name) => publicUrlForKey(keyFor(name));

const DATA_URI = /^data:([^;,]+);base64,(.*)$/s;

const toBody = (source) => {
  if (Buffer.isBuffer(source)) return { body: source };
  const match = typeof source === "string" && source.match(DATA_URI);
  if (match) return { body: Buffer.from(match[2], "base64"), contentType: match[1] };
  return { body: fs.readFileSync(source) };
};

/**
 * Upload a buffer (multer memoryStorage), a base64 data URI or a local file
 * path to Spaces as a public-read object. `name` is the file name without
 * folder, e.g. "<uuid>.jpg". Resolves to { url, key }.
 */
const uploadFile = async (source, name) => {
  if (!isStorageEnabled) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const { body, contentType } = toBody(source);
  const key = keyFor(name);
  await s3.send(
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: body,
      ACL: "public-read",
      ContentType:
        contentType ||
        CONTENT_TYPE_BY_EXT[path.extname(name).toLowerCase()] ||
        "application/octet-stream",
      // Names are random UUIDs and never overwritten, so they can be cached forever.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { url: publicUrlForKey(key), key };
};

module.exports = {
  isStorageEnabled,
  uploadFile,
  publicUrlForFile,
  STORAGE_FOLDER,
  STORAGE_NOT_CONFIGURED_MESSAGE,
};
