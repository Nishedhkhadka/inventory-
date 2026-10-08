import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Location name is required"],
      trim: true,
      unique: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

locationSchema.index({ name: 1, isDefault: 1 });

export default mongoose.model("Location", locationSchema);