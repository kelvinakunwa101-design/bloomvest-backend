const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const Investment = require("../models/Investment");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");

// CREATE INVESTMENT
router.post("/", protect, async (req, res) => {
  try {
    const { amount, plan } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        message: "Invalid investment amount",
      });
    }

    const wallet = await Wallet.findOne({
      user: req.user.id,
    });

    if (!wallet) {
      return res.status(404).json({
        message: "Wallet not found",
      });
    }

    if (wallet.balance < Number(amount)) {
      return res.status(400).json({
        message: "Insufficient wallet balance",
      });
    }

    wallet.balance -= Number(amount);
    await wallet.save();

    const investment = await Investment.create({
      user: req.user.id,
      amount,
      plan,
    });

    await Transaction.create({
      user: req.user.id,
      type: "investment",
      amount,
      description: `${plan} Investment`,
      status: "completed",
    });

    res.json({
      investment,
      walletBalance: wallet.balance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Investment error",
    });
  }
});

// GET USER INVESTMENTS
router.get("/", protect, async (req, res) => {
  try {
    const investments = await Investment.find({
      user: req.user.id,
    }).sort({ createdAt: -1 });

    const now = new Date();

    for (const investment of investments) {
      if (
  investment.status === "active" &&
  investment.maturityDate &&
  investment.maturityDate <= now
) {
  investment.status = "completed";

  await investment.save();

  const wallet = await Wallet.findOne({
    user: req.user.id,
  });

  if (wallet) {
    wallet.balance += investment.currentValue;

    await wallet.save();

    await Transaction.create({
      user: req.user.id,
      type: "profit",
      amount: investment.expectedProfit,
      description: `${investment.plan} matured`,
      status: "completed",
    });
  }
}
}
    res.json(investments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;