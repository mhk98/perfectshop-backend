const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  isCloudinaryEnabled,
  uploadToCloudinary,
} = require("../../helpers/cloudinary");

// Local fallback (used only when Cloudinary credentials are not set).
// In production, point UPLOAD_DIR to an absolute path OUTSIDE the git-deployed
// directory (e.g. /home/<user>/persistent-uploads) so files survive redeploys.
const UPLOAD_DIR = process.env.UPLOAD_DIR || "images";
if (!isCloudinaryEnabled) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.has(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file format. Allowed: jpeg, jpg, png, gif, webp, pdf"));
  }
};

const collectFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") return Object.values(req.files).flat();
  return [];
};

// Uploads the in-memory files to Cloudinary, then sets `filename` and `path`
// to the secure URL, so controllers that store either keep working unchanged.
const pushToCloudinary = async (req) => {
  const files = collectFiles(req);
  await Promise.all(
    files.map(async (file) => {
      const result = await uploadToCloudinary(file.buffer, generateFileName(file));
      file.filename = result.secure_url;
      file.path = result.secure_url;
      file.cloudinaryPublicId = result.public_id;
      file.buffer = undefined;
    }),
  );
};

const withStorage = (multerMiddleware) => {
  if (!isCloudinaryEnabled) return multerMiddleware;
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) return next(err);
      pushToCloudinary(req).then(() => next(), next);
    });
  };
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

module.exports = {
  uploadFile,
  uploadPdf,
  uploadSingle,
  uploadUserDocuments,
  uploadMultiple,
};
