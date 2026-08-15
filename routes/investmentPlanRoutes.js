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

module.exports = router;