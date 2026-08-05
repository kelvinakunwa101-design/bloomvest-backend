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
  console.log("CURRENT USER:", req.user);

  res.json(req.user);
});

/* ==========================
   UPDATE PROFILE
========================== */

router.put("/me", protect, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      occupation,
      country,
      state,
      city,
    } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    user.name = name ?? user.name;
    user.email = email ?? user.email;
    user.phone = phone ?? user.phone;
    user.occupation = occupation ?? user.occupation;
    user.country = country ?? user.country;
    user.state = state ?? user.state;
    user.city = city ?? user.city;

    await user.save();

    res.json(user);
  } catch (err) {
    console.error(err);

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
      console.error(err);

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
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const { documentType, documentNumber } = req.body;

      user.kycDocumentType = documentType;
      user.kycDocumentNumber = documentNumber;

      if (req.files.front) {
        user.kycDocumentFront =
          "/uploads/kyc/" + req.files.front[0].filename;
      }

      if (req.files.back) {
        user.kycDocumentBack =
          "/uploads/kyc/" + req.files.back[0].filename;
      }

      user.kycStatus = "Pending";
      user.kycSubmittedAt = new Date();

      await user.save();

      res.json({
        message: "KYC submitted successfully.",
        user,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        message: err.message,
      });
    }
  }
);
module.exports = router;