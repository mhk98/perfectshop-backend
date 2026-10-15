const multer = require("multer");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  isCloudinaryEnabled,
  uploadToCloudinary,
} = require("../../helpers/cloudinary");
const ApiError = require("../../error/ApiError");

<<<<<<< HEAD
// Every upload goes to Cloudinary; there is no local disk fallback, so a
// missing configuration fails the request instead of silently writing files
// that disappear on the next deploy.
=======
// Local fallback (used only when Cloudinary credentials are not set).
// In production, point UPLOAD_DIR to an absolute path OUTSIDE the git-deployed
// directory (e.g. /home/<user>/persistent-uploads) so files survive redeploys.
const UPLOAD_DIR = process.env.UPLOAD_DIR || "images";
if (!isCloudinaryEnabled) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c

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

<<<<<<< HEAD
const storage = multer.memoryStorage();
=======
const storage = isCloudinaryEnabled
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
      },
      filename: (req, file, cb) => {
        cb(null, generateFileName(file));
      },
    });
>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c

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

<<<<<<< HEAD
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
=======
const collectFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") return Object.values(req.files).flat();
  return [];
};

// Uploads the in-memory files to Cloudinary, then sets `filename` and `path`
// to the secure URL, so controllers that store either keep working unchanged.
// Cloudinary rejects with plain objects ({ message, http_code }); wrap them so the
// client sees the real reason instead of a generic 500.
const uploadOrThrow = async (file) => {
  try {
    return await uploadToCloudinary(file.buffer, generateFileName(file));
  } catch (error) {
    const reason = error?.message || error?.error?.message || "Unknown Cloudinary error";
    console.error(`[Cloudinary] upload failed (${error?.http_code || "no status"}): ${reason}`);
    throw new ApiError(502, `Image upload failed: ${reason}`);
  }
};

>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c
const pushToCloudinary = async (req) => {
  const files = collectFiles(req);
  await Promise.all(
    files.map(async (file) => {
<<<<<<< HEAD
      const result = await uploadToCloudinary(
        file.buffer,
        generateFileName(file),
      );
=======
      const result = await uploadOrThrow(file);
>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c
      file.filename = result.secure_url;
      file.path = result.secure_url;
      file.cloudinaryPublicId = result.public_id;
      file.buffer = undefined;
    }),
  );
};

<<<<<<< HEAD
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
=======
const withStorage = (multerMiddleware) => {
  if (!isCloudinaryEnabled) return multerMiddleware;
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) return next(err);
      pushToCloudinary(req).then(() => next(), next);
    });
  };
>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c
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
<<<<<<< HEAD

const uploadAvatar = withStorage(
  multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: imageOnlyFilter,
  }).single("image"),
);
=======
>>>>>>> 8cb196d76bb57f37ca6383d319f739e25cddbe1c

module.exports = {
  uploadFile,
  uploadPdf,
  uploadSingle,
  uploadUserDocuments,
  uploadMultiple,
  uploadAvatar,
};
