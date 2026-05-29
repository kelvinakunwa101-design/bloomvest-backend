const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    console.log("AUTH HEADER:", authHeader); // DEBUG (keep for now)

    if (!authHeader) {
      return res.status(401).json({
        message: "Not authorized, no token",
      });
    }

    // More flexible parsing (handles extra spaces safely)
    const token = authHeader.split(" ")[1]?.trim();

    if (!token) {
      return res.status(401).json({
        message: "Not authorized, no token",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.log("AUTH ERROR:", error.message);

    return res.status(401).json({
      message: "Token failed",
    });
  }
};

module.exports = protect;