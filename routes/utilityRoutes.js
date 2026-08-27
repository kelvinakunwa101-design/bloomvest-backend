const express = require("express");
const mongoose = require("mongoose");

const protect = require("../middleware/authMiddleware");

const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const {
  getServiceCategories,
  getServices,
  getVariations,
  verifyCustomer,
  purchaseService,
  requeryTransaction,
} = require("../services/vtpassService");

const router = express.Router();


// =========================================================
// GET SERVICE CATEGORIES
// =========================================================

router.get("/categories", protect, async (req, res) => {
  try {
    const data = await getServiceCategories();

    return res.json(data);
  } catch (err) {
    console.error(
      "UTILITY CATEGORIES ERROR:",
      err
    );

    return res.status(500).json({
      message:
        err.message ||
        "Unable to load utility categories",
    });
  }
});


// =========================================================
// GET SERVICES
// Example:
// /api/utilities/services/airtime
// /api/utilities/services/electricity-bill
// =========================================================

router.get(
  "/services/:identifier",
  protect,
  async (req, res) => {
    try {
      const data = await getServices(
        req.params.identifier
      );

      return res.json(data);
    } catch (err) {
      console.error(
        "UTILITY SERVICES ERROR:",
        err
      );

      return res.status(500).json({
        message:
          err.message ||
          "Unable to load utility services",
      });
    }
  }
);


// =========================================================
// GET SERVICE VARIATIONS
// =========================================================

router.get(
  "/variations/:serviceID",
  protect,
  async (req, res) => {
    try {
      const data = await getVariations(
        req.params.serviceID
      );

      return res.json(data);
    } catch (err) {
      console.error(
        "UTILITY VARIATIONS ERROR:",
        err
      );

      return res.status(500).json({
        message:
          err.message ||
          "Unable to load service variations",
      });
    }
  }
);


// =========================================================
// VERIFY CUSTOMER
// Electricity / TV etc.
// =========================================================

router.post(
  "/verify",
  protect,
  async (req, res) => {
    try {
      const {
        serviceID,
        billersCode,
        type,
      } = req.body;

      if (!serviceID || !billersCode) {
        return res.status(400).json({
          message:
            "serviceID and billersCode are required",
        });
      }

      const data = await verifyCustomer({
        serviceID,
        billersCode,
        type,
      });

      return res.json(data);
    } catch (err) {
      console.error(
        "UTILITY CUSTOMER VERIFICATION ERROR:",
        err
      );

      return res.status(500).json({
        message:
          err.message ||
          "Unable to verify customer",
      });
    }
  }
);


// =========================================================
// PURCHASE UTILITY
// =========================================================

router.post(
  "/pay",
  protect,
  async (req, res) => {
    const session = await mongoose.startSession();

    let transactionId = null;
    let requestId = null;

    try {
      const {
        serviceID,
        amount,
        phone,
        billersCode,
        variation_code,
        subscription_type,
        quantity,
      } = req.body;

      const transactionAmount = Number(amount);

      if (!serviceID) {
        return res.status(400).json({
          message: "serviceID is required",
        });
      }

      if (
        !Number.isFinite(transactionAmount) ||
        transactionAmount <= 0
      ) {
        return res.status(400).json({
          message: "Enter a valid amount",
        });
      }

      if (!phone) {
        return res.status(400).json({
          message: "Phone number is required",
        });
      }

      if (
        serviceID.includes("electric") ||
        serviceID === "aedc-electric" ||
        serviceID === "ekedc-electric" ||
        serviceID === "ikeja-electric"
      ) {
        if (!billersCode) {
          return res.status(400).json({
            message: "Meter number is required",
          });
        }
      }

      // -------------------------------------------------
      // VTpass request ID
      // First 12 chars must be Lagos/GMT+1 date-time.
      // -------------------------------------------------

      const now = new Date();

      const lagosTime = new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "Africa/Lagos",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }
      ).formatToParts(now);

      const parts = {};

      lagosTime.forEach((part) => {
        parts[part.type] = part.value;
      });

      const timestamp =
        `${parts.year}` +
        `${parts.month}` +
        `${parts.day}` +
        `${parts.hour}` +
        `${parts.minute}`;

      requestId =
        timestamp +
        Math.random()
          .toString(36)
          .substring(2, 14);

      // -------------------------------------------------
      // Reserve/debit wallet and create pending transaction
      // -------------------------------------------------

      await session.withTransaction(async () => {
        let wallet = await Wallet.findOne({
          user: req.user.id,
        }).session(session);

        if (!wallet) {
          throw new Error(
            "Wallet not found"
          );
        }

        const currentBalance =
          Number(wallet.balance || 0);

        if (
          currentBalance <
          transactionAmount
        ) {
          throw new Error(
            "Insufficient wallet balance"
          );
        }

        wallet.balance =
          currentBalance -
          transactionAmount;

        await wallet.save({
          session,
        });

        const transactions =
          await Transaction.create(
            [
              {
                user: req.user.id,
                type: "utility",
                amount: transactionAmount,
                description:
                  `Utility payment - ${serviceID}`,
                status: "pending",
                reference: requestId,
              },
            ],
            {
              session,
            }
          );

        transactionId =
          transactions[0]._id;
      });

      // -------------------------------------------------
      // Call VTpass OUTSIDE MongoDB transaction
      // -------------------------------------------------

      const payload = {
        request_id: requestId,
        serviceID,
        amount: transactionAmount,
        phone,
      };

      if (billersCode) {
        payload.billersCode =
          billersCode;
      }

      if (variation_code) {
        payload.variation_code =
          variation_code;
      }

      if (subscription_type) {
        payload.subscription_type =
          subscription_type;
      }

      if (quantity) {
        payload.quantity =
          quantity;
      }

      console.log(
        "VTpass payment request:",
        {
          request_id: requestId,
          serviceID,
          amount: transactionAmount,
        }
      );

      let providerResponse;

      try {
        providerResponse =
          await purchaseService(
            payload
          );
      } catch (providerError) {
        console.error(
          "VTpass provider error:",
          providerError
        );

        // IMPORTANT:
        // We cannot know whether VTpass received
        // the transaction when a network/provider
        // error occurs.
        //
        // Therefore keep transaction pending
        // rather than incorrectly refunding.

        await Transaction.findByIdAndUpdate(
          transactionId,
          {
            status: "pending",
            description:
              `Utility payment pending - ${serviceID}`,
          }
        );

        return res.status(202).json({
          message:
            "Payment is being processed. Please check the transaction status shortly.",
          status: "pending",
          reference: requestId,
        });
      }

      console.log(
        "VTpass response:",
        providerResponse
      );

      const providerCode =
        providerResponse?.code;

      const providerStatus =
        providerResponse?.content
          ?.transactions?.status;

      const successful =
        providerCode === "000" ||
        providerStatus === "delivered";

      const failed =
        providerStatus === "failed" ||
        providerCode === "099";

      // -------------------------------------------------
      // SUCCESS
      // -------------------------------------------------

      if (successful) {
        await Transaction.findByIdAndUpdate(
          transactionId,
          {
            status: "completed",
            description:
              `Utility payment successful - ${serviceID}`,
          }
        );

        await Notification.create({
          user: req.user.id,
          title: "Utility Payment Successful",
          message:
            `Your ₦${transactionAmount.toLocaleString()} utility payment was successful.`,
          type: "utility",
        });

        const wallet =
          await Wallet.findOne({
            user: req.user.id,
          });

        return res.status(201).json({
          message:
            "Utility payment successful",
          status: "completed",
          reference: requestId,
          walletBalance:
            wallet?.balance || 0,
          provider: providerResponse,
        });
      }

      // -------------------------------------------------
      // FAILED
      // -------------------------------------------------

      if (failed) {
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
                  ) +
                  transactionAmount;

                await wallet.save({
                  session:
                    refundSession,
                });
              }

              await Transaction.findByIdAndUpdate(
                transactionId,
                {
                  status: "failed",
                  description:
                    `Utility payment failed - ${serviceID}`,
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
                      "Utility Payment Failed",
                    message:
                      `Your ₦${transactionAmount.toLocaleString()} utility payment failed. Your wallet has been refunded.`,
                    type: "utility",
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
            "Utility payment failed. Your wallet has been refunded.",
          status: "failed",
          reference: requestId,
          walletBalance:
            wallet?.balance || 0,
        });
      }

      // -------------------------------------------------
      // UNKNOWN / PENDING
      // -------------------------------------------------

      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "pending",
          description:
            `Utility payment pending - ${serviceID}`,
        }
      );

      return res.status(202).json({
        message:
          "Utility payment is still processing.",
        status: "pending",
        reference: requestId,
        provider: providerResponse,
      });
    } catch (err) {
      console.error(
        "UTILITY PAYMENT ERROR:",
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
          "Utility payment failed",
      });
    } finally {
      await session.endSession();
    }
  }
);


// =========================================================
// REQUERY
// =========================================================

router.post(
  "/requery",
  protect,
  async (req, res) => {
    try {
      const { request_id } =
        req.body;

      if (!request_id) {
        return res.status(400).json({
          message:
            "request_id is required",
        });
      }

      const data =
        await requeryTransaction(
          request_id
        );

      return res.json(data);
    } catch (err) {
      console.error(
        "UTILITY REQUERY ERROR:",
        err
      );

      return res.status(500).json({
        message:
          err.message ||
          "Unable to check transaction status",
      });
    }
  }
);

router.get("/test", protect, async (req, res) => {
  try {
    const result = await getServiceCategories();

    return res.json({
      success: true,
      message: "VTpass connection successful",
      data: result,
    });
  } catch (err) {
    console.error("VTPASS TEST ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;