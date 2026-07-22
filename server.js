const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();

/* ---------------- CORS ---------------- */

const allowedOrigins = [
  "http://localhost:3000",
  "https://bloomvest-frontend-ten.vercel.app",
  "https://bloomvest-frontend-9tgp19mni-kelvin-akunwas-projects.vercel.app",
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow Postman/server-to-server requests
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ---------------- MIDDLEWARE ---------------- */

app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));

/* ---------------- RATE LIMIT ---------------- */

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use(limiter);

/* ---------------- ROUTES ---------------- */

const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const investmentRoutes = require("./routes/investment");
const walletRoutes = require("./routes/wallet");

app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/investments", investmentRoutes);
app.use("/api/wallet", walletRoutes);

/* ---------------- HEALTH ---------------- */

app.get("/", (req, res) => {
  res.send("🚀 Bloomvest API is running...");
});

app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working perfectly 🚀",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "bloomvest-backend",
    time: new Date().toISOString(),
  });
});

/* ---------------- ERROR HANDLER ---------------- */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    message: err.message || "Internal Server Error",
  });
});

/* ---------------- DATABASE ---------------- */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/* ---------------- START SERVER ---------------- */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});