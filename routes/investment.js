const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const Investment = require("../models/Investment");
const InvestmentPlan = require("../models/InvestmentPlan");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

/* ==============================
   CREATE INVESTMENT
============================== */

router.post("/", protect, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { amount, plan } = req.body;
    const investmentAmount = Number(amount);

    if (
      !Number.isFinite(investmentAmount) ||
      investmentAmount <= 0
    ) {
      return res.status(400).json({
        message: "Invalid investment amount",
      });
    }

    if (!plan) {
      return res.status(400).json({
        message: "Investment plan is required",
      });
    }

    let responseData;

    await session.withTransaction(async () => {
      /* ==============================
         FIND INVESTMENT PLAN
      ============================== */

      const investmentPlan = await InvestmentPlan.findOne({
        name: plan,
        active: true,
      }).session(session);

      if (!investmentPlan) {
        throw new Error("Investment plan not found");
      }

      /* ==============================
         CHECK MINIMUM INVESTMENT
      ============================== */

      if (
        investmentAmount <
        investmentPlan.minimumAmount
      ) {
        throw new Error(
          `Minimum investment for ${investmentPlan.name} is ₦${investmentPlan.minimumAmount.toLocaleString()}`
        );
      }

      /* ==============================
         FIND USER WALLET
      ============================== */

      const wallet = await Wallet.findOne({
        user: req.user.id,
      }).session(session);

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      if (
        Number(wallet.balance || 0) <
        investmentAmount
      ) {
        throw new Error(
          "Insufficient wallet balance"
        );
      }

      /* ==============================
         RESERVE INVESTMENT AMOUNT
      ============================== */

      wallet.balance =
        Number(wallet.balance || 0) -
        investmentAmount;

      await wallet.save({
        session,
      });

      /* ==============================
         CREATE PENDING TRANSACTION
      ============================== */

      const transactions =
        await Transaction.create(
          [
            {
              user: req.user.id,
              type: "investment",
              amount: investmentAmount,
              description:
                `${investmentPlan.name} Investment`,
              status: "pending",
              reference:
                "BLM" +
                Date.now() +
                Math.floor(
                  Math.random() * 10000
                ),
            },
          ],
          {
            session,
          }
        );

      const transaction =
        transactions[0];

      /* ==============================
         CREATE PENDING INVESTMENT
      ============================== */

      const investments = await Investment.create(
  [
    {
      user: req.user.id,
      transaction: transaction._id,
      amount: investmentAmount,
      plan: investmentPlan.name,
      profitRate: investmentPlan.returnRate / 100,
      duration: investmentPlan.duration,
      status: "pending",
    },
  ],
  {
    session,
  }
);

const investment = investments[0];

      /* ==============================
         CREATE NOTIFICATION
      ============================== */

      await Notification.create(
        [
          {
            user: req.user.id,
            title:
              "Investment Submitted",
            message:
              `Your ₦${investmentAmount.toLocaleString()} investment ` +
              `in the ${investmentPlan.name} plan has been submitted ` +
              "and is awaiting approval.",
            type: "investment",
          },
        ],
        {
          session,
        }
      );

      /* ==============================
         RESPONSE DATA
      ============================== */

      responseData = {
        investment,
        transaction,
        walletBalance:
          wallet.balance,
      };
    });

    return res.status(201).json({
      message:
        "Investment submitted successfully",
      ...responseData,
    });
  } catch (err) {
    console.error(
      "INVESTMENT ERROR:",
      err
    );

    return res.status(400).json({
      message:
        err.message ||
        "Investment error",
    });
  } finally {
    await session.endSession();
  }
});

/* ==============================
   GET USER INVESTMENTS
============================== */

router.get("/", protect, async (req, res) => {
  try {
    const investments =
      await Investment.find({
        user: req.user.id,
      }).sort({
        createdAt: -1,
      });

    return res.json(investments);
  } catch (err) {
    console.error(
      "GET INVESTMENTS ERROR:",
      err
    );

    return res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;