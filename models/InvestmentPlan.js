const mongoose = require("mongoose");

const investmentPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },

    returnRate: {
      type: Number,
      required: true,
    },

    duration: {
      type: Number,
      required: true,
    },

    minimumAmount: {
      type: Number,
      required: true,
    },

    risk: {
      type: String,
      enum: ["Low", "Medium", "High"],
      required: true,
    },

    color: {
      type: String,
      default: "#2563EB",
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "InvestmentPlan",
  investmentPlanSchema
);