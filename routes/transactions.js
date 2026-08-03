const express = require("express");
const router = express.Router();

console.log("✅ Transactions route loaded");

const protect = require("../middleware/authMiddleware");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet"); // ✅ NEW IMPORT

/* ==============================
   GET ALL USER TRANSACTIONS
============================== */
router.get("/", protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      user: req.user.id,
    }).sort({ createdAt: -1 });

    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ==============================
   CREATE TRANSACTION (STARTUP FINTECH LOGIC)
============================== */
/* ==============================
   CREATE TRANSACTION (STARTUP FINTECH LOGIC)
============================== */
router.post("/", protect, async (req, res) => {
  console.log("✅ POST /api/transactions reached");

  try {
    const { type, amount, description } = req.body;

    if (!type || !amount) {
      return res.status(400).json({
        message: "Missing fields",
      });
    }

    // ✅ GET OR CREATE WALLET
    let wallet = await Wallet.findOne({ user: req.user.id });

    if (!wallet) {
      wallet = await Wallet.create({
        user: req.user.id,
        balance: 0,
      });
    }

    let newBalance = wallet.balance;

    // 💰 FINTECH RULES
    if (type === "deposit" || type === "profit") {
      newBalance += Number(amount);
    }

    if (type === "withdrawal" || type === "utility") {
        newBalance -= Number(amount);
   }

    // ❌ BLOCK NEGATIVE BALANCE (VERY IMPORTANT FOR INVESTORS)
    if (newBalance < 0) {
      return res.status(400).json({
        message: "Insufficient wallet balance",
      });
    }

    // ✅ SAVE WALLET FIRST
    wallet.balance = newBalance;
    await wallet.save();

    // ✅ SAVE TRANSACTION
    console.log("Creating transaction...");

    const newTransaction = await Transaction.create({
  user: req.user.id,
  type,
  amount,
  description: description || "",
  status: "completed",
  reference:
    "BLM" +
    Date.now() +
    Math.floor(Math.random() * 10000),
});

console.log("Transaction created:", newTransaction);

    res.json({
      transaction: newTransaction,
      walletBalance: wallet.balance,
    });
  } catch (err) {
  console.error("TRANSACTION ERROR:", err);

  res.status(500).json({
    message: err.message,
  });
}
});

/* ==============================
   DELETE TRANSACTION
============================== */
router.delete("/:id", protect, async (req, res) => {
  try {
    const tx = await Transaction.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!tx) {
      return res.status(404).json({ message: "Not found" });
    }

    await tx.deleteOne();

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Delete error" });
  }
});

/* ==============================
   SEED (DEV ONLY)
============================== */
router.post("/seed", protect, async (req, res) => {
  try {
    const sample = await Transaction.insertMany([
      {
        user: req.user.id,
        type: "deposit",
        amount: 500,
        description: "Seed deposit",
        status: "completed",
      },
      {
        user: req.user.id,
        type: "withdrawal",
        amount: 200,
        description: "Seed withdrawal",
        status: "completed",
      },
      {
        user: req.user.id,
        type: "profit",
        amount: 120,
        description: "Seed profit",
        status: "completed",
      },
    ]);

    res.json({
      message: "Seeded successfully",
      data: sample,
    });
  } catch (err) {
    res.status(500).json({ message: "Seed error" });
  }
});

module.exports = router;