require("dotenv").config();

const mongoose = require("mongoose");

const USER_ID = "69d10373997905d08756ca90";

async function cleanup() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected.");
    console.log("Database:", mongoose.connection.name);

    const collection = mongoose.connection.db.collection("investments");

    // Find ONLY the five legacy investment records.
    // These old records use active:true instead of status:"active"
    // and are missing the newer investment fields.
    const brokenInvestments = await collection
      .find({
        user: new mongoose.Types.ObjectId(USER_ID),
        active: true,
        status: { $exists: false },
        expectedProfit: { $exists: false },
        currentValue: { $exists: false },
        maturityDate: { $exists: false },
      })
      .toArray();

    console.log(
      `Legacy investments found: ${brokenInvestments.length}`
    );

    if (brokenInvestments.length === 0) {
      console.log("Nothing to delete.");
      return;
    }

    console.table(
      brokenInvestments.map((investment) => ({
        id: investment._id.toString(),
        plan: investment.plan,
        amount: investment.amount,
        profitRate: investment.profitRate,
        duration: investment.duration,
        active: investment.active,
        createdAt: investment.createdAt,
      }))
    );

    const result = await collection.deleteMany({
      user: new mongoose.Types.ObjectId(USER_ID),
      active: true,
      status: { $exists: false },
      expectedProfit: { $exists: false },
      currentValue: { $exists: false },
      maturityDate: { $exists: false },
    });

    console.log(`DELETED: ${result.deletedCount}`);
  } catch (error) {
    console.error("CLEANUP ERROR:", error);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  }
}

cleanup();