const Investment = require("../models/Investment");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");

const processMaturedInvestments = async () => {
  const maturedInvestments = await Investment.find({
    status: "active",
    maturityDate: { $lte: new Date() },
  });

  for (const investment of maturedInvestments) {
    let wallet = await Wallet.findOne({
      user: investment.user,
    });

    if (!wallet) {
      wallet = await Wallet.create({
        user: investment.user,
        balance: 0,
      });
    }

    wallet.balance += investment.currentValue;
    await wallet.save();

    await Transaction.create({
      user: investment.user,
      type: "profit",
      amount: investment.expectedProfit,
      description: `${investment.plan} investment matured`,
      status: "completed",
    });

    investment.status = "completed";
    await investment.save();
  }

  return maturedInvestments.length;
};

module.exports = processMaturedInvestments;