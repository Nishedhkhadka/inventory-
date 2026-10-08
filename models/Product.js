import mongoose from "mongoose";

const colorVariantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    stock: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const locationStockSchema = new mongoose.Schema(
  {
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    color: {
      type: String,
      default: "",
      trim: true,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
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
      sparse: true,
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    retailPrice: {
      type: Number,
      required: [true, "Retail price is required"],
      min: 0,
    },
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
    locationStocks: {
      type: [locationStockSchema],
      default: [],
    },
  },
  { timestamps: true },
);

productSchema.virtual("isLowStock").get(function () {
  return this.currentStock <= this.lowStockAlert;
});

productSchema.pre("save", function (next) {
  if (this.colors && this.colors.length > 0) {
    this.currentStock = this.colors.reduce((sum, c) => sum + (c.stock || 0), 0);
  }
  next();
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

export default mongoose.model("Product", productSchema);