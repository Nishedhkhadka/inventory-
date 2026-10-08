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

productSchema.pre("save", async function (next) {
  // Sync aggregate currentStock with colors sum
  if (this.colors && this.colors.length > 0) {
    this.currentStock = this.colors.reduce((sum, c) => sum + (c.stock || 0), 0);
  }

  // Populate default location stock array if empty on creation
  if (this.isNew && (!this.locationStocks || this.locationStocks.length === 0)) {
    try {
      const Location = mongoose.model("Location");
      let defaultLoc = await Location.findOne({ isDefault: true });

      if (!defaultLoc) {
        defaultLoc = await Location.create({
          name: "Main Warehouse",
          isDefault: true,
        });
      }

      if (this.colors && this.colors.length > 0) {
        this.locationStocks = this.colors.map((c) => ({
          location: defaultLoc._id,
          color: c.name,
          stock: c.stock || 0,
        }));
      } else {
        this.locationStocks = [
          {
            location: defaultLoc._id,
            color: "",
            stock: this.currentStock || 0,
          },
        ];
      }
    } catch (e) {
      console.error("Failed to seed location stock on product creation:", e);
    }
  }

  next();
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

export default mongoose.models.Product || mongoose.model("Product", productSchema);