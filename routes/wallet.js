const router = require("express").Router();
const protect = require("../middleware/authMiddleware");
const Wallet = require("../models/Wallet");

// ==============================
// GET WALLET
// ==============================

router.get("/", protect, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({
      user: req.user.id,
    });

    return res.json(wallet || { balance: 0 });
  } catch (err) {
    console.error("GET WALLET ERROR:", err);

    return res.status(500).json({
      message: "Failed to fetch wallet",
    });
  }
});

module.exports = router;