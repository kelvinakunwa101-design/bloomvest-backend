const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const Transaction = require("../models/Transaction");

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
   CREATE TRANSACTION (REAL FINTECH FEATURE)
============================== */
router.post("/", protect, async (req, res) => {
  try {
    const { type, amount, description } = req.body;

    if (!type || !amount) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const newTransaction = await Transaction.create({
      user: req.user.id,
      type,
      amount,
      description: description || "",
      status: "completed",
    });

    res.json(newTransaction);
  } catch (err) {
    res.status(500).json({ message: "Create error" });
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
   SEED 
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