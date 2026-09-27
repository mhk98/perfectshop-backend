const path = require("path");
const { v2: cloudinary } = require("cloudinary");

// Enabled only when all three credentials are present, so local development
// keeps working with plain disk uploads.
const isCloudinaryEnabled = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
);

if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "perfectshop";

/**
 * Upload a buffer (multer memoryStorage) or a local file path to Cloudinary.
 * PDFs go up as "raw" so they are downloadable as-is; everything else as image.
 * `name` is the file name without folder, e.g. "<uuid>.jpg".
 */
const uploadToCloudinary = (source, name) => {
  const ext = path.extname(name).toLowerCase();
  const isPdf = ext === ".pdf";
  const options = {
    folder: CLOUDINARY_FOLDER,
    // raw assets keep their extension in the public_id; images get it from format
    public_id: isPdf ? name : path.basename(name, ext),
    resource_type: isPdf ? "raw" : "image",
    overwrite: false,
    unique_filename: false,
  };

  if (typeof source === "string") {
    return cloudinary.uploader.upload(source, options);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) =>
      error ? reject(error) : resolve(result),
    );
    stream.end(source);
  });
};

// Delivery URL for a file uploaded by uploadToCloudinary under its original
// "<uuid>.<ext>" name (used for legacy /images/<name> links).
const cloudinaryUrlForLegacyFile = (name, ext = path.extname(name).toLowerCase()) =>
  ext === ".pdf"
    ? cloudinary.url(`${CLOUDINARY_FOLDER}/${name}`, { resource_type: "raw", secure: true })
    : cloudinary.url(`${CLOUDINARY_FOLDER}/${path.basename(name, ext)}`, {
        resource_type: "image",
        format: ext.slice(1),
        secure: true,
      });

module.exports = {
  cloudinary,
  isCloudinaryEnabled,
  uploadToCloudinary,
  cloudinaryUrlForLegacyFile,
  CLOUDINARY_FOLDER,
};
