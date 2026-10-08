import mongoose from "mongoose";

const saleSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    billNo: {
      type: String,
      trim: true,
      sparse: true,
      uppercase: true,
    },
    billIssued: {
      type: Boolean,
      default: false,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    color: {
      type: String,
      trim: true,
    },
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
    },
    status: {
      type: String,
      enum: ["In progress", "Packed", "Delivered", "Returned", "Damaged"],
      default: "In progress",
    },
    orderDate: {
      type: Date,
      default: Date.now,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryFeeCharged: {
      type: Number,
      default: null,
      min: 0,
    },
    deliveryPartner: {
      type: String,
      trim: true,
    },
    pointOfContact: {
      type: String,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    paidStatus: {
      type: String,
      enum: ["COD", "Paid", "Unpaid"],
      default: "COD",
    },
  },
  { timestamps: true }
);

saleSchema.index({ orderDate: -1, orderId: 1 });

export default mongoose.model("Sale", saleSchema);