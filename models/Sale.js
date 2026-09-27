import mongoose from "mongoose";

const saleSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: [true, "Order ID is required"],
      unique: true,
      trim: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Which colour variant was sold, if the product tracks colours.
    color: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      // Packed sits between In progress and Delivered: goods are boxed and
      // photographed for verification, but haven't left the warehouse yet
      // — so, like In progress, it has NO stock effect (see
      // inventoryService.saleStockEffect). Only Delivered deducts stock.
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
    // Snapshot of the "regular" per-unit price at the time of sale (usually
    // the product's retailPrice when the line was created, but editable —
    // e.g. if the regular price itself was a promo rate). NEVER re-derive
    // this from the Product's current retailPrice after the fact: prices
    // change over time and historical sales must keep reporting what was
    // actually true when they happened.
    unitPrice: {
      type: Number,
      required: [true, "Regular unit price is required"],
      min: 0,
    },
    // The ACTUAL total charged for this line — may be less than
    // unitPrice × quantity when a deal was negotiated (single-product
    // discount, or this line's share of a multi-product order-level
    // discount). This is the number every revenue/export/P&L calculation
    // uses — never unitPrice × quantity.
    lineTotal: {
      type: Number,
      required: [true, "Line total is required"],
      min: 0,
    },
    // Derived convenience field for reporting/export — how much less than
    // "regular price × quantity" this line actually charged. Kept in sync
    // automatically by the pre-save hook below; never set directly.
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Amount charged to the CUSTOMER for delivery — distinct from what the
    // business pays the courier (deliveryCost, below). Only ever set on
    // the FIRST line of a multi-line order (see saleController/Sales.jsx);
    // other lines from the same order keep this null so summing across
    // Sale documents doesn't multiply-count one order's delivery fee.
    // null means "not recorded" (e.g. historical data, where the old sheet
    // never tracked this separately) — 0 means "recorded as free delivery".
    // Never treat null as 0 in reporting.
    deliveryFeeCharged: {
      type: Number,
      default: null,
      min: 0,
    },
    // Actual amount PAID OUT to the delivery company — a real business
    // expense, subtracted from profit in the P&L regardless of what the
    // customer was charged. Same one-line-per-order rule as above.
    deliveryCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryPartner: {
      type: String,
      trim: true, // e.g. 'PD', 'ID', 'YG'
    },
    pointOfContact: {
      type: String,
      trim: true,
    },
    // Customer's phone number, kept separate from pointOfContact (which is
    // the customer's name) so packaging verification can fuzzy-match a
    // phone number off the package photo independently of the name.
    customerPhone: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
    },
    paidStatus: {
      type: String,
      enum: ["Paid", "Unpaid", "COD"],
      default: "COD",
    },
    // Packaging verification (see services/ocr.service.js): set together
    // when a packer confirms a photo match and the order moves to Packed.
    packagePhoto: {
      type: String, // relative path under uploads/, e.g. "packages/169..-photo.jpg"
      default: null,
    },
    packagedAt: {
      type: Date,
      default: null,
    },
    ocrText: {
      type: String,
      default: null,
    },
    ocrConfidence: {
      type: Number, // 0-100
      default: null,
    },
  },
  { timestamps: true }
);

// discount is always derived, never entered directly — keeps it correct
// even if a caller forgets to compute it (import script, migration, a
// future API client). Clamped to 0 rather than going negative in the rare
// case a line is sold ABOVE its "regular" unitPrice.
saleSchema.pre("save", function (next) {
  const regular = (this.unitPrice || 0) * (this.quantity || 0);
  this.discount = Math.max(0, regular - (this.lineTotal || 0));
  next();
});

saleSchema.index({ status: 1 });
saleSchema.index({ orderDate: -1 });

export default mongoose.model("Sale", saleSchema);
