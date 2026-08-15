const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");

const Notification = require("../models/Notification");

// Get notifications
router.get("/", protect, async (req, res) => {
  const notifications = await Notification.find({
    user: req.user.id,
  }).sort({ createdAt: -1 });

  res.json(notifications);
});

// Mark all as read
router.put("/read", protect, async (req, res) => {
  await Notification.updateMany(
    {
      user: req.user.id,
    },
    {
      read: true,
    }
  );

  res.json({
    message: "Notifications updated",
  });
});

module.exports = router;