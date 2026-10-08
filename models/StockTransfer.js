import mongoose from "mongoose";

const stockTransferSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    color: {
      type: String,
      default: "",
      trim: true,
    },
    fromLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    toLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

stockTransferSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("StockTransfer", stockTransferSchema);