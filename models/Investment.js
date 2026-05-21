const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    plan: {
      type: String,
      default: "basic",
    },

    profitRate: {
      type: Number,
      default: 0.05, // 5% daily (demo)
    },

    duration: {
      type: Number,
      default: 7, // days
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);