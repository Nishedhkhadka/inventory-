import mongoose from "mongoose";

// One row per manual stock edit made from the Inventory page (NOT for
// automatic changes from Sales/Expenses — those already have their own
// audit trail in the form of the Sale/Purchase documents themselves).
// This exists so "why is the count 40 and not 45?" always has an answer.
const stockLogSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    previousStock: {
      type: Number,
      required: true,
    },
    newStock: {
      type: Number,
      required: true,
    },
    delta: {
      type: Number,
      required: true,
    },
    comment: {
      type: String,
      required: [true, "A reason for the stock change is required"],
      trim: true,
    },
  },
  { timestamps: true }
);

stockLogSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("StockLog", stockLogSchema);
