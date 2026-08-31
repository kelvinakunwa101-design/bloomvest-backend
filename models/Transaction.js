const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
         "deposit",
         "withdrawal",
          "transfer",
          "investment",
            "profit",
            "utility",
       ],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
      index: true,
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

    // BloomVest internal / VTpass request reference
    reference: {
      type: String,
      index: true,
    },

    // VTpass transaction ID returned by provider
    providerReference: {
      type: String,
      default: "",
    },

    // Provider/service information
    serviceID: {
      type: String,
      default: "",
    },

    billersCode: {
      type: String,
      default: "",
    },

    variationCode: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    // Useful for reconciliation and audit
    providerStatus: {
      type: String,
      default: "",
    },

    providerResponseCode: {
      type: String,
      default: "",
    },

    // Prevents a failed transaction from being refunded twice
    refunded: {
      type: Boolean,
      default: false,
    },

    // Number of reconciliation attempts
    requeryAttempts: {
      type: Number,
      default: 0,
    },

    lastRequeryAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Transaction",
  transactionSchema
);