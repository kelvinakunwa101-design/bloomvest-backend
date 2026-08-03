const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const path = require("path");
const protect = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");
const User = require("../models/User");

/* ==============================
   GET USER PROFILE
============================== */
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json(user);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

/* ==============================
   UPDATE USER PROFILE
============================== */
router.put("/profile", protect, async (req, res) => {
  try {
    const {
      name,
      email,
      emailNotifications,
      smsNotifications,
      twoFactor,
      darkMode,
    } = req.body;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;

    if (emailNotifications !== undefined)
      user.emailNotifications = emailNotifications;

    if (smsNotifications !== undefined)
      user.smsNotifications = smsNotifications;

    if (twoFactor !== undefined)
      user.twoFactor = twoFactor;

    if (darkMode !== undefined)
      user.darkMode = darkMode;

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

/* ==============================
   UPLOAD AVATAR
============================== */
router.post(
  "/avatar",
  protect,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "No image uploaded",
        });
      }

      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      user.avatar = `/uploads/${req.file.filename}`;

      await user.save();

      res.json({
        message: "Avatar uploaded successfully",
        avatar: user.avatar,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        message: "Upload failed",
      });
    }
  }
);
/* ==============================
   CHANGE PASSWORD
============================== */
router.put("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Both passwords are required",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const passwordMatch = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!passwordMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const salt = await bcrypt.genSalt(10);

    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.json({
      message: "Password changed successfully",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;