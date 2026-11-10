import mongoose from "mongoose";

const businessProfileSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: "Zeno" },
    logoUrl: { type: String, default: "" },
    panNo: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },
    invoiceNote: { type: String, default: "Thank you for your business." },
  },
  { timestamps: true }
);

export default mongoose.model("BusinessProfile", businessProfileSchema);