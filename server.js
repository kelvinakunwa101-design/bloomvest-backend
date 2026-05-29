const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();

/* ---------------- SECURITY MIDDLEWARE ---------------- */
app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://bloomvest-frontend-ten.vercel.app",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// IMPORTANT: handle preflight requests //

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

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
  res.send("🚀 Bloomvest API is running...");
});

app.get("/api/test", (req, res) => {
  res.json({ message: "API is working perfectly 🚀" });
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
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    message: "Server Error",
    error: err.message,
  });
});

/* ---------------- DATABASE ---------------- */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => {
    console.log("MongoDB connection error:", err);
    process.exit(1);
  });

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
});