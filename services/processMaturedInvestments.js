const mongoose = require("mongoose");

const Investment = require("../models/Investment");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const processMaturedInvestments = async () => {
  const maturedInvestments = await Investment.find({
    status: "active",
    maturityDate: { $lte: new Date() },
  });

  let processedCount = 0;

  for (const investment of maturedInvestments) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Re-check the investment inside the transaction
        // to prevent duplicate processing.
        const activeInvestment = await Investment.findOne({
          _id: investment._id,
          status: "active",
          maturityDate: { $lte: new Date() },
        }).session(session);

        if (!activeInvestment) {
          return;
        }

        // Find or create wallet
        let wallet = await Wallet.findOne({
          user: activeInvestment.user,
        }).session(session);

        if (!wallet) {
          wallet = new Wallet({
            user: activeInvestment.user,
            balance: 0,
          });
        }

        // Credit the full matured value:
        // original investment + profit
        wallet.balance += activeInvestment.currentValue;

        await wallet.save({ session });

        // Create profit transaction
        await Transaction.create(
          [
            {
              user: activeInvestment.user,
              type: "profit",
              amount: activeInvestment.expectedProfit,
              description: `${activeInvestment.plan} investment matured`,
              status: "completed",
              reference:
                "BLM" +
                Date.now() +
                Math.floor(Math.random() * 10000),
            },
          ],
          { session }
        );

        // Create maturity notification
        await Notification.create(
          [
            {
              user: activeInvestment.user,
              title: "Investment Completed",
              message: `Your ${activeInvestment.plan} investment has matured. ₦${Number(
                activeInvestment.expectedProfit
              ).toLocaleString()} profit has been credited to your wallet.`,
              type: "profit",
            },
          ],
          { session }
        );

        // Mark investment as completed LAST
        activeInvestment.status = "completed";

        await activeInvestment.save({ session });

        processedCount += 1;
      });
    } catch (err) {
      console.error(
        `Maturity processing failed for investment ${investment._id}:`,
        err
      );
    } finally {
      await session.endSession();
    }
  }

  return processedCount;
};

module.exports = processMaturedInvestments;