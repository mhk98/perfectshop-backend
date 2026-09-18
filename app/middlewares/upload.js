const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const UPLOAD_DIR = "images";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // UUID filename — prevents path traversal and originalname injection
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
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

const uploadFile = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).single("file");

const uploadPdf = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).single("file");

const uploadSingle = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).single("image");

const uploadUserDocuments = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).fields([
  { name: "image", maxCount: 1 },
  { name: "idCard", maxCount: 1 },
  { name: "cv", maxCount: 1 },
  { name: "guardianPhoto", maxCount: 1 },
  { name: "guardianIdCard", maxCount: 1 },
]);

const uploadMultiple = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).array("gallery_images", 10);

module.exports = {
  uploadFile,
  uploadPdf,
  uploadSingle,
  uploadUserDocuments,
  uploadMultiple,
};
