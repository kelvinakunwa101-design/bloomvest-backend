const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: [
        "deposit",
        "withdrawal",
        "investment",
        "profit",
        "utility",
      ],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },

    description: {
      type: String,
      default: "",
    },

    bank: {
  type: String,
  default: "",
},

accountNumber: {
  type: String,
  default: "",
},

accountName: {
  type: String,
  default: "",
},

    reference: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "Transaction",
  transactionSchema
);