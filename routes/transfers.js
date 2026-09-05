const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");

const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const {
  getBanks,
  verifyBankAccount,
  createTransfer,
  getTransfer,
} = require("../services/flutterwaveService");

// =========================================================
// GENERATE TRANSFER REFERENCE
// =========================================================

const generateReference = () => {
  return `BV-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase()}`;
};

// =========================================================
// GET NIGERIAN BANKS
// =========================================================

router.get("/banks", protect, async (req, res) => {
  try {
    const data = await getBanks();

    return res.json({
      success: true,
      banks: data?.data || [],
    });
  } catch (err) {
    console.error("FLUTTERWAVE BANKS ERROR:", err);

    return res.status(500).json({
      message:
        err.message ||
        "Unable to load supported banks",
    });
  }
});

// =========================================================
// VERIFY BANK ACCOUNT
// =========================================================

router.post(
  "/verify-account",
  protect,
  async (req, res) => {
    try {
      const {
        bankCode,
        accountNumber,
      } = req.body;

      if (!bankCode) {
        return res.status(400).json({
          message: "Bank is required",
        });
      }

      if (!/^\d{10}$/.test(accountNumber || "")) {
        return res.status(400).json({
          message:
            "Account number must contain exactly 10 digits",
        });
      }

      const data = await verifyBankAccount({
        accountNumber,
        bankCode,
      });

      const accountName =
        data?.data?.account_name;

      if (
        data?.status !== "success" ||
        !accountName
      ) {
        return res.status(400).json({
          message:
            "Unable to verify bank account",
        });
      }

      return res.json({
        success: true,
        accountName,
        accountNumber,
        bankCode,
      });
    } catch (err) {
      console.error(
        "ACCOUNT VERIFICATION ERROR:",
        err
      );

      return res.status(400).json({
        message:
          err.message ||
          "Unable to verify bank account",
      });
    }
  }
);

// =========================================================
// CREATE BANK TRANSFER
// =========================================================

router.post("/", protect, async (req, res) => {
  const session =
    await mongoose.startSession();

  let transactionId = null;
  let reference = null;

  try {
    const {
      bankCode,
      bank,
      accountNumber,
      accountName,
      amount,
      description,
    } = req.body;

    const transferAmount = Number(amount);

    // -----------------------------------------------------
    // VALIDATION
    // -----------------------------------------------------

    if (!bankCode) {
      return res.status(400).json({
        message: "Bank is required",
      });
    }

    if (!bank) {
      return res.status(400).json({
        message: "Bank name is required",
      });
    }

    if (!/^\d{10}$/.test(accountNumber || "")) {
      return res.status(400).json({
        message:
          "Account number must contain exactly 10 digits",
      });
    }

    if (!accountName?.trim()) {
      return res.status(400).json({
        message: "Account name is required",
      });
    }

    if (
      !Number.isFinite(transferAmount) ||
      transferAmount <= 0
    ) {
      return res.status(400).json({
        message:
          "Enter a valid transfer amount",
      });
    }

    // -----------------------------------------------------
    // GENERATE UNIQUE REFERENCE
    // -----------------------------------------------------

    reference = generateReference();

    // -----------------------------------------------------
    // RESERVE WALLET FUNDS
    // -----------------------------------------------------

    await session.withTransaction(async () => {
      const wallet =
        await Wallet.findOne({
          user: req.user.id,
        }).session(session);

      if (!wallet) {
        throw new Error(
          "Wallet not found"
        );
      }

      const balance =
        Number(wallet.balance || 0);

      if (balance < transferAmount) {
        throw new Error(
          "Insufficient wallet balance"
        );
      }

      wallet.balance =
        balance - transferAmount;

      await wallet.save({
        session,
      });

      // ---------------------------------------------------
      // CREATE PENDING TRANSACTION
      // ---------------------------------------------------

      const transactions =
        await Transaction.create(
          [
            {
              user: req.user.id,

              type: "transfer",

              amount: transferAmount,

              description:
                description?.trim() ||
                `Bank transfer to ${accountName}`,

              bank,

              accountNumber,

              accountName:
                accountName.trim(),

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
    });

    // -----------------------------------------------------
    // SEND TO FLUTTERWAVE
    // -----------------------------------------------------

    let providerResponse;

    try {
      providerResponse =
        await createTransfer({
          amount: transferAmount,

          accountNumber,

          bankCode,

          narration:
            description?.trim() ||
            `BloomVest transfer to ${accountName}`,

          reference,
        });
    } catch (providerError) {
      console.error(
        "FLUTTERWAVE TRANSFER ERROR:",
        providerError
      );

      // IMPORTANT:
      // Do NOT automatically refund here.
      //
      // A network/provider error does not necessarily
      // mean Flutterwave did not receive the transfer.

      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "pending",

          providerStatus:
            "processing",
        }
      );

      return res.status(202).json({
        message:
          "Transfer is being processed. Please check the transaction status.",

        status: "pending",

        reference,
      });
    }

    console.log(
      "Flutterwave transfer response:",
      providerResponse
    );

    // -----------------------------------------------------
    // EXTRACT PROVIDER INFORMATION
    // -----------------------------------------------------

    const providerStatus =
      providerResponse?.data?.status ||
      providerResponse?.status ||
      "processing";

    const providerReference =
      providerResponse?.data?.id ||
      providerResponse?.data?.reference ||
      "";

    // -----------------------------------------------------
    // SUCCESS
    // -----------------------------------------------------

    if (
      providerStatus === "successful" ||
      providerStatus === "success" ||
      providerResponse?.status === "success"
    ) {
      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "completed",

          providerReference,

          providerStatus,

          providerResponseCode:
            providerResponse?.status || "",
        }
      );

      try {
  await Notification.create({
    user: req.user.id,
    title: "Transfer Successful",
    message: `₦${transferAmount.toLocaleString()} has been sent to ${accountName}.`,
    type: "transfer",
  });
} catch (notificationError) {
  console.error(
    "TRANSFER NOTIFICATION ERROR:",
    notificationError
  );
}

      const wallet =
        await Wallet.findOne({
          user: req.user.id,
        });

      return res.status(201).json({
        message:
          "Transfer completed successfully",

        status: "completed",

        reference,

        walletBalance:
          wallet?.balance || 0,

        providerReference,
      });
    }

    // -----------------------------------------------------
    // FAILED
    // -----------------------------------------------------

    if (
      providerStatus === "failed" ||
      providerStatus === "cancelled"
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

            if (wallet) {
              wallet.balance =
                Number(
                  wallet.balance || 0
                ) + transferAmount;

              await wallet.save({
                session:
                  refundSession,
              });
            }

            await Transaction.findByIdAndUpdate(
              transactionId,
              {
                status: "failed",

                providerReference,

                providerStatus,

                providerResponseCode:
                  providerResponse?.status ||
                  "",

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
                    "Transfer Failed",

                  message:
                    `Your ₦${transferAmount.toLocaleString()} transfer failed. Your wallet has been refunded.`,

                  type: "transfer",
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
        message:
          "Transfer failed. Your wallet has been refunded.",

        status: "failed",

        reference,

        walletBalance:
          wallet?.balance || 0,
      });
    }

    // -----------------------------------------------------
    // PENDING
    // -----------------------------------------------------

    await Transaction.findByIdAndUpdate(
      transactionId,
      {
        status: "pending",

        providerReference,

        providerStatus,

        providerResponseCode:
          providerResponse?.status || "",
      }
    );

    return res.status(202).json({
      message:
        "Transfer is being processed.",

      status: "pending",

      reference,

      providerReference,
    });
  } catch (err) {
    console.error(
      "BANK TRANSFER ERROR:",
      err
    );

    if (
      err.message ===
      "Insufficient wallet balance"
    ) {
      return res.status(400).json({
        message: err.message,
      });
    }

    return res.status(500).json({
      message:
        err.message ||
        "Bank transfer failed",
    });
  } finally {
    await session.endSession();
  }
});

// =========================================================
// GET TRANSFER STATUS
// =========================================================

router.get(
  "/:transferId",
  protect,
  async (req, res) => {
    try {
      const {
        transferId,
      } = req.params;

      const transaction =
        await Transaction.findOne({
          user: req.user.id,

          $or: [
            {
              reference:
                transferId,
            },
            {
              providerReference:
                transferId,
            },
          ],

          type: "transfer",
        });

      if (!transaction) {
        return res.status(404).json({
          message:
            "Transfer transaction not found",
        });
      }

      return res.json({
        success: true,

        transfer: {
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
      });
    } catch (err) {
      console.error(
        "TRANSFER STATUS ERROR:",
        err
      );

      return res.status(500).json({
        message:
          err.message ||
          "Unable to retrieve transfer status",
      });
    }
  }
);

module.exports = router;