const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Investment = require("../models/Investment");
const Transaction = require("../models/Transaction");

const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const admin = require("../middleware/adminMiddleware");


/* ==============================
   ADMIN DASHBOARD
============================== */

router.get("/dashboard", protect, admin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();

    const totalWallets = await Wallet.countDocuments();

    const totalInvestments = await Investment.countDocuments();

    const totalTransactions = await Transaction.countDocuments();

    const pendingKyc = await User.countDocuments({
      kycStatus: "Pending",
    });

    const pendingWithdrawals = await Transaction.countDocuments({
      type: "withdrawal",
      status: "pending",
    });

    const walletBalances = await Wallet.find();

    const totalBalance = walletBalances.reduce(
      (sum, wallet) => sum + wallet.balance,
      0
    );

    const recentUsers = await User.find()
      .select(
        "name email investorTier kycStatus createdAt"
      )
      .sort({ createdAt: -1 })
      .limit(5);

    const recentTransactions = await Transaction.find()
      .populate("user", "name")
      .sort({ createdAt: -1 })
      .limit(5);

    const pendingKycUsers = await User.find({
      kycStatus: "Pending",
    })
      .select(
        "name email investorTier createdAt"
      )
      .limit(5);

    res.json({
      admin: req.user.name,

      stats: {
        totalUsers,
        totalWallets,
        totalInvestments,
        totalTransactions,
        pendingKyc,
        pendingWithdrawals,
        totalBalance,
      },

      recentUsers,

      recentTransactions,

      pendingKycUsers,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Dashboard error",
    });
  }
});


/* ==============================
   GET ALL USERS
============================== */

router.get("/users", protect, admin, async (req, res) => {
  try {
    const users = await User.find()
      .select(
  "name email phone role investorTier kycStatus balance accountNumber investorId kycDocumentType kycDocumentNumber kycDocumentFront kycDocumentBack kycSubmittedAt kycVerifiedAt createdAt"
)
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});


/* ==============================
   APPROVE KYC
============================== */

router.put(
  "/users/:id/kyc/approve",
  protect,
  admin,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

         user.kycStatus = "Approved";
         user.kycVerifiedAt = new Date();

           await user.save();

      res.json({
        message: "KYC approved successfully",

        user: {
          id: user._id,
          name: user.name,
          kycStatus: user.kycStatus,
        },
      });
    } catch (err) {
      console.error("KYC APPROVAL ERROR:", err);

      res.status(500).json({
        message: "Failed to approve KYC",
      });
    }
  }
);


/* ==============================
   REJECT KYC
============================== */

router.put(
  "/users/:id/kyc/reject",
  protect,
  admin,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      user.kycStatus = "Rejected";
      user.kycVerifiedAt = new Date();

       await user.save();

      res.json({
        message: "KYC rejected successfully",

        user: {
          id: user._id,
          name: user.name,
          kycStatus: user.kycStatus,
        },
      });
    } catch (err) {
      console.error("KYC REJECTION ERROR:", err);

      res.status(500).json({
        message: "Failed to reject KYC",
      });
    }
  }
);

/* ==============================
GET PENDING WITHDRAWALS
============================== */

router.get(
  "/withdrawals/pending",
  protect,
  admin,
  async (req, res) => {
    try {
      const withdrawals = await Transaction.find({
        type: "withdrawal",
        status: "pending",
      })
        .populate(
          "user",
          "name email phone accountNumber investorId"
        )
        .sort({ createdAt: -1 });

      res.json(withdrawals);
    } catch (err) {
      console.error("GET PENDING WITHDRAWALS ERROR:", err);

      res.status(500).json({
        message: "Failed to fetch pending withdrawals",
      });
    }
  }
);
/* ==============================
APPROVE WITHDRAWAL
============================== */

router.put(
  "/withdrawals/:id/approve",
  protect,
  admin,
  async (req, res) => {
    const session = await mongoose.startSession();

    try {
      let responseData;

      await session.withTransaction(async () => {
        const withdrawal = await Transaction.findOne({
          _id: req.params.id,
          type: "withdrawal",
          status: "pending",
        }).session(session);

        if (!withdrawal) {
          const existing = await Transaction.findById(
            req.params.id
          ).session(session);

          if (!existing) {
            throw new Error("Withdrawal not found");
          }

          if (existing.type !== "withdrawal") {
            throw new Error("Transaction is not a withdrawal");
          }

          throw new Error(
            `Withdrawal is already ${existing.status}`
          );
        }

        const wallet = await Wallet.findOne({
          user: withdrawal.user,
        }).session(session);

        if (!wallet) {
          throw new Error("User wallet not found");
        }

        const withdrawalAmount = Number(
          withdrawal.amount || 0
        );

        if (wallet.balance < withdrawalAmount) {
          throw new Error(
            "Insufficient wallet balance for withdrawal approval"
          );
        }

        wallet.balance -= withdrawalAmount;

        await wallet.save({
          session,
        });

        withdrawal.status = "completed";

        await withdrawal.save({
          session,
        });

        responseData = {
          withdrawal,
          walletBalance: wallet.balance,
        };
      });

      return res.json({
        message: "Withdrawal approved successfully",
        ...responseData,
      });
    } catch (err) {
      console.error(
        "WITHDRAWAL APPROVAL ERROR:",
        err
      );

      if (
        err.message === "Withdrawal not found" ||
        err.message === "Transaction is not a withdrawal" ||
        err.message === "User wallet not found" ||
        err.message.startsWith("Withdrawal is already") ||
        err.message ===
          "Insufficient wallet balance for withdrawal approval"
      ) {
        return res.status(400).json({
          message: err.message,
        });
      }

      return res.status(500).json({
        message: "Failed to approve withdrawal",
      });
    } finally {
      await session.endSession();
    }
  }
);

/* ==============================
REJECT WITHDRAWAL
============================== */

router.put(
  "/withdrawals/:id/reject",
  protect,
  admin,
  async (req, res) => {
    try {
      const withdrawal = await Transaction.findOneAndUpdate(
        {
          _id: req.params.id,
          type: "withdrawal",
          status: "pending",
        },
        {
          $set: {
            status: "failed",
          },
        },
        {
          new: true,
        }
      );

      if (!withdrawal) {
        const existing = await Transaction.findById(
          req.params.id
        );

        if (!existing) {
          return res.status(404).json({
            message: "Withdrawal not found",
          });
        }

        if (existing.type !== "withdrawal") {
          return res.status(400).json({
            message: "Transaction is not a withdrawal",
          });
        }

        return res.status(400).json({
          message: `Withdrawal is already ${existing.status}`,
        });
      }

      return res.json({
        message: "Withdrawal rejected successfully",
        withdrawal,
      });
    } catch (err) {
      console.error(
        "WITHDRAWAL REJECTION ERROR:",
        err
      );

      return res.status(500).json({
        message: "Failed to reject withdrawal",
      });
    }
  }
);

module.exports = router;

