const express = require("express");
const router = express.Router();

const kycUpload = require("../services/kycUpload");
const upload = require("../services/upload");
const protect = require("../middleware/authMiddleware");

const User = require("../models/User");

/* ==========================
GET CURRENT USER
========================== */

router.get("/me", protect, async (req, res) => {
  try {
    console.log("CURRENT USER:", req.user);

    res.json(req.user);
  } catch (err) {
    console.error("GET CURRENT USER ERROR:", err);

    res.status(500).json({
      message: "Failed to fetch user",
    });
  }
});

/* ==========================
UPDATE PROFILE + SETTINGS
========================== */

router.put("/me", protect, async (req, res) => {
  try {
    const {
        name,
        email,
        phone,
        occupation,
        gender,
        address,
        dateOfBirth,
        country,
        state,
        city,

       // Settings
        emailNotifications,
        smsNotifications,
        darkMode,
       } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    /* ==========================
    PROFILE
    ========================== */

    user.occupation = occupation ?? user.occupation;
    user.gender = gender ?? user.gender;
    user.address = address ?? user.address;
    user.dateOfBirth = dateOfBirth ?? user.dateOfBirth;
    user.country = country ?? user.country;
    user.state = state ?? user.state;
    user.city = city ?? user.city;

    /* ==========================
    SETTINGS
    ========================== */

    if (typeof emailNotifications === "boolean") {
      user.emailNotifications = emailNotifications;
    }

    if (typeof smsNotifications === "boolean") {
      user.smsNotifications = smsNotifications;
    }

    if (typeof darkMode === "boolean") {
      user.darkMode = darkMode;
    }

    /*
     * IMPORTANT:
     *
     * twoFactor is intentionally NOT updated here.
     *
     * 2FA will have its own secure setup,
     * verification and disable endpoints.
     */

    await user.save();

    const updatedUser = await User.findById(user._id).select(
      "-password"
    );

    res.json(updatedUser);
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

/* ==============================
UPLOAD PROFILE PHOTO
============================== */

router.post(
  "/avatar",
  protect,
  upload.single("avatar"),
  async (req, res) => {
    try {
      console.log("========== AVATAR ROUTE ==========");
      console.log("FILE:", req.file);
      console.log("USER:", req.user);

      /* CHECK FILE FIRST */

      if (!req.file) {
        return res.status(400).json({
          message: "No avatar uploaded",
        });
      }

      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      user.avatar = `/uploads/avatars/${req.file.filename}`;

      await user.save();

      console.log("Saved avatar:", user.avatar);

      res.json({
        message: "Avatar uploaded successfully",
        avatar: user.avatar,
      });
    } catch (err) {
      console.error("AVATAR ERROR:", err);

      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/* ==============================
UPLOAD KYC DOCUMENTS
============================== */

router.post(
  "/kyc",
  protect,
  kycUpload.fields([
    {
      name: "front",
      maxCount: 1,
    },
    {
      name: "back",
      maxCount: 1,
    },
  ]),
  async (req, res) => {
    try {
      console.log("========== KYC UPLOAD ==========");
      console.log("BODY:", req.body);
      console.log("FILES:", req.files);
      console.log("================================");

      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const {
        documentType,
        documentNumber,
      } = req.body;

      user.kycDocumentType = documentType;
      user.kycDocumentNumber = documentNumber;

      if (req.files?.front?.[0]) {
        user.kycDocumentFront =
          "/uploads/kyc/" +
          req.files.front[0].filename;
      }

      if (req.files?.back?.[0]) {
        user.kycDocumentBack =
          "/uploads/kyc/" +
          req.files.back[0].filename;
      }

      user.kycStatus = "Pending";
      user.kycSubmittedAt = new Date();

      await user.save();

      res.json({
        message: "KYC submitted successfully.",

        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          kycStatus: user.kycStatus,
          kycDocumentType:
            user.kycDocumentType,
          kycDocumentNumber:
            user.kycDocumentNumber,
          kycDocumentFront:
            user.kycDocumentFront,
          kycDocumentBack:
            user.kycDocumentBack,
          kycSubmittedAt:
            user.kycSubmittedAt,
          kycVerifiedAt:
            user.kycVerifiedAt,
        },
      });
    } catch (err) {
      console.error("KYC UPLOAD ERROR:", err);

      res.status(500).json({
        message: err.message,
      });
    }
  }
);

module.exports = router;

