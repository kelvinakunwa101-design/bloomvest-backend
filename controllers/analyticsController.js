const Investment = require("../models/Investment");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");

exports.getAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;

    const investments = await Investment.find({ user: userId });

    const transactions = await Transaction.find({ user: userId });

    const wallet = await Wallet.findOne({ user: userId });

    const totalInvested = investments.reduce(
      (sum, inv) => sum + inv.amount,
      0
    );

    const totalProfit = investments.reduce(
      (sum, inv) => sum + (inv.expectedProfit || 0),
      0
    );

    const portfolioValue = investments.reduce(
      (sum, inv) => sum + (inv.currentValue || inv.amount),
      0
    );

    const activeInvestments = investments.filter(
      (i) => i.status === "active"
    ).length;

    const completedInvestments = investments.filter(
      (i) => i.status === "completed"
    ).length;

    const deposits = transactions.filter(
      (t) => t.type === "deposit"
    );

    const withdrawals = transactions.filter(
      (t) => t.type === "withdrawal"
    );

    const totalDeposits = deposits.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const totalWithdrawals = withdrawals.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const roi =
      totalInvested > 0
        ? ((totalProfit / totalInvested) * 100).toFixed(2)
        : 0;

    res.json({
      walletBalance: wallet?.balance || 0,

      portfolioValue,

      totalInvested,

      totalProfit,

      roi,

      activeInvestments,

      completedInvestments,

      totalDeposits,

      totalWithdrawals,

      investments,

      transactions,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Analytics failed",
    });
  }
};