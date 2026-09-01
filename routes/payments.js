const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");

const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const {
  createDepositCharge,
  verifyDepositCharge,
  authorizeDepositCharge,
} = require("../services/flutterwaveService");

/* =========================================================
   HELPERS
========================================================= */

const generateReference = () => {
  return (
    `BV-DEP-${Date.now()}-` +
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
};

const splitName = (fullName) => {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    first: parts[0] || "BloomVest",
    last:
      parts.slice(1).join(" ") || "User",
  };
};

const normalizePaymentMethod = (
  paymentMethod
) => {
  const type = String(
    paymentMethod?.type || ""
  )
    .trim()
    .toLowerCase();

  if (!type) {
    throw new Error(
      "Payment method is required."
    );
  }

  const allowedTypes = [
    "card",
    "ussd",
    "bank_account",
    "opay",
  ];

  if (!allowedTypes.includes(type)) {
    throw new Error(
      "Unsupported payment method."
    );
  }

  return {
    ...paymentMethod,
    type,
  };
};

/* =========================================================
   COMPLETE VERIFIED DEPOSIT
   Centralized so redirect verification and webhook
   follow the same wallet-crediting rules.
========================================================= */

const completeVerifiedDeposit = async ({
  transaction,
  chargeId,
  providerResponse,
}) => {
  const providerData =
    providerResponse?.data || {};

  const providerStatus = String(
    providerData.status || ""
  ).toLowerCase();

  const providerAmount = Number(
    providerData.amount
  );

  const providerCurrency = String(
    providerData.currency || ""
  ).toUpperCase();

  const providerReference = String(
    providerData.reference || ""
  );

  /* -------------------------------------------------------
     VERIFY FINAL STATUS
  ------------------------------------------------------- */

  if (providerStatus !== "succeeded") {
    return {
      completed: false,
      status: "pending",
      providerStatus,
      message:
        "Payment has not been completed.",
    };
  }

  /* -------------------------------------------------------
     VERIFY REFERENCE
  ------------------------------------------------------- */

  if (
    !providerReference ||
    providerReference !==
      String(transaction.reference)
  ) {
    throw new Error(
      "Payment reference does not match the deposit."
    );
  }

  /* -------------------------------------------------------
     VERIFY CURRENCY
  ------------------------------------------------------- */

  if (providerCurrency !== "NGN") {
    throw new Error(
      "Payment currency is not NGN."
    );
  }

  /* -------------------------------------------------------
     VERIFY AMOUNT
  ------------------------------------------------------- */

  if (
    !Number.isFinite(providerAmount) ||
    providerAmount !==
      Number(transaction.amount)
  ) {
    throw new Error(
      "Payment amount does not match the deposit."
    );
  }

  /* -------------------------------------------------------
     IDEMPOTENCY
  ------------------------------------------------------- */

  if (transaction.status === "completed") {
    const existingWallet =
      await Wallet.findOne({
        user: transaction.user,
      });

    return {
      completed: true,
      status: "completed",
      walletBalance:
        Number(
          existingWallet?.balance || 0
        ),
      alreadyProcessed: true,
    };
  }

  /* -------------------------------------------------------
     ATOMIC WALLET CREDIT
  ------------------------------------------------------- */

  const session =
    await mongoose.startSession();

  try {
    let finalBalance = 0;

    await session.withTransaction(
      async () => {
        const lockedTransaction =
          await Transaction.findOne({
            _id: transaction._id,
          }).session(session);

        if (!lockedTransaction) {
          throw new Error(
            "Deposit transaction not found."
          );
        }

        /*
         * Another request may have completed
         * the transaction while this request
         * was running.
         */
        if (
          lockedTransaction.status ===
          "completed"
        ) {
          const existingWallet =
            await Wallet.findOne({
              user: lockedTransaction.user,
            }).session(session);

          finalBalance =
            Number(
              existingWallet?.balance || 0
            );

          return;
        }

        const wallet =
          await Wallet.findOne({
            user: lockedTransaction.user,
          }).session(session);

        if (!wallet) {
          throw new Error(
            "Wallet not found."
          );
        }

        wallet.balance =
          Number(wallet.balance || 0) +
          Number(
            lockedTransaction.amount
          );

        await wallet.save({
          session,
        });

        finalBalance =
          Number(wallet.balance || 0);

        lockedTransaction.status =
          "completed";

        lockedTransaction.providerReference =
          String(chargeId);

        lockedTransaction.providerStatus =
          providerStatus;

        lockedTransaction.providerResponseCode =
          String(
            providerResponse?.status || ""
          );

        await lockedTransaction.save({
          session,
        });

        await Notification.create(
          [
            {
              user:
                lockedTransaction.user,

              title:
                "Deposit Successful",

              message:
                `₦${Number(
                  lockedTransaction.amount
                ).toLocaleString()} ` +
                "has been credited to your wallet.",

              type: "deposit",
            },
          ],
          {
            session,
          }
        );
      }
    );

    return {
      completed: true,
      status: "completed",
      walletBalance: finalBalance,
      alreadyProcessed: false,
    };
  } finally {
    await session.endSession();
  }
};

/* =========================================================
   INITIATE DEPOSIT
========================================================= */

router.post(
  "/deposit",
  protect,
  async (req, res) => {
    let transactionId = null;

    try {
      const amount = Number(
        req.body.amount
      );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          message:
            "Enter a valid deposit amount.",
        });
      }

      const paymentMethod =
        normalizePaymentMethod(
          req.body.paymentMethod
        );

      const user = await User.findById(
        req.user.id
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      if (!user.email) {
        return res.status(400).json({
          message:
            "A valid email address is required.",
        });
      }

      /* -----------------------------------------------------
         ENSURE WALLET EXISTS
      ----------------------------------------------------- */

      await Wallet.findOneAndUpdate(
        {
          user: user._id,
        },
        {
          $setOnInsert: {
            user: user._id,
            balance: 0,
          },
        },
        {
          upsert: true,
          new: true,
        }
      );

      const reference =
        generateReference();

      /* -----------------------------------------------------
         CREATE PENDING TRANSACTION
      ----------------------------------------------------- */

      const transaction =
        await Transaction.create({
          user: user._id,
          type: "deposit",
          amount,
          status: "pending",
          description:
            "Wallet funding via Flutterwave",
          reference,
        });

      transactionId =
        transaction._id;

      /* -----------------------------------------------------
         CUSTOMER DETAILS
      ----------------------------------------------------- */

      const name =
        splitName(user.name);

      const frontendUrl =
        process.env.FRONTEND_URL ||
        "https://bloomvest-frontend-ten.vercel.app";

      const redirectUrl =
        `${frontendUrl}/deposit-success?reference=` +
        encodeURIComponent(reference);

      /* -----------------------------------------------------
         CREATE FLUTTERWAVE CHARGE
      ----------------------------------------------------- */

      const providerResponse =
        await createDepositCharge({
          amount,
          reference,
          redirectUrl,

          customer: {
            email: user.email,
            name: user.name,
            firstName: name.first,
            lastName: name.last,
            phone:
              user.phone || "",
            phoneCountryCode: "234",
          },

          paymentMethod,
        });

      const providerData =
        providerResponse?.data ||
        {};

      const chargeId =
        providerData.id || "";

      const providerStatus =
        providerData.status ||
        providerResponse?.status ||
        "pending";

      await Transaction.findByIdAndUpdate(
        transaction._id,
        {
          providerReference:
            String(chargeId),
          providerStatus:
            String(providerStatus),
          providerResponseCode:
            String(
              providerResponse?.status ||
                ""
            ),
        }
      );

      return res.status(201).json({
        success: true,
        status: "pending",
        reference,
        transactionId:
          transaction._id,
        chargeId,

        nextAction:
          providerData.next_action ||
          null,

        providerStatus:
          String(providerStatus),

        message:
          providerData.next_action
            ? "Payment initiated."
            : "Payment initiated. Awaiting payment completion.",
      });
    } catch (error) {
      console.error(
        "DEPOSIT INITIATION ERROR:",
        error
      );

      if (transactionId) {
        await Transaction.findByIdAndUpdate(
          transactionId,
          {
            status: "failed",
            providerStatus:
              "initiation_failed",
          }
        );
      }

      return res.status(400).json({
        message:
          error.message ||
          "Unable to initiate deposit.",
      });
    }
  }
);

/* =========================================================
   VERIFY DEPOSIT
========================================================= */

router.post(
  "/deposit/verify",
  protect,
  async (req, res) => {
    try {
      const {
        reference,
        chargeId,
      } = req.body;

      if (!reference || !chargeId) {
        return res.status(400).json({
          message:
            "Deposit reference and charge ID are required.",
        });
      }

      const transaction =
        await Transaction.findOne({
          user: req.user.id,
          type: "deposit",
          reference:
            String(reference),
        });

      if (!transaction) {
        return res.status(404).json({
          message:
            "Deposit transaction not found.",
        });
      }

      /*
       * Never trust the frontend's success state.
       * Re-query Flutterwave.
       */
      const providerResponse =
        await verifyDepositCharge(
          chargeId
        );

      const result =
        await completeVerifiedDeposit({
          transaction,
          chargeId,
          providerResponse,
        });

      if (!result.completed) {
        return res.status(202).json({
          success: false,
          status: "pending",
          reference,
          providerStatus:
            result.providerStatus,
          message:
            result.message,
        });
      }

      return res.json({
        success: true,
        status: "completed",
        reference,
        walletBalance:
          result.walletBalance,
        message:
          result.alreadyProcessed
            ? "Deposit has already been processed."
            : "Deposit verified and wallet credited.",
      });
    } catch (error) {
      console.error(
        "DEPOSIT VERIFICATION ERROR:",
        error
      );

      return res.status(400).json({
        message:
          error.message ||
          "Unable to verify deposit.",
      });
    }
  }
);

// =========================================================
// AUTHORIZE DEPOSIT
// Handles PIN / OTP / other Flutterwave auth models
// =========================================================

router.post(
  "/deposit/authorize",
  protect,
  async (req, res) => {
    try {
      const {
        reference,
        chargeId,
        authorization,
      } = req.body;

      if (
        !reference ||
        !chargeId ||
        !authorization?.type
      ) {
        return res.status(400).json({
          message:
            "Reference, charge ID and authorization are required.",
        });
      }

      const transaction =
        await Transaction.findOne({
          user: req.user.id,
          type: "deposit",
          reference: String(reference),
        });

      if (!transaction) {
        return res.status(404).json({
          message:
            "Deposit transaction not found.",
        });
      }

      const providerResponse =
        await authorizeDepositCharge({
          chargeId,
          authorization,
        });

      const providerData =
        providerResponse?.data || {};

      const providerStatus =
        String(
          providerData.status || ""
        ).toLowerCase();

      if (
        providerStatus === "succeeded"
      ) {
        const result =
          await completeVerifiedDeposit({
            transaction,
            chargeId,
            providerResponse,
          });

        return res.json({
          success: true,
          status: result.status,
          reference,
          walletBalance:
            result.walletBalance,
          message:
            "Payment authorized and verified.",
        });
      }

      return res.json({
        success: true,
        status: "pending",
        reference,
        chargeId,
        providerStatus,
        nextAction:
          providerData.next_action ||
          null,
        message:
          "Authorization submitted. Complete any remaining payment step.",
      });
    } catch (error) {
      console.error(
        "DEPOSIT AUTHORIZATION ERROR:",
        error
      );

      return res.status(400).json({
        message:
          error.message ||
          "Unable to authorize payment.",
      });
    }
  }
);

/* =========================================================
   FLUTTERWAVE WEBHOOK
========================================================= */

router.post(
  "/flutterwave/webhook",
  async (req, res) => {
    try {
      const secretHash =
        process.env.FLW_WEBHOOK_SECRET;

      if (!secretHash) {
        console.error(
          "FLW_WEBHOOK_SECRET is not configured."
        );

        return res
          .status(500)
          .send("Webhook not configured.");
      }

      const signature =
        req.headers[
          "flutterwave-signature"
        ];

      if (!signature) {
        return res
          .status(401)
          .send("Missing signature.");
      }

      /*
       * req.rawBody must be populated by
       * the Express JSON parser in server.js.
       */
      const rawBody =
        req.rawBody;

      if (!rawBody) {
        console.error(
          "Flutterwave webhook raw body is unavailable."
        );

        return res
          .status(500)
          .send(
            "Webhook raw body unavailable."
          );
      }

      const expectedSignature =
        crypto
          .createHmac(
            "sha256",
            secretHash
          )
          .update(rawBody)
          .digest("base64");

      const receivedSignature =
        String(signature);

      const expectedBuffer =
        Buffer.from(
          expectedSignature,
          "utf8"
        );

      const receivedBuffer =
        Buffer.from(
          receivedSignature,
          "utf8"
        );

      if (
        expectedBuffer.length !==
          receivedBuffer.length ||
        !crypto.timingSafeEqual(
          expectedBuffer,
          receivedBuffer
        )
      ) {
        return res
          .status(401)
          .send("Invalid signature.");
      }

      const event =
        req.body || {};

      if (
        event.type !==
        "charge.completed"
      ) {
        return res
          .status(200)
          .send("OK");
      }

      const eventData =
        event.data || {};

      const chargeId =
        eventData.id;

      const reference =
        eventData.reference;

      if (!chargeId || !reference) {
        return res
          .status(200)
          .send("OK");
      }

      const transaction =
        await Transaction.findOne({
          type: "deposit",
          reference:
            String(reference),
        });

      if (!transaction) {
        /*
         * Do not retry forever for an unknown
         * BloomVest reference.
         */
        return res
          .status(200)
          .send("OK");
      }

      /*
       * Re-query Flutterwave before giving value.
       */
      const providerResponse =
        await verifyDepositCharge(
          chargeId
        );

      await completeVerifiedDeposit({
        transaction,
        chargeId,
        providerResponse,
      });

      return res
        .status(200)
        .send("OK");
    } catch (error) {
      console.error(
        "FLUTTERWAVE WEBHOOK ERROR:",
        error
      );

      return res
        .status(500)
        .send(
          "Webhook processing failed."
        );
    }
  }
);

module.exports = router;
