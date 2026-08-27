const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    plan: {
      type: String,
      required: true,
    },

    profitRate: {
      type: Number,
      required: true,
    },

    duration: {
      type: Number,
      required: true,
    },

    expectedProfit: {
      type: Number,
      default: 0,
    },

    currentValue: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["pending", "active", "completed", "cancelled"],
      default: "pending",
    },

    maturityDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

investmentSchema.pre("save", function () {
if (
!this.isNew &&
!this.isModified("amount") &&
!this.isModified("profitRate")
) {
return;
}

this.expectedProfit =
this.amount * this.profitRate;

this.currentValue =
this.amount + this.expectedProfit;

this.maturityDate = new Date(
Date.now() +
this.duration *
24 *
60 *
60 *
1000
);
});


module.exports = mongoose.model(
  "Investment",
  investmentSchema
);