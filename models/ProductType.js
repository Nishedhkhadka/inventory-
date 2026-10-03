import mongoose from "mongoose";

const productTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Type name is required"],
      trim: true,
      unique: true,
    },
  },
  { timestamps: true },
);

productTypeSchema.index({ name: 1 });

export default mongoose.model("ProductType", productTypeSchema);
