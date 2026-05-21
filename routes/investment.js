const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const Investment = require("../models/Investment");

// CREATE INVESTMENT
router.post("/", protect, async (req, res) => {
  try {
    const { amount, plan } = req.body;

    const investment = await Investment.create({
      user: req.user.id,
      amount,
      plan,
    });

    res.json(investment);
  } catch (err) {
    res.status(500).json({ message: "Investment error" });
  }
});

// GET USER INVESTMENTS
router.get("/", protect, async (req, res) => {
  try {
    const investments = await Investment.find({
      user: req.user.id,
    });

    res.json(investments);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;