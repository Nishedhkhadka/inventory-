import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    // Order/reference number from the source ledger, if any (not unique —
    // a single order can span several line items).
    orderRef: {
      type: String,
      trim: true,
    },
    // Set when this expense is a physical inventory purchase tied to a
    // catalog product (drives automatic restocking). Left null for
    // non-inventory expenses (Meta Ads, Packaging, Shipping, Salaries...).
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    // Which colour variant this purchase restocks, if the product tracks
    // colours. Ignored for products without variants.
    color: {
      type: String,
      trim: true,
      default: null,
    },
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    status: {
      // Only two states: goods (or the expense itself) are either still on
      // order, or have actually landed/been paid — "Delivered" is what
      // triggers the automatic stock credit for inventory purchases.
      type: String,
      enum: ["Ordered", "Delivered"],
      default: "Ordered",
    },
    quantity: {
      type: Number,
      min: 0,
    },
    orderDate: {
      type: Date,
    },
    arriveBy: {
      type: Date,
    },
    cost: {
      type: Number,
      required: [true, "Total landed cost is required"],
      min: 0,
    },
    category: {
      // Drives the Expense Breakdown analytics endpoint. Free text rather
      // than an enum so new categories can be added from the Expenses page
      // — GET /api/purchases/categories lists the distinct values in use
      // for the frontend's suggestion dropdown.
      type: String,
      trim: true,
      default: "Inventory",
    },
    supplier: {
      type: String,
      trim: true, // e.g. 'All Seller Import Export', 'Sabitri Trade'
    },
    notes: {
      type: String,
      trim: true,
    },
    weightCbm: {
      type: String,
      trim: true,
    },
    // Freeform labels for sorting/filtering expenses beyond the fixed
    // category list — e.g. "Q3 restock", "urgent", "supplier-A".
    tags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

purchaseSchema.index({ status: 1 });
purchaseSchema.index({ category: 1 });
purchaseSchema.index({ tags: 1 });

export default mongoose.model("Purchase", purchaseSchema);
