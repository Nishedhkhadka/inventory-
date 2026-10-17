import Location from "../models/Location.js";

// GET /api/locations
export const getLocations = async (req, res) => {
  try {
    const locations = await Location.find({}).sort({ isDefault: -1, name: 1 });
    res.json(locations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/locations
export const createLocation = async (req, res) => {
  try {
    const { name, address, isDefault } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Location name is required." });
    }

    if (isDefault) {
      // Unset other defaults if this is set as default
      await Location.updateMany({}, { isDefault: false });
    }

    const location = await Location.create({
      name: name.trim(),
      address: address ? address.trim() : "",
      isDefault: Boolean(isDefault),
    });

    res.status(201).json(location);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/locations/:id
export const updateLocation = async (req, res) => {
  try {
    const { name, address, isDefault } = req.body;
    const location = await Location.findById(req.params.id);

    if (!location) {
      return res.status(404).json({ message: "Location not found." });
    }

    if (isDefault) {
      await Location.updateMany({ _id: { $ne: req.params.id } }, { isDefault: false });
    }

    if (name !== undefined) location.name = name.trim();
    if (address !== undefined) location.address = address.trim();
    if (isDefault !== undefined) location.isDefault = Boolean(isDefault);

    await location.save();
    res.json(location);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/locations/:id
export const deleteLocation = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ message: "Location not found." });
    }

    if (location.isDefault) {
      return res.status(400).json({ message: "Cannot delete the default fulfillment location. Set another location as default first." });
    }

    await location.deleteOne();
    res.json({ message: "Location deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};