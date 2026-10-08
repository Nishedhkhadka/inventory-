import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Location =
  mongoose.models.Location || mongoose.model("Location", locationSchema);

export default Location;