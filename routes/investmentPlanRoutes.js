const express = require("express");
const router = express.Router();

const InvestmentPlan = require("../models/InvestmentPlan");

/*
==================================
GET ALL ACTIVE PLANS
==================================
*/

router.get("/", async (req, res) => {
  try {
    const plans = await InvestmentPlan.find({
      active: true,
    }).sort({ minimumAmount: 1 });

    res.json(plans);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
==================================
CREATE PLAN
==================================
*/

router.post("/", async (req, res) => {
  try {
    const plan = await InvestmentPlan.create(req.body);

    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({
      message: err.message,
    });
  }
});

/*
====================================
SEED DEFAULT PLANS
====================================
*/
router.post("/seed", async (req, res) => {
  try {
    const existingPlans = await InvestmentPlan.countDocuments();

    if (existingPlans > 0) {
      return res.json({
        message: "Investment plans already exist.",
      });
    }

    const plans = [
      {
        name: "Starter Plan",
        returnRate: 8,
        duration: 30,
        minimumAmount: 50000,
        risk: "Low",
        color: "#2563EB",
      },
      {
        name: "Growth Plan",
        returnRate: 15,
        duration: 90,
        minimumAmount: 200000,
        risk: "Medium",
        color: "#10B981",
      },
      {
        name: "Premium Plan",
        returnRate: 22,
        duration: 180,
        minimumAmount: 1000000,
        risk: "High",
        color: "#7C3AED",
      },
    ];

    await InvestmentPlan.insertMany(plans);

    res.json({
      message: "Investment plans created successfully.",
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

module.exports = router;