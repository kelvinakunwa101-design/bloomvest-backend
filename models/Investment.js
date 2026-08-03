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
    required: true,
  },

  profitRate: {
    type: Number,
    default: 0.05,
  },

  duration: {
    type: Number,
    default: 30,
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
    enum: ["active", "completed", "cancelled"],
    default: "active",
  },

  maturityDate: {
    type: Date,
  },
},
  { timestamps: true } 
  ); 
  investmentSchema.pre("save", function (next) {
  if (!this.isModified("amount") && !this.isModified("profitRate") && !this.isNew) {
    return next();
  }
  this.expectedProfit = this.amount * this.profitRate;

  this.currentValue = this.amount + this.expectedProfit;

  this.maturityDate = new Date(
    Date.now() + this.duration * 24 * 60 * 60 * 1000
  );

  next();
});
module.exports = mongoose.model("Investment", investmentSchema);