const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();



const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = [
  "http://localhost:3000",
  "https://bloomvest-frontend-ten.vercel.app",
  "https://bloomvest-frontend-9tgp19mni-kelvin-akunwas-projects.vercel.app",
];



app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);



app.use(
  cors({
    origin(origin, callback) {
      
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("Origin not allowed by CORS")
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);


app.use(
  express.json({
    limit: "1mb",
  })
);


app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  })
);


if (isProduction) {
  app.use(morgan("combined"));
} else {
  app.use(morgan("dev"));
}


app.use(
  "/uploads/avatars",
  express.static(
    path.join(__dirname, "uploads", "avatars"),
    {
      dotfiles: "deny",
      index: false,
    }
  )
);


const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: isProduction ? 300 : 1000,

  message: {
    message:
      "Too many requests. Please try again later.",
  },

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => {
    return (
      req.path === "/health" ||
      req.path === "/test"
    );
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: isProduction ? 10 : 50,

  message: {
    message:
      "Too many authentication attempts. Please try again later.",
  },

  standardHeaders: true,
  legacyHeaders: false,

  skipSuccessfulRequests: false,
});


const twoFactorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,

  max: isProduction ? 10 : 50,

  message: {
    message:
      "Too many two-factor verification attempts. Please try again later.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);


const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const investmentRoutes = require("./routes/investment");
const investmentPlanRoutes = require("./routes/investmentPlanRoutes");
const walletRoutes = require("./routes/wallet");
const analyticsRoutes = require("./routes/analyticsRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminRoutes = require("./routes/adminRoutes");

const processMaturedInvestments = require(
  "./services/processMaturedInvestments"
);


app.use(
  "/api/auth/login",
  authLimiter
);

app.use(
  "/api/auth/2fa/verify",
  twoFactorLimiter
);

app.use(
  "/api/auth",
  authRoutes
);


app.use(
  "/api/admin",
  adminRoutes
);

app.use(
  "/api/notifications",
  notificationRoutes
);

app.use(
  "/api/analytics",
  analyticsRoutes
);

app.use(
  "/api/users",
  userRoutes
);

app.use(
  "/api/transactions",
  transactionRoutes
);

app.use(
  "/api/investments",
  investmentRoutes
);

app.use(
  "/api/investments/plans",
  investmentPlanRoutes
);

app.use(
  "/api/wallet",
  walletRoutes
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "BloomVest API is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "bloomvest-backend",
    time: new Date().toISOString(),
  });
});


app.use((req, res) => {
  return res.status(404).json({
    message: "API endpoint not found",
  });
});

app.use((err, req, res, next) => {
  console.error(
    `${req.method} ${req.originalUrl}`,
    err.message
  );

  if (
    err.message ===
    "Origin not allowed by CORS"
  ) {
    return res.status(403).json({
      message: "Origin not allowed",
    });
  }

  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({
      message: "Invalid JSON request",
    });
  }

  return res.status(500).json({
    message: isProduction
      ? "Internal server error"
      : err.message || "Internal server error",
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");

    const runInvestmentProcessor = async () => {
      try {
        const processed =
          await processMaturedInvestments();

        if (processed > 0) {
          console.log(
            `Processed ${processed} matured investment(s)`
          );
        }
      } catch (err) {
        console.error(
          "Investment processor error:",
          err
        );
      }
    };

    runInvestmentProcessor();

    setInterval(
      runInvestmentProcessor,
      60000
    );
  })
  .catch((err) => {
    console.error(
      "MongoDB connection error:",
      err
    );

    process.exit(1);
  });

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `🚀 Server running on port ${PORT}`
  );
});

