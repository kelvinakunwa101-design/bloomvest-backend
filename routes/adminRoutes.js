const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Investment = require("../models/Investment");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const { createTransfer } = require("../services/flutterwaveService");

const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const admin = require("../middleware/adminMiddleware");

/* ==========================================================================
   ADMIN DASHBOARD METRICS
   ========================================================================== */
router.get("/dashboard", protect, admin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalWallets = await Wallet.countDocuments();
    const totalInvestments = await Investment.countDocuments();
    const totalTransactions = await Transaction.countDocuments();

    const pendingKyc = await User.countDocuments({ kycStatus: "Pending" });
    const pendingWithdrawals = await Transaction.countDocuments({
      type: "withdrawal",
      status: "pending",
    });

    const walletBalances = await Wallet.find();
    const totalBalance = walletBalances.reduce((sum, wallet) => sum + wallet.balance, 0);

    const recentUsers = await User.find()
      .select("name email investorTier kycStatus createdAt")
      .sort({ createdAt: -1 })
      .limit(5);

    const recentTransactions = await Transaction.find()
      .populate("user", "name")
      .sort({ createdAt: -1 })
      .limit(5);

    const pendingKycUsers = await User.find({ kycStatus: "Pending" })
      .select("name email investorTier createdAt")
      .limit(5);

    return res.json({
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
    console.error("DASHBOARD ERROR:", err);
    return res.status(500).json({ message: "Dashboard error" });
  }
});

/* ==========================================================================
   GET ALL USERS
   ========================================================================== */
router.get("/users", protect, admin, async (req, res) => {
  try {
    const users = await User.find()
      .select("name email phone role investorTier kycStatus balance accountNumber investorId kycDocumentType kycDocumentNumber kycDocumentFront kycDocumentBack kycSubmittedAt kycVerifiedAt createdAt")
      .sort({ createdAt: -1 });
    return res.json(users);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ==========================================================================
   APPROVE USER KYC
   ========================================================================== */
router.put("/users/:id/kyc/approve", protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.kycStatus = "Approved";
    user.kycVerifiedAt = new Date();
    await user.save();

    return res.json({
      message: "KYC approved successfully",
      user: { id: user._id, name: user.name, kycStatus: user.kycStatus },
    });
  } catch (err) {
    console.error("KYC APPROVAL ERROR:", err);
    return res.status(500).json({ message: "Failed to approve KYC" });
  }
});

/* ==========================================================================
   REJECT USER KYC
   ========================================================================== */
router.put("/users/:id/kyc/reject", protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.kycStatus = "Rejected";
    user.kycVerifiedAt = null;
    await user.save();

    return res.json({
      message: "KYC rejected successfully",
      user: { id: user._id, name: user.name, kycStatus: user.kycStatus },
    });
  } catch (err) {
    console.error("KYC REJECTION ERROR:", err);
    return res.status(500).json({ message: "Failed to reject KYC" });
  }
});

/* ==========================================================================
   GET PENDING WITHDRAWALS
   ========================================================================== */
router.get("/withdrawals/pending", protect, admin, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({
      type: "withdrawal",
      status: "pending",
      $or: [
        { providerStatus: "awaiting_admin_approval" },
        { providerStatus: { $exists: false } },
        { providerStatus: null },
        { providerStatus: "" },
      ],
    })
      .populate("user", "name email phone accountNumber investorId")
      .sort({ createdAt: -1 });

    return res.json(withdrawals);
  } catch (err) {
    console.error("GET PENDING WITHDRAWALS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch pending withdrawals" });
  }
});

/* ==========================================================================
   APPROVE WITHDRAWAL ROUTE (WITH MONGODB ATOMIC TRANSACTIONS)
   ========================================================================== */
/* ==========================================================================
   APPROVE WITHDRAWAL
   ========================================================================== */

router.put(
  "/withdrawals/:id/approve",
  protect,
  admin,
  async (req, res) => {
    let session;

    try {
      /* --------------------------------------------------------------------
         1. Find the pending withdrawal
         -------------------------------------------------------------------- */

      session = await mongoose.startSession();
      session.startTransaction();

      const withdrawal = await Transaction.findOne({
        _id: req.params.id,
        type: "withdrawal",
        status: "pending",
      }).session(session);

      if (!withdrawal) {
        await session.abortTransaction();
        await session.endSession();
        session = null;

        const existing = await Transaction.findById(req.params.id);

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

      /* --------------------------------------------------------------------
         2. Validate Flutterwave payout information
         -------------------------------------------------------------------- */

      if (!withdrawal.accountNumber) {
        await session.abortTransaction();
        await session.endSession();
        session = null;

        return res.status(400).json({
          message: "Withdrawal account number is missing.",
        });
      }

      if (!withdrawal.bankCode) {
        await session.abortTransaction();
        await session.endSession();
        session = null;

        return res.status(400).json({
          message: "Withdrawal bank code is missing.",
        });
      }

      /* --------------------------------------------------------------------
         3. Mark approval as being processed.
            Do NOT deduct wallet again.
            The amount was already reserved when withdrawal was requested.
         -------------------------------------------------------------------- */

      withdrawal.providerStatus = "approval_in_progress";

      await withdrawal.save({
        session,
      });

      await session.commitTransaction();
      await session.endSession();
      session = null;

      /* --------------------------------------------------------------------
         4. Send payout to Flutterwave
         -------------------------------------------------------------------- */

      let providerResponse;

      try {
        providerResponse = await createTransfer({
          amount: Number(withdrawal.amount),
          accountNumber: withdrawal.accountNumber,
          bankCode: withdrawal.bankCode,
          narration:
            withdrawal.description ||
            `BloomVest withdrawal to ${withdrawal.accountName}`,
          reference: withdrawal.reference,
        });
      } catch (providerError) {
        console.error(
          "FLUTTERWAVE PAYOUT API FAULT:",
          providerError
        );

        await Transaction.findByIdAndUpdate(
          withdrawal._id,
          {
            status: "pending",
            providerStatus: "awaiting_admin_approval",
          }
        );

        return res.status(502).json({
          success: false,
          status: "pending",
          reference: withdrawal.reference,
          message:
            providerError?.message ||
            "Flutterwave API failure. The payout remains pending.",
        });
      }

      /* --------------------------------------------------------------------
         5. Parse Flutterwave response
         -------------------------------------------------------------------- */

      const providerData = providerResponse?.data || {};

      const providerStatus = String(
        providerData.status ||
          providerResponse?.status ||
          "NEW"
      ).toUpperCase();

      const providerReference = String(
        providerData.id ||
          providerData.reference ||
          ""
      );

      /* --------------------------------------------------------------------
         6. Flutterwave SUCCESS
         -------------------------------------------------------------------- */

      if (providerStatus === "SUCCESSFUL") {
        const completedWithdrawal =
          await Transaction.findByIdAndUpdate(
            withdrawal._id,
            {
              status: "completed",
              providerReference,
              providerStatus,
              providerResponseCode: String(
                providerResponse?.status || ""
              ),
            },
            {
              new: true,
            }
          );

        await Notification.create({
          user: withdrawal.user,
          title: "Withdrawal Successful",
          message:
            `Your withdrawal request of NGN ${Number(
              withdrawal.amount
            ).toLocaleString()} was processed successfully.`,
          type: "withdrawal",
        });

        const wallet = await Wallet.findOne({
          user: withdrawal.user,
        });

        return res.status(200).json({
          success: true,
          status: "completed",
          reference: withdrawal.reference,
          providerReference,
          walletBalance: Number(
            wallet?.balance || 0
          ),
          message:
            "Withdrawal completed successfully.",
          data: completedWithdrawal,
        });
      }

      /* --------------------------------------------------------------------
         7. Flutterwave FAILED / CANCELLED
         -------------------------------------------------------------------- */

      if (
        providerStatus === "FAILED" ||
        providerStatus === "CANCELLED"
      ) {
        const refundSession =
          await mongoose.startSession();

        try {
          refundSession.startTransaction();

          const activeWithdrawal =
            await Transaction.findById(
              withdrawal._id
            ).session(refundSession);

          if (!activeWithdrawal) {
            throw new Error(
              "Withdrawal record no longer exists."
            );
          }

          const wallet = await Wallet.findOne({
            user: activeWithdrawal.user,
          }).session(refundSession);

          if (!wallet) {
            throw new Error(
              "User wallet not found."
            );
          }

          /* Refund the amount that was reserved earlier. */
          wallet.balance =
            Number(wallet.balance || 0) +
            Number(activeWithdrawal.amount || 0);

          activeWithdrawal.status = "failed";
          activeWithdrawal.providerReference =
            providerReference;
          activeWithdrawal.providerStatus =
            providerStatus;
          activeWithdrawal.providerResponseCode =
            String(
              providerResponse?.status || ""
            );
          activeWithdrawal.refunded = true;

          await wallet.save({
            session: refundSession,
          });

          await activeWithdrawal.save({
            session: refundSession,
          });

          await Notification.create(
            [
              {
                user: activeWithdrawal.user,
                title: "Withdrawal Failed",
                message:
                  `Your withdrawal request of NGN ${Number(
                    activeWithdrawal.amount
                  ).toLocaleString()} failed during processing. ` +
                  "The amount has been returned to your wallet.",
                type: "withdrawal",
              },
            ],
            {
              session: refundSession,
            }
          );

          await refundSession.commitTransaction();

          return res.status(400).json({
            success: false,
            status: "failed",
            reference: withdrawal.reference,
            providerReference,
            walletBalance: wallet.balance,
            message:
              "Withdrawal failed. Your wallet has been refunded.",
          });
        } catch (refundError) {
          if (refundSession.inTransaction()) {
            await refundSession.abortTransaction();
          }

          throw refundError;
        } finally {
          await refundSession.endSession();
        }
      }

      /* --------------------------------------------------------------------
         8. Flutterwave NEW / PENDING / PROCESSING
         -------------------------------------------------------------------- */

      const processingWithdrawal =
        await Transaction.findByIdAndUpdate(
          withdrawal._id,
          {
            status: "pending",
            providerReference,
            providerStatus: [
              "NEW",
              "PENDING",
              "PROCESSING",
            ].includes(providerStatus)
              ? "processing"
              : providerStatus,
            providerResponseCode: String(
              providerResponse?.status || ""
            ),
          },
          {
            new: true,
          }
        );

      await Notification.create({
        user: withdrawal.user,
        title: "Withdrawal Approved",
        message:
          `Your withdrawal request of NGN ${Number(
            withdrawal.amount
          ).toLocaleString()} has been approved and submitted for processing.`,
        type: "withdrawal",
      });

      return res.status(202).json({
        success: true,
        status: "pending",
        reference: withdrawal.reference,
        providerReference,
        providerStatus:
          processingWithdrawal.providerStatus,
        message:
          "Withdrawal approved and submitted to Flutterwave for processing.",
        data: processingWithdrawal,
      });
    } catch (err) {
      console.error(
        "FATAL ADMIN WITHDRAWAL APPROVAL ERROR:",
        err
      );

      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (rollbackError) {
          console.error(
            "WITHDRAWAL ROLLBACK ERROR:",
            rollbackError
          );
        }

        await session.endSession();
      }

      return res.status(500).json({
        message:
          err.message ||
          "An unexpected processing error occurred on the server.",
      });
    }
  }
);
module.exports = router;
