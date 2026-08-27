const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const admin = require("../middleware/adminMiddleware");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");
const Notification = require("../models/Notification");

const USER_TRANSACTION_TYPES = [
  "deposit",
  "withdrawal",
  "utility",
];

router.get("/", protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      user: req.user.id,
    }).sort({ createdAt: -1 });

    return res.json(transactions);
  } catch (err) {
    console.error("GET TRANSACTIONS ERROR:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

router.get("/admin/all", protect, admin, async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 });

    return res.json(transactions);
  } catch (err) {
    console.error("GET ADMIN TRANSACTIONS ERROR:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

router.get("/admin/:id", protect, admin, async (req, res) => {
  try {
    const transaction = await Transaction.findById(
      req.params.id
    ).populate("user", "name email role");

    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    return res.json(transaction);
  } catch (err) {
    console.error(
      "GET ADMIN TRANSACTION BY ID ERROR:",
      err
    );

    if (err instanceof mongoose.Error.CastError) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    return res.status(500).json({
      message: "Server error",
    });
  }
});

router.get("/:id", protect, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    return res.json(transaction);
  } catch (err) {
    console.error("GET TRANSACTION BY ID ERROR:", err);

    if (err instanceof mongoose.Error.CastError) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    return res.status(500).json({
      message: "Server error",
    });
  }
});


router.post("/", protect, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      type,
      amount,
      description,
      bank,
      accountNumber,
      accountName,
    } = req.body;

    const transactionAmount = Number(amount);

    if (!type) {
      return res.status(400).json({
        message: "Transaction type is required",
      });
    }

    if (!USER_TRANSACTION_TYPES.includes(type)) {
      return res.status(400).json({
        message:
          "Invalid transaction type. Investments and profits are handled separately.",
      });
    }

    if (
      !Number.isFinite(transactionAmount) ||
      transactionAmount <= 0
    ) {
      return res.status(400).json({
        message: "Enter a valid transaction amount",
      });
    }

    let responseData;

    await session.withTransaction(async () => {
      let wallet = await Wallet.findOne({
        user: req.user.id,
      }).session(session);

      if (!wallet) {
        wallet = new Wallet({
          user: req.user.id,
          balance: 0,
        });
      }

      let newBalance = Number(wallet.balance || 0);

      if (type === "deposit") {
        newBalance += transactionAmount;
      }

      if (type === "utility") {
       newBalance -= transactionAmount;
     }

          if (type === "withdrawal") {
          if (newBalance < transactionAmount) {
    throw new Error("Insufficient wallet balance");
     }

       newBalance -= transactionAmount;
     }

      if (newBalance < 0) {
        throw new Error("Insufficient wallet balance");
      }

      wallet.balance = newBalance;

      await wallet.save({
        session,
      });

      const transactions = await Transaction.create(
        [
          {
            user: req.user.id,
            type,
            amount: transactionAmount,
            description: description || "",
            bank: bank || "",
            accountNumber: accountNumber || "",
            accountName: accountName || "",
            status:
              type === "withdrawal"
                ? "pending"
                : "completed",
            reference:
              "BLM" +
              Date.now() +
              Math.floor(Math.random() * 10000),
          },
        ],
        {
          session,
        }
      );

      const newTransaction = transactions[0];

      let notificationTitle = "";
      let notificationMessage = "";

      if (type === "deposit") {
        notificationTitle = "Deposit Successful";
        notificationMessage =
          `₦${transactionAmount.toLocaleString()} ` +
          "has been credited to your wallet.";
      }

      if (type === "withdrawal") {
        notificationTitle = "Withdrawal Initiated";
        notificationMessage =
          `Your withdrawal of ₦${transactionAmount.toLocaleString()} ` +
          "is being processed.";
      }

      if (type === "utility") {
        notificationTitle = "Utility Payment";
        notificationMessage =
          `Your payment of ₦${transactionAmount.toLocaleString()} ` +
          "was successful.";
      }

      if (notificationTitle) {
        await Notification.create(
          [
            {
              user: req.user.id,
              title: notificationTitle,
              message: notificationMessage,
              type,
            },
          ],
          {
            session,
          }
        );
      }

      responseData = {
        transaction: newTransaction,
        walletBalance: wallet.balance,
      };
    });

    return res.status(201).json({
      message: "Transaction created successfully",
      ...responseData,
    });
  } catch (err) {
    console.error("TRANSACTION ERROR:", err);

    if (err.message === "Insufficient wallet balance") {
      return res.status(400).json({
        message: err.message,
      });
    }

    return res.status(500).json({
      message: err.message || "Server error",
    });
  } finally {
    await session.endSession();
  }
});

router.delete("/:id", protect, async (req, res) => {
  return res.status(403).json({
    message: "Financial transactions cannot be deleted.",
  });
});

module.exports = router;

