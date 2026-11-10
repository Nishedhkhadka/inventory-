import BusinessProfile from "../models/BusinessProfile.js";

const DEFAULT_PROFILE = {
  companyName: "Zeno",
  logoUrl: "https://wsrv.nl/?url=https%3A%2F%2Fcdn.zalient.shop%2Fshops%2Fshop_1769109112_0a83031d20aaa650.png&w=1920&q=80&output=webp&we&default=1",
  panNo: "",
  phone: "",
  address: "",
  email: "",
  website: "",
  invoiceNote: "Thank you for your business.",
};

// GET /api/business-profile
export const getBusinessProfile = async (req, res) => {
  try {
    let profile = await BusinessProfile.findOne();
    if (!profile) {
      profile = await BusinessProfile.create(DEFAULT_PROFILE);
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/business-profile (admin/authorized)
export const updateBusinessProfile = async (req, res) => {
  try {
    let profile = await BusinessProfile.findOne();
    if (!profile) {
      profile = new BusinessProfile(req.body);
    } else {
      Object.assign(profile, req.body);
    }
    await profile.save();
    res.json(profile);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};