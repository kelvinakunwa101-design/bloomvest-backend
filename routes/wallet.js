const router = require("express").Router();
const protect = require("../middleware/authMiddleware");
const Wallet = require("../models/Wallet");

router.get("/", protect, async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });

  res.json(wallet || { balance: 0 });
});

module.exports = router;