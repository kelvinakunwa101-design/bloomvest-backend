const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

/* ==============================
   REGISTER
============================== */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    /* VALIDATION */
    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill all fields",
      });
    }

    /* CHECK USER */
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    /* HASH PASSWORD */
    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(
      password,
      salt
    );

    /* CREATE USER */
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    /* TOKEN */
    const token = jwt.sign(
      {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    /* RESPONSE */
    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.log("REGISTER ERROR:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
});

/* ==============================
   LOGIN
============================== */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    /* VALIDATION */
    if (!email || !password) {
      return res.status(400).json({
        message: "Please enter email and password",
      });
    }

    /* FIND USER */
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    /* CHECK PASSWORD */
    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    /* GENERATE TOKEN */
    const token = jwt.sign(
      {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    /* SUCCESS RESPONSE */
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.log("LOGIN ERROR:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;