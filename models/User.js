const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ==========================
    // BASIC DETAILS
    // ==========================

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,
    },

    accountNumber: {
      type: String,
      unique: true,
      sparse: true,
    },

    investorId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // ==========================
    // FINTECH
    // ==========================

    balance: {
      type: Number,
      default: 0,
    },

    investorTier: {
      type: String,
      enum: ["Bronze", "Silver", "Gold", "Platinum"],
      default: "Bronze",
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    kycStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },

    // ==========================
    // KYC DOCUMENTS
    // ==========================

    kycDocumentType: {
      type: String,
      enum: [
        "",
        "National ID",
        "Driver License",
        "International Passport",
        "Voter Card",
      ],
      default: "",
    },

    kycDocumentNumber: {
      type: String,
      default: "",
    },

    kycDocumentFront: {
      type: String,
      default: "",
    },

    kycDocumentBack: {
      type: String,
      default: "",
    },

    kycSubmittedAt: {
      type: Date,
    },

    kycVerifiedAt: {
      type: Date,
    },

    // ==========================
    // PROFILE
    // ==========================

    avatar: {
      type: String,
      default: "",
    },

    gender: String,

    occupation: String,

    address: String,

    city: String,

    state: String,

    country: {
      type: String,
      default: "Nigeria",
    },

    dateOfBirth: Date,

    // ==========================
    // SETTINGS
    // ==========================

    emailNotifications: {
      type: Boolean,
      default: true,
    },

    smsNotifications: {
      type: Boolean,
      default: false,
    },

    // ==========================
    // SECURITY / 2FA
    // ==========================

    twoFactor: {
      type: Boolean,
      default: false,
    },

    twoFactorSecret: {
      type: String,
      default: "",
    },

    twoFactorVerified: {
      type: Boolean,
      default: false,
    },

    darkMode: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);

