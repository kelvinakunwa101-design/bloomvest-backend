const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");

const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const {
  verifyBankAccount,
  getTransfer,
} = require("../services/flutterwaveService");

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
   CREATE WITHDRAWAL
   User submits withdrawal.
   Funds are reserved and withdrawal waits for admin approval.
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

  const normalizedBankCode = String(bankCode || "").trim();
  const normalizedBank = String(bank || "").trim();
  const normalizedAccountNumber = String(
    accountNumber || ""
  ).trim();
  const normalizedAccountName = String(
    accountName || ""
  ).trim();

  const withdrawalAmount = Number(amount);

  /* =====================================================
     VALIDATION
  ===================================================== */

  if (!normalizedBankCode) {
    return res.status(400).json({
      message: "Bank code is required.",
    });
  }

  if (!normalizedBank) {
    return res.status(400).json({
      message: "Bank name is required.",
    });
  }

  if (!/^\d{10}$/.test(normalizedAccountNumber)) {
    return res.status(400).json({
      message:
        "Account number must contain exactly 10 digits.",
    });
  }

  if (!normalizedAccountName) {
    return res.status(400).json({
      message: "Account name is required.",
    });
  }

  if (
    !Number.isFinite(withdrawalAmount) ||
    withdrawalAmount <= 0
  ) {
    return res.status(400).json({
      message: "Enter a valid withdrawal amount.",
    });
  }

  const reference = generateReference();

  let session = null;
  let transactionId = null;

  try {
    /* =====================================================
       1. VERIFY BANK ACCOUNT WITH FLUTTERWAVE
    ===================================================== */

    const verification = await verifyBankAccount({
      accountNumber: normalizedAccountNumber,
      bankCode: normalizedBankCode,
    });

    const verifiedAccountName =
      verification?.data?.account_name?.trim();

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
       2. RESERVE WALLET + CREATE PENDING WITHDRAWAL
    ===================================================== */

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({
        user: req.user.id,
      }).session(session);

      if (!wallet) {
        throw new Error("Wallet not found.");
      }

      const balance = Number(wallet.balance || 0);

      if (balance < withdrawalAmount) {
        throw new Error(
          "Insufficient wallet balance."
        );
      }

      /*
       * Reserve the withdrawal amount immediately.
       * The amount is returned only if admin/provider
       * ultimately rejects the transfer.
       */
      wallet.balance =
        balance - withdrawalAmount;

      await wallet.save({
        session,
      });

      const transactions =
        await Transaction.create(
          [
            {
              user: req.user.id,
              type: "withdrawal",
              amount: withdrawalAmount,

              description:
                String(description || "").trim() ||
                `Withdrawal to ${verifiedAccountName}`,

              bank: normalizedBank,
              bankCode: normalizedBankCode,

              accountNumber:
                normalizedAccountNumber,

              accountName:
                verifiedAccountName,

              status: "pending",

              /*
               * Explicitly mark this as waiting
               * for administrator approval.
               */
              providerStatus:
                "awaiting_admin_approval",

              providerReference: "",
              providerResponseCode: "",
              refunded: false,

              reference,
            },
          ],
          {
            session,
          }
        );

      transactionId = transactions[0]._id;

      /*
       * Optional notification for the user.
       */
      await Notification.create(
        [
          {
            user: req.user.id,
            title: "Withdrawal Submitted",
            message:
              `Your ₦${withdrawalAmount.toLocaleString()} withdrawal has been submitted and is awaiting admin approval.`,
            type: "withdrawal",
          },
        ],
        {
          session,
        }
      );
    });

    await session.endSession();
    session = null;

    /* =====================================================
       3. RETURN PENDING STATUS
    ===================================================== */

    const wallet = await Wallet.findOne({
      user: req.user.id,
    });

    return res.status(202).json({
      success: true,
      status: "pending",
      reference,
      transactionId,
      walletBalance: Number(
        wallet?.balance || 0
      ),
      message:
        "Withdrawal submitted successfully and is awaiting admin approval.",
    });
  } catch (error) {
    console.error(
      "WITHDRAWAL ERROR:",
      error
    );

    if (session) {
      try {
        await session.endSession();
      } catch (sessionError) {
        console.error(
          "SESSION CLEANUP ERROR:",
          sessionError
        );
      }
    }

    /*
     * If the transaction was created but something
     * unexpected happened afterwards, mark it as an
     * internal error. Do NOT automatically refund here
     * because we need to avoid accidentally refunding
     * a transaction whose wallet reservation committed.
     */
    if (transactionId) {
      try {
        await Transaction.findByIdAndUpdate(
          transactionId,
          {
            providerStatus:
              "internal_error",
          }
        );
      } catch (updateError) {
        console.error(
          "WITHDRAWAL TRANSACTION UPDATE ERROR:",
          updateError
        );
      }
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
          reference: req.params.reference,
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

      if (transaction.providerReference) {
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

          bankCode:
            transaction.bankCode,

          accountNumber:
            transaction.accountNumber,

          accountName:
            transaction.accountName,

          refunded:
            transaction.refunded,

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