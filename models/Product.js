import mongoose from "mongoose";

// A colour variant of a product. When a product has one or more of these,
// stock is tracked per-colour and currentStock is kept as their sum.
// Products with no variants just use currentStock directly.
const colorVariantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    stock: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true, // allows multiple docs with no sku while still enforcing uniqueness when present
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: ["Lamp", "Wallet", "Pouch", "Decor", "Packaging"],
      required: true,
    },
    retailPrice: {
      type: Number,
      required: [true, "Retail price is required"],
      min: 0,
    },
    // Average landed/procurement cost per unit — drives the P&L's cost of
    // goods sold. Optional; defaults to 0 until purchases fill it in.
    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    lowStockAlert: {
      type: Number,
      default: 5,
      min: 0,
    },
    colors: {
      type: [colorVariantSchema],
      default: [],
    },
  },
  { timestamps: true }
);

productSchema.virtual("isLowStock").get(function () {
  return this.currentStock <= this.lowStockAlert;
});

// Keep currentStock in sync with the colour breakdown whenever a product
// that tracks colours is saved directly (bulk $inc updates bypass this and
// touch currentStock/colors.$.stock together instead — see inventoryService).
productSchema.pre("save", function (next) {
  if (this.colors && this.colors.length > 0) {
    this.currentStock = this.colors.reduce((sum, c) => sum + (c.stock || 0), 0);
  }
  next();
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

export default mongoose.model("Product", productSchema);
