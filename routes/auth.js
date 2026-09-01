const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const {
  generateSecret,
  generateURI,
  verify,
} = require("otplib");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================================================
   SECURITY CONFIG
========================================================= */

const JWT_EXPIRES_IN = "7d";
const TWO_FACTOR_CHALLENGE_EXPIRES_IN = "5m";

const ACCESS_TOKEN_TYPE = "access";
const TWO_FACTOR_CHALLENGE_TYPE = "2fa-challenge";
const TWO_FACTOR_PURPOSE = "2fa-login";

/* =========================================================
   HELPERS
========================================================= */

const validateJWTSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
};

/* =========================================================
   ACCOUNT NUMBER
========================================================= */

const generateAccountNumber = () => {
  return Math.floor(
    1000000000 + Math.random() * 9000000000
  ).toString();
};

/* =========================================================
   BLOOMVEST ID
========================================================= */

const generateBloomVestId = () => {
  return (
    "BV-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
};

/* =========================================================
   USER RESPONSE
========================================================= */

const buildUserResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  accountNumber: user.accountNumber,
  investorId: user.investorId,
  investorTier: user.investorTier,
  kycStatus: user.kycStatus,
  twoFactor: user.twoFactor,
  twoFactorVerified: user.twoFactorVerified,
});

/* =========================================================
   REGISTER
========================================================= */

router.post("/register", async (req, res) => {
  const session = await mongoose.startSession();

  try {
    validateJWTSecret();

    const {
      name,
      email,
      password,
    } = req.body;

    /* ==============================
       VALIDATION
    ============================== */

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill all fields",
      });
    }

    const cleanName = String(name).trim();

    const cleanEmail = String(email)
      .trim()
      .toLowerCase();

    if (cleanName.length < 2) {
      return res.status(400).json({
        message: "Please enter a valid name",
      });
    }

    if (cleanEmail.length > 254) {
      return res.status(400).json({
        message: "Please enter a valid email address",
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters",
      });
    }

    /* ==============================
       CREATE USER + WALLET ATOMICALLY
    ============================== */

    let user;

    await session.withTransaction(async () => {
      const existingUser = await User.findOne({
        email: cleanEmail,
      }).session(session);

      if (existingUser) {
        throw new Error("User already exists");
      }

      const salt = await bcrypt.genSalt(10);

      const hashedPassword = await bcrypt.hash(
        password,
        salt
      );

      const createdUsers = await User.create(
        [
          {
            name: cleanName,
            email: cleanEmail,
            password: hashedPassword,

            accountNumber:
              generateAccountNumber(),

            investorId:
              generateBloomVestId(),

            investorTier: "Silver",
            kycStatus: "Pending",
            role: "user",
          },
        ],
        {
          session,
        }
      );

      user = createdUsers[0];

      await Wallet.create(
        [
          {
            user: user._id,
            balance: 0,
          },
        ],
        {
          session,
        }
      );
    });

    /* ==============================
       GENERATE ACCESS TOKEN
    ============================== */

    const token = jwt.sign(
      {
        id: user._id.toString(),
        role: user.role,
        type: ACCESS_TOKEN_TYPE,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
      }
    );

    /* ==============================
       RESPONSE
    ============================== */

    return res.status(201).json({
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error(
      "REGISTER ERROR:",
      error.message
    );

    if (
      error.message ===
      "User already exists"
    ) {
      return res.status(400).json({
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Registration failed",
    });
  } finally {
    await session.endSession();
  }
});

/* =========================================================
   LOGIN
========================================================= */

router.post("/login", async (req, res) => {
  try {
    validateJWTSecret();

    const {
      email,
      password,
    } = req.body;

    /* ==============================
       VALIDATION
    ============================== */

    if (!email || !password) {
      return res.status(400).json({
        message:
          "Please enter email and password",
      });
    }

    const cleanEmail = String(email)
      .trim()
      .toLowerCase();

    /* ==============================
       FIND USER
    ============================== */

    const user = await User.findOne({
      email: cleanEmail,
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    /* ==============================
       CHECK PASSWORD
    ============================== */

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    /* =====================================================
       2FA LOGIN CHALLENGE
    ===================================================== */

    if (
      user.twoFactor === true &&
      user.twoFactorVerified === true
    ) {
      const twoFactorChallenge = jwt.sign(
        {
          id: user._id.toString(),

          type: TWO_FACTOR_CHALLENGE_TYPE,

          purpose: TWO_FACTOR_PURPOSE,
        },
        process.env.JWT_SECRET,
        {
          expiresIn:
            TWO_FACTOR_CHALLENGE_EXPIRES_IN,
        }
      );

      return res.json({
        requiresTwoFactor: true,
        twoFactorChallenge,

        message:
          "Two-factor authentication required",
      });
    }

    /* =====================================================
       NORMAL ACCESS TOKEN
    ===================================================== */

    const token = jwt.sign(
      {
        id: user._id.toString(),
        role: user.role,
        type: ACCESS_TOKEN_TYPE,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
      }
    );

    /* ==============================
       SUCCESS RESPONSE
    ============================== */

    return res.json({
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error(
      "LOGIN ERROR:",
      error.message
    );

    return res.status(500).json({
      message: "Login failed",
    });
  }
});

/* =========================================================
   2FA SETUP
========================================================= */

router.post(
  "/2fa/setup",
  protect,
  async (req, res) => {
    try {
      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      if (
        user.twoFactor === true &&
        user.twoFactorVerified === true
      ) {
        return res.status(400).json({
          message:
            "Two-factor authentication is already enabled",
        });
      }

      const secret = generateSecret();

      user.twoFactorSecret = secret;
      user.twoFactorVerified = false;

      await user.save();

      const uri = generateURI({
        issuer: "BloomVest",
        label: user.email,
        secret,
      });

      return res.json({
        message: "2FA setup initiated",
        secret,
        uri,
      });
    } catch (error) {
      console.error(
        "2FA SETUP ERROR:",
        error.message
      );

      return res.status(500).json({
        message:
          "Failed to setup two-factor authentication",
      });
    }
  }
);

/* =========================================================
   2FA SETUP CONFIRM
========================================================= */

router.post(
  "/2fa/setup/confirm",
  protect,
  async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          message:
            "Verification code is required",
        });
      }

      const verificationToken =
        String(token).trim();

      if (!/^\d{6}$/.test(verificationToken)) {
        return res.status(400).json({
          message:
            "Verification code must be 6 digits",
        });
      }

      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      if (!user.twoFactorSecret) {
        return res.status(400).json({
          message:
            "2FA setup has not been initiated",
        });
      }

      const result = await verify({
        secret: user.twoFactorSecret,
        token: verificationToken,
      });

      if (!result.valid) {
        return res.status(401).json({
          message:
            "Invalid verification code",
        });
      }

      user.twoFactor = true;
      user.twoFactorVerified = true;

      await user.save();

      return res.json({
        message:
          "Two-factor authentication enabled successfully",

        twoFactor: user.twoFactor,

        twoFactorVerified:
          user.twoFactorVerified,
      });
    } catch (error) {
      console.error(
        "2FA SETUP CONFIRM ERROR:",
        error.message
      );

      return res.status(500).json({
        message:
          "Failed to confirm two-factor authentication",
      });
    }
  }
);

/* =========================================================
   2FA LOGIN VERIFY
========================================================= */

router.post(
  "/2fa/verify",
  async (req, res) => {
    try {
      validateJWTSecret();

      const {
        twoFactorChallenge,
        token,
      } = req.body;

      if (
        !twoFactorChallenge ||
        !token
      ) {
        return res.status(400).json({
          message:
            "2FA challenge and verification code are required",
        });
      }

      const verificationToken =
        String(token).trim();

      if (!/^\d{6}$/.test(verificationToken)) {
        return res.status(400).json({
          message:
            "Verification code must be 6 digits",
        });
      }

      let decodedChallenge;

      try {
        decodedChallenge = jwt.verify(
          twoFactorChallenge,
          process.env.JWT_SECRET
        );
      } catch (error) {
        if (
          error.name ===
          "TokenExpiredError"
        ) {
          return res.status(401).json({
            message:
              "2FA session expired. Please login again.",
          });
        }

        return res.status(401).json({
          message:
            "Invalid 2FA session",
        });
      }

      if (
        decodedChallenge.type !==
        TWO_FACTOR_CHALLENGE_TYPE
      ) {
        return res.status(401).json({
          message:
            "Invalid 2FA session",
        });
      }

      if (
        decodedChallenge.purpose !==
        TWO_FACTOR_PURPOSE
      ) {
        return res.status(401).json({
          message:
            "Invalid 2FA session",
        });
      }

      if (
        !decodedChallenge.id ||
        !mongoose.Types.ObjectId.isValid(
          decodedChallenge.id
        )
      ) {
        return res.status(401).json({
          message:
            "Invalid verification request",
        });
      }

      const user = await User.findById(
        decodedChallenge.id
      );

      if (!user) {
        return res.status(401).json({
          message:
            "Invalid verification request",
        });
      }

      if (
        user.twoFactor !== true ||
        user.twoFactorVerified !== true ||
        !user.twoFactorSecret
      ) {
        return res.status(400).json({
          message:
            "Two-factor authentication is not properly configured",
        });
      }

      const result = await verify({
        secret: user.twoFactorSecret,
        token: verificationToken,
      });

      if (!result.valid) {
        return res.status(401).json({
          message:
            "Invalid verification code",
        });
      }

      const jwtToken = jwt.sign(
        {
          id: user._id.toString(),
          role: user.role,
          type: ACCESS_TOKEN_TYPE,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: JWT_EXPIRES_IN,
        }
      );

      return res.json({
        message:
          "Two-factor authentication verified successfully",

        token: jwtToken,

        user: buildUserResponse(user),
      });
    } catch (error) {
      console.error(
        "2FA VERIFY ERROR:",
        error.message
      );

      return res.status(500).json({
        message:
          "Two-factor verification failed",
      });
    }
  }
);

module.exports = router;