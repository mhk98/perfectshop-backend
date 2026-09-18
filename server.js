require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const db = require("./models"); // Sequelize instance
const routes = require("./app/routes");
const ApiError = require("./error/ApiError");
const userLogHistory = require("./app/middlewares/userLogHistory");
const { initializeChatSocket } = require("./app/realtime/socket");

const app = express();
const server = http.createServer(app);
initializeChatSocket(server);

const requiredEnvVars = ["TOKEN_SECRET", "REFRESH_SECRET"];
const missingEnvVars = requiredEnvVars.filter(
  (key) => !String(process.env[key] || "").trim(),
);
if (missingEnvVars.length) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`,
  );
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

/* ========================
   SECURITY HEADERS
======================== */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow /images to be served cross-origin
  }),
);

/* ========================
   CORS
======================== */

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "https://apireact.digitalever.com.bd",
  "https://adminreact.digitalever.com.bd",
];

const ALLOWED_ORIGINS = new Set(
  `${DEFAULT_ALLOWED_ORIGINS.join(",")},${process.env.ALLOWED_ORIGINS || ""}`
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

const isLocalDevOrigin = (origin = "") =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);

const corsOptions = {
  origin: (origin, callback) => {
    // allow requests with no origin (e.g. mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/+$/, "");
    if (
      ALLOWED_ORIGINS.has(normalizedOrigin) ||
      isLocalDevOrigin(normalizedOrigin)
    )
      return callback(null, normalizedOrigin);

    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ========================
   RATE LIMITING
======================== */

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many attempts. Try again in 15 minutes.",
  },
  skipSuccessfulRequests: true,
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many requests. Slow down." },
});

app.use("/api/v1/user/login", authLimiter);
app.use("/api/v1/user/refresh-token", authLimiter);
app.use("/api/v1/user/register", authLimiter);
app.use("/api/v1", apiLimiter);

/* ========================
   MIDDLEWARE
======================== */

const captureRawBodyForWebhooks = (req, res, buffer) => {
  const webhookPath = req.originalUrl?.split("?")[0]?.replace(/\/+$/, "");
  if (
    webhookPath === "/api/v1/integrations/woocommerce/orders" ||
    webhookPath === "/api/v1/integrations/woocommerce/products"
  ) {
    req.rawBody = Buffer.from(buffer);
  }
};

app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.json({ limit: "25mb", verify: captureRawBodyForWebhooks }));
app.use(cookieParser());
app.use(userLogHistory);

/* ========================
   STATIC FILES
======================== */

app.use("/images", express.static("images"));

/* ========================
   SWAGGER DOCS
======================== */

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Holy Deen Backend API",
      version: "1.0.0",
      description: "API documentation for Holy Deen Backend",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./app/modules/**/*.routes.js"],
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { explorer: true }),
);
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

/* ========================
   ROUTES
======================== */

// Health check route (important for monitoring)
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "API server is running",
  });
});

app.get("/api/v1/health", async (req, res, next) => {
  try {
    await db.sequelize.query("SELECT 1");
    res.status(200).json({
      status: "success",
      message: "API and database are reachable",
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/v1", routes);

/* ========================
   404 HANDLER
======================== */

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "API not found",
  });
});

/* ========================
   GLOBAL ERROR HANDLER
======================== */

app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === "development";

  // Only log full error in development; production logs minimal info
  if (isDev) {
    console.error("Global Error:", err);
  } else {
    console.error(`[${new Date().toISOString()}] ${err.message}`);
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: "error",
      message: err.message,
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      status: "error",
      message:
        'Invalid JSON body. Wrap phone numbers in quotes, e.g. "Phone": "01518301098".',
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.name === "MulterError") {
    return res.status(400).json({
      status: "error",
      message: err.message || "File upload failed",
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.message?.startsWith("Invalid file format")) {
    return res.status(400).json({
      status: "error",
      message: err.message,
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.code === "ENOENT") {
    return res.status(500).json({
      status: "error",
      message: "Upload folder is missing or not writable.",
      ...(isDev && { stack: err.stack }),
    });
  }

  return res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
});

/* ========================
   SERVER START FUNCTION
======================== */

const startServer = async () => {
  try {
    // Authenticate DB connection
    await db.sequelize.authenticate();
    await db.ready;
    console.log("✅ Database connected successfully");

    // Sync models (optional in production)
    // await db.sequelize.sync();

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to connect to database:", error.message);
    if (error.original?.code === "ER_USER_LIMIT_REACHED") {
      console.error(
        "⚠️  DB connection limit exceeded. ১ ঘণ্টা পর আবার চেষ্টা করুন অথবা hosting panel থেকে connection reset করুন।",
      );
    }
    process.exit(1);
  }
};

startServer();

/* ========================
   GRACEFUL SHUTDOWN
======================== */

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  await db.sequelize.close();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Shutting down gracefully...");
  await db.sequelize.close();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
