const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");

const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const {verifyBankAccount,getTransfer,} = require("../services/flutterwaveService");

/* =========================================================
   HELPERS
========================================================= */

const generateReference = () => {
  return (
    `BV-WD-${Date.now()}-` +
    Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase()
  );
};

/* =========================================================
   CREATE REAL WITHDRAWAL
========================================================= */

router.post("/", protect, async (req, res) => {
  const {
    bankCode,
    bank,
    accountNumber,
    accountName,
    amount,
    description,
  } = req.body;

  const withdrawalAmount = Number(amount);

  if (!bankCode) {
    return res.status(400).json({
      message: "Bank is required.",
    });
  }

  if (!bank) {
    return res.status(400).json({
      message: "Bank name is required.",
    });
  }

  if (!/^\d{10}$/.test(accountNumber || "")) {
    return res.status(400).json({
      message:
        "Account number must contain exactly 10 digits.",
    });
  }

  if (!accountName?.trim()) {
    return res.status(400).json({
      message: "Account name is required.",
    });
  }

  if (
    !Number.isFinite(withdrawalAmount) ||
    withdrawalAmount <= 0
  ) {
    return res.status(400).json({
      message:
        "Enter a valid withdrawal amount.",
    });
  }

  const reference =
    generateReference();

  let transactionId = null;

  try {
    /* =====================================================
       1. VERIFY RECIPIENT ACCOUNT WITH FLUTTERWAVE
    ===================================================== */

    const verification =
      await verifyBankAccount({
        accountNumber,
        bankCode,
      });

    const verifiedAccountName =
      verification?.data?.account_name;

    if (
      verification?.status !== "success" ||
      !verifiedAccountName
    ) {
      return res.status(400).json({
        message:
          "Unable to verify withdrawal account.",
      });
    }

    /* =====================================================
       2. RESERVE WALLET + CREATE PENDING TRANSACTION
    ===================================================== */

    const session =
      await mongoose.startSession();

    try {
      await session.withTransaction(
        async () => {
          const wallet =
            await Wallet.findOne({
              user: req.user.id,
            }).session(session);

          if (!wallet) {
            throw new Error(
              "Wallet not found."
            );
          }

          const balance =
            Number(wallet.balance || 0);

          if (
            balance <
            withdrawalAmount
          ) {
            throw new Error(
              "Insufficient wallet balance."
            );
          }

          wallet.balance =
            balance -
            withdrawalAmount;

          await wallet.save({
            session,
          });

          const transactions =
            await Transaction.create(
              [
                {
                  user: req.user.id,
                  type: "withdrawal",
                  amount:
                    withdrawalAmount,
                  description:
                    description?.trim() ||
                    `Withdrawal to ${verifiedAccountName}`,
                  bank,
                  bankCode,
                  accountNumber,
                  accountName:
                    verifiedAccountName,
                  status: "pending",
                  reference,
                },
              ],
              {
                session,
              }
            );

          transactionId =
            transactions[0]._id;
        }
      );
    } finally {
      await session.endSession();
    }

    /* =====================================================
       4. SUCCESS
    ===================================================== */

    if (
      providerStatus ===
        "successful" ||
      providerStatus ===
        "success"
    ) {
      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "completed",
          providerReference,
          providerStatus,
          providerResponseCode:
            String(
              providerResponse?.status ||
                ""
            ),
        }
      );

      await Notification.create({
        user: req.user.id,
        title:
          "Withdrawal Successful",
        message:
          `₦${withdrawalAmount.toLocaleString()} has been sent to ${verifiedAccountName}.`,
        type: "withdrawal",
      });

      const wallet =
        await Wallet.findOne({
          user: req.user.id,
        });

      return res.status(201).json({
        success: true,
        status: "completed",
        reference,
        providerReference,
        walletBalance:
          Number(
            wallet?.balance || 0
          ),
        message:
          "Withdrawal completed successfully.",
      });
    }

    /* =====================================================
       5. DEFINITIVE FAILURE → REFUND
    ===================================================== */

    if (
      providerStatus ===
        "failed" ||
      providerStatus ===
        "cancelled"
    ) {
      const refundSession =
        await mongoose.startSession();

      try {
        await refundSession.withTransaction(
          async () => {
            const wallet =
              await Wallet.findOne({
                user: req.user.id,
              }).session(
                refundSession
              );

            if (!wallet) {
              throw new Error(
                "Wallet not found during refund."
              );
            }

            wallet.balance =
              Number(
                wallet.balance || 0
              ) +
              withdrawalAmount;

            await wallet.save({
              session:
                refundSession,
            });

            await Transaction.findByIdAndUpdate(
              transactionId,
              {
                status: "failed",
                providerReference,
                providerStatus,
                providerResponseCode:
                  String(
                    providerResponse?.status ||
                      ""
                  ),
                refunded: true,
              },
              {
                session:
                  refundSession,
              }
            );

            await Notification.create(
              [
                {
                  user: req.user.id,
                  title:
                    "Withdrawal Failed",
                  message:
                    `Your ₦${withdrawalAmount.toLocaleString()} withdrawal failed and the funds were returned to your wallet.`,
                  type: "withdrawal",
                },
              ],
              {
                session:
                  refundSession,
              }
            );
          }
        );
      } finally {
        await refundSession.endSession();
      }

      const wallet =
        await Wallet.findOne({
          user: req.user.id,
        });

      return res.status(400).json({
        success: false,
        status: "failed",
        reference,
        walletBalance:
          Number(
            wallet?.balance || 0
          ),
        message:
          "Withdrawal failed. Your wallet has been refunded.",
      });
    }

    /* =====================================================
       6. PENDING / NEW
    ===================================================== */

    await Transaction.findByIdAndUpdate(
      transactionId,
      {
        status: "pending",
        providerReference,
        providerStatus,
        providerResponseCode:
          String(
            providerResponse?.status ||
              ""
          ),
      }
    );

    return res.status(202).json({
      success: true,
      status: "pending",
      reference,
      providerReference,
      message:
        "Withdrawal submitted and is being processed.",
    });
  } catch (error) {
    console.error(
      "WITHDRAWAL ERROR:",
      error
    );

    if (transactionId) {
      /*
       * Only refund here for errors that happened
       * before a provider transfer was actually
       * attempted.
       */
      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          providerStatus:
            "internal_error",
        }
      );
    }

    if (
      error.message ===
        "Insufficient wallet balance" ||
      error.message ===
        "Wallet not found."
    ) {
      return res.status(400).json({
        message: error.message,
      });
    }

    return res.status(500).json({
      message:
        error.message ||
        "Withdrawal failed.",
    });
  }
});

/* =========================================================
   GET WITHDRAWAL STATUS
========================================================= */

router.get(
  "/:reference",
  protect,
  async (req, res) => {
    try {
      const transaction =
        await Transaction.findOne({
          user: req.user.id,
          type: "withdrawal",
          reference:
            req.params.reference,
        });

      if (!transaction) {
        return res.status(404).json({
          message:
            "Withdrawal not found.",
        });
      }

      /*
       * If we have a provider reference,
       * retrieve the provider status.
       */
      let providerResponse = null;

      if (
        transaction.providerReference
      ) {
        try {
          providerResponse =
            await getTransfer(
              transaction.providerReference
            );
        } catch (error) {
          console.error(
            "WITHDRAWAL STATUS PROVIDER ERROR:",
            error.message
          );
        }
      }

      return res.json({
        success: true,
        withdrawal: {
          id: transaction._id,
          reference:
            transaction.reference,
          providerReference:
            transaction.providerReference,
          amount:
            transaction.amount,
          status:
            transaction.status,
          providerStatus:
            transaction.providerStatus,
          bank:
            transaction.bank,
          accountNumber:
            transaction.accountNumber,
          accountName:
            transaction.accountName,
          createdAt:
            transaction.createdAt,
        },
        provider:
          providerResponse,
      });
    } catch (error) {
      console.error(
        "GET WITHDRAWAL STATUS ERROR:",
        error
      );

      return res.status(500).json({
        message:
          "Unable to retrieve withdrawal status.",
      });
    }
  }
);

module.exports = router;