const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Investment = require("../models/Investment");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

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
      user.kycVerifiedAt = null;

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
            throw new Error(
              "Transaction is not a withdrawal"
            );
          }

          throw new Error(
            `Withdrawal is already ${existing.status}`
          );
        }

        withdrawal.status = "completed";

        await withdrawal.save({
          session,
        });

        await Notification.create(
          [
            {
              user: withdrawal.user,
              title: "Withdrawal Approved",
              message:
                `Your withdrawal of ₦${Number(
                  withdrawal.amount
                ).toLocaleString()} has been approved ` +
                "and is being processed for payment.",
              type: "withdrawal",
            },
          ],
          {
            session,
          }
        );

        const wallet = await Wallet.findOne({
          user: withdrawal.user,
        }).session(session);

        responseData = {
          withdrawal,
          walletBalance: wallet
            ? wallet.balance
            : null,
        };
      });

      return res.json({
        message:
          "Withdrawal approved successfully",
        ...responseData,
      });
    } catch (err) {
      console.error(
        "WITHDRAWAL APPROVAL ERROR:",
        err
      );

      if (
        err.message ===
          "Withdrawal not found" ||
        err.message ===
          "Transaction is not a withdrawal" ||
        err.message.startsWith(
          "Withdrawal is already"
        )
      ) {
        return res.status(400).json({
          message: err.message,
        });
      }

      return res.status(500).json({
        message:
          "Failed to approve withdrawal",
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
          const existing =
            await Transaction.findById(
              req.params.id
            ).session(session);

          if (!existing) {
            throw new Error(
              "Withdrawal not found"
            );
          }

          if (
            existing.type !== "withdrawal"
          ) {
            throw new Error(
              "Transaction is not a withdrawal"
            );
          }

          throw new Error(
            `Withdrawal is already ${existing.status}`
          );
        }

        const wallet =
          await Wallet.findOne({
            user: withdrawal.user,
          }).session(session);

        if (!wallet) {
          throw new Error(
            "User wallet not found"
          );
        }

        /*
         * The amount was deducted when the
         * withdrawal was requested.
         *
         * Since the withdrawal is rejected,
         * refund the reserved amount.
         */

        wallet.balance =
          Number(wallet.balance || 0) +
          Number(withdrawal.amount || 0);

        await wallet.save({
          session,
        });

        withdrawal.status = "failed";

        await withdrawal.save({
          session,
        });

        await Notification.create(
          [
            {
              user: withdrawal.user,
              title: "Withdrawal Rejected",
              message:
                `Your withdrawal of ₦${Number(
                  withdrawal.amount
                ).toLocaleString()} was rejected. ` +
                "The amount has been returned to your wallet.",
              type: "withdrawal",
            },
          ],
          {
            session,
          }
        );

        responseData = {
          withdrawal,
          walletBalance:
            wallet.balance,
        };
      });

      return res.json({
        message:
          "Withdrawal rejected successfully",
        ...responseData,
      });
    } catch (err) {
      console.error(
        "WITHDRAWAL REJECTION ERROR:",
        err
      );

      if (
        err.message ===
          "Withdrawal not found" ||
        err.message ===
          "Transaction is not a withdrawal" ||
        err.message ===
          "User wallet not found" ||
        err.message.startsWith(
          "Withdrawal is already"
        )
      ) {
        return res.status(400).json({
          message: err.message,
        });
      }

      return res.status(500).json({
        message:
          "Failed to reject withdrawal",
      });
    } finally {
      await session.endSession();
    }
  }
);

/* ==============================
   GET PENDING INVESTMENTS
============================== */

router.get(
  "/investments/pending",
  protect,
  admin,
  async (req, res) => {
    try {
      const investments = await Investment.find({
        status: "pending",
      })
        .populate(
          "user",
          "name email phone investorId investorTier"
        )
        .populate(
          "transaction",
          "reference amount status description createdAt"
        )
        .sort({ createdAt: -1 });

      return res.json(investments);
    } catch (err) {
      console.error(
        "GET PENDING INVESTMENTS ERROR:",
        err
      );

      return res.status(500).json({
        message: "Failed to fetch pending investments",
      });
    }
  }
);


/* ==============================
   APPROVE INVESTMENT
============================== */

router.put(
  "/investments/:id/approve",
  protect,
  admin,
  async (req, res) => {
    const session = await mongoose.startSession();

    try {
      let responseData;

      await session.withTransaction(async () => {
        const investment = await Investment.findOne({
          _id: req.params.id,
          status: "pending",
        })
          .populate("user", "name email")
          .session(session);

        if (!investment) {
          const existing = await Investment.findById(
            req.params.id
          ).session(session);

          if (!existing) {
            throw new Error("Investment not found");
          }

          throw new Error(
            `Investment is already ${existing.status}`
          );
        }

        if (!investment.transaction) {
              throw new Error(
             "Investment transaction reference is missing"
            );
          }

        const transaction = await Transaction.findOne({
          _id: investment.transaction,
          type: "investment",
        }).session(session);

        if (!transaction) {
          throw new Error(
            "Investment transaction not found"
          );
        }

        if (transaction.status !== "pending") {
          throw new Error(
            `Investment transaction is already ${transaction.status}`
          );
        }

        investment.status = "active";

        await investment.save({
          session,
        });

        transaction.status = "completed";

        await transaction.save({
          session,
        });

        await Notification.create(
          [
            {
              user: investment.user._id,
              title: "Investment Approved",
              message:
                `Your ₦${Number(
                  investment.amount
                ).toLocaleString()} investment ` +
                `in the ${investment.plan} plan has been approved ` +
                "and is now active.",
              type: "investment",
            },
          ],
          {
            session,
          }
        );

        responseData = {
          investment,
          transaction,
        };
      });

      return res.json({
        message: "Investment approved successfully",
        ...responseData,
      });
    } catch (err) {
      console.error(
        "INVESTMENT APPROVAL ERROR:",
        err
      );

      if (
        err.message === "Investment not found" ||
        err.message ===
          "Investment transaction not found" ||
        err.message.startsWith(
          "Investment is already"
        ) ||
        err.message.startsWith(
          "Investment transaction is already"
        )
      ) {
        return res.status(400).json({
          message: err.message,
        });
      }

      return res.status(500).json({
        message: "Failed to approve investment",
      });
    } finally {
      await session.endSession();
    }
  }
);


/* ==============================
   REJECT INVESTMENT
============================== */

router.put(
  "/investments/:id/reject",
  protect,
  admin,
  async (req, res) => {
    const session = await mongoose.startSession();

    try {
      let responseData;

      await session.withTransaction(async () => {
        const investment = await Investment.findOne({
          _id: req.params.id,
          status: "pending",
        }).session(session);

        if (!investment) {
          const existing = await Investment.findById(
            req.params.id
          ).session(session);

          if (!existing) {
            throw new Error("Investment not found");
          }

          throw new Error(
            `Investment is already ${existing.status}`
          );
        }

        const transaction = await Transaction.findOne({
          _id: investment.transaction,
          type: "investment",
        }).session(session);

        if (!transaction) {
          throw new Error(
            "Investment transaction not found"
          );
        }

        if (transaction.status !== "pending") {
          throw new Error(
            `Investment transaction is already ${transaction.status}`
          );
        }

        const wallet = await Wallet.findOne({
          user: investment.user,
        }).session(session);

        if (!wallet) {
          throw new Error("User wallet not found");
        }


        wallet.balance =
          Number(wallet.balance || 0) +
          Number(investment.amount || 0);

        await wallet.save({
          session,
        });

        investment.status = "cancelled";

        await investment.save({
          session,
        });

        transaction.status = "failed";

        await transaction.save({
          session,
        });

        await Notification.create(
          [
            {
              user: investment.user,
              title: "Investment Rejected",
              message:
                `Your ₦${Number(
                  investment.amount
                ).toLocaleString()} investment ` +
                `in the ${investment.plan} plan was rejected. ` +
                "The amount has been returned to your wallet.",
              type: "investment",
            },
          ],
          {
            session,
          }
        );

        responseData = {
          investment,
          transaction,
          walletBalance: wallet.balance,
        };
      });

      return res.json({
        message: "Investment rejected successfully",
        ...responseData,
      });
    } catch (err) {
      console.error(
        "INVESTMENT REJECTION ERROR:",
        err
      );

      if (
        err.message === "Investment not found" ||
        err.message ===
          "Investment transaction not found" ||
        err.message === "User wallet not found" ||
        err.message.startsWith(
          "Investment is already"
        ) ||
        err.message.startsWith(
          "Investment transaction is already"
        )
      ) {
        return res.status(400).json({
          message: err.message,
        });
      }

      return res.status(500).json({
        message: "Failed to reject investment",
      });
    } finally {
      await session.endSession();
    }
  }
);

module.exports = router;

