import Location from "../models/Location.js";

// GET /api/locations
export const getLocations = async (req, res) => {
  try {
    let locations = await Location.find({}).sort({ isDefault: -1, name: 1 });

    // Seed default location if database is completely empty
    if (locations.length === 0) {
      const defaultLoc = await Location.create({
        name: "Main Warehouse",
        isDefault: true,
      });
      locations = [defaultLoc];
    }

    res.json(locations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/locations
export const createLocation = async (req, res) => {
  try {
    const { name, isDefault, address } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Location name is required" });
    }

    if (isDefault) {
      await Location.updateMany({}, { isDefault: false });
    }

    const location = await Location.create({
      name: name.trim(),
      isDefault: Boolean(isDefault),
      address: String(address || "").trim(),
    });

    res.status(201).json(location);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};