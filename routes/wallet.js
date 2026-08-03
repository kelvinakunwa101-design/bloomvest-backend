const router = require("express").Router();
const protect = require("../middleware/authMiddleware");
const Wallet = require("../models/Wallet");

router.get("/", protect, async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });

  res.json(wallet || { balance: 0 });
});

// DEPOSIT INTO WALLET
router.post("/deposit", protect, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Enter a valid amount",
      });
    }

    let wallet = await Wallet.findOne({
      user: req.user.id,
    });

    if (!wallet) {
      wallet = new Wallet({
        user: req.user.id,
        balance: 0,
      });
    }

    wallet.balance += Number(amount);

    await wallet.save();

    res.json({
      message: "Deposit successful",
      wallet,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

// WITHDRAW FROM WALLET
router.post("/withdraw", protect, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Enter a valid amount",
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

    if (wallet.balance < amount) {
      return res.status(400).json({
        message: "Insufficient wallet balance",
      });
    }

    wallet.balance -= Number(amount);

    await wallet.save();

    res.json({
      message: "Withdrawal successful",
      wallet,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;