const multer = require("multer");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  isCloudinaryEnabled,
  uploadToCloudinary,
} = require("../../helpers/cloudinary");
const ApiError = require("../../error/ApiError");

// Every upload goes to Cloudinary; there is no local disk fallback, so a
// missing configuration fails the request instead of silently writing files
// that disappear on the next deploy.

// Allowed MIME types — zip removed (security risk)
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpeg",
  ".jpg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
]);

// UUID filename — prevents path traversal and originalname injection
const generateFileName = (file) =>
  `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.has(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    cb(
      new Error("Invalid file format. Allowed: jpeg, jpg, png, gif, webp, pdf"),
    );
  }
};

// Profile photos: images only (no PDF), checked before anything reaches Cloudinary.
const imageOnlyFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (
    file.mimetype.startsWith("image/") &&
    ALLOWED_MIME_TYPES.has(file.mimetype) &&
    ext !== ".pdf" &&
    ALLOWED_EXTENSIONS.has(ext)
  ) {
    cb(null, true);
  } else {
    cb(
      new ApiError(
        400,
        "Invalid image format. Allowed: jpeg, jpg, png, gif, webp",
      ),
    );
  }
};

const collectFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object")
    return Object.values(req.files).flat();
  return [];
};

// Uploads the in-memory files to Cloudinary, then sets `filename` and `path`
// to the secure URL, so controllers that store either keep working unchanged.
const pushToCloudinary = async (req) => {
  const files = collectFiles(req);
  await Promise.all(
    files.map(async (file) => {
      const result = await uploadToCloudinary(
        file.buffer,
        generateFileName(file),
      );
      file.filename = result.secure_url;
      file.path = result.secure_url;
      file.cloudinaryPublicId = result.public_id;
      file.buffer = undefined;
    }),
  );
};

const withStorage = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (err) {
      return next(
        err.code === "LIMIT_FILE_SIZE"
          ? new ApiError(400, "File is too large")
          : err,
      );
    }
    if (!collectFiles(req).length) return next();
    if (!isCloudinaryEnabled) {
      return next(
        new ApiError(
          500,
          "File storage is not configured (Cloudinary credentials missing)",
        ),
      );
    }
    pushToCloudinary(req).then(() => next(), next);
  });
};

const createUpload = () =>
  multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter,
  });

const uploadFile = withStorage(createUpload().single("file"));

const uploadPdf = withStorage(createUpload().single("file"));

const uploadSingle = withStorage(createUpload().single("image"));

const uploadUserDocuments = withStorage(
  createUpload().fields([
    { name: "image", maxCount: 1 },
    { name: "idCard", maxCount: 1 },
    { name: "cv", maxCount: 1 },
    { name: "guardianPhoto", maxCount: 1 },
    { name: "guardianIdCard", maxCount: 1 },
  ]),
);

const uploadMultiple = withStorage(createUpload().array("gallery_images", 10));

const uploadAvatar = withStorage(
  multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: imageOnlyFilter,
  }).single("image"),
);

module.exports = {
  uploadFile,
  uploadPdf,
  uploadSingle,
  uploadUserDocuments,
  uploadMultiple,
  uploadAvatar,
};
