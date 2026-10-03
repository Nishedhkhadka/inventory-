import Contact from "../models/Contact.js";
import Purchase from "../models/Purchase.js";

const normalizeName = (value) => String(value || "").trim();

export const listContacts = async (req, res) => {
  try {
    const supplierGroups = await Purchase.aggregate([
      { $match: { supplier: { $exists: true, $ne: "" } } },
      {
        $group: {
          _id: "$supplier",
          totalPurchases: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ["$cost", 0] } },
          lastOrderDate: { $max: "$orderDate" },
          pending: {
            $sum: {
              $cond: [{ $ne: ["$status", "Paid"] }, 1, 0],
            },
          },
          paid: {
            $sum: {
              $cond: [{ $eq: ["$status", "Paid"] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          totalPurchases: 1,
          totalSpent: 1,
          lastOrderDate: 1,
          pending: 1,
          paid: 1,
        },
      },
      { $sort: { lastOrderDate: -1, totalSpent: -1 } },
    ]);

    const namedSuppliers = supplierGroups.map((group) => group.name);
    const contacts = await Contact.find({
      name: { $in: namedSuppliers.length ? namedSuppliers : ["__none__"] },
    }).lean();

    const contactByName = new Map(
      contacts.map((contact) => [
        String(contact.name).trim().toLowerCase(),
        contact,
      ]),
    );

    const merged = supplierGroups.map((group) => {
      const contact = contactByName.get(
        String(group.name).trim().toLowerCase(),
      );
      return {
        ...contact,
        _id: contact?._id || group._id,
        name: group.name,
        totalPurchases: group.totalPurchases || 0,
        totalSpent: group.totalSpent || 0,
        lastOrderDate: group.lastOrderDate || null,
        pending: group.pending || 0,
        paid: group.paid || 0,
        company: contact?.company || "",
        phone: contact?.phone || "",
        email: contact?.email || "",
        address: contact?.address || "",
        notes: contact?.notes || "",
        category: contact?.category || "Supplier",
      };
    });

    const extraContacts = await Contact.find({
      name: { $nin: namedSuppliers.length ? namedSuppliers : ["__none__"] },
      isActive: { $ne: false },
    })
      .sort({ name: 1 })
      .lean();

    const extraRows = extraContacts.map((contact) => ({
      ...contact,
      totalPurchases: 0,
      totalSpent: 0,
      lastOrderDate: null,
      pending: 0,
      paid: 0,
    }));

    res.json(
      [...merged, ...extraRows].sort((a, b) => a.name.localeCompare(b.name)),
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getContact = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    res.json(contact);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createContact = async (req, res) => {
  try {
    const name = normalizeName(req.body.name);
    if (!name)
      return res.status(400).json({ message: "Contact name is required" });

    const contact = await Contact.findOneAndUpdate(
      { name },
      {
        ...req.body,
        name,
        company: normalizeName(req.body.company),
        phone: normalizeName(req.body.phone),
        email: normalizeName(req.body.email),
        address: normalizeName(req.body.address),
        notes: normalizeName(req.body.notes),
        category: req.body.category || "Supplier",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(201).json(contact);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const updateContact = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ message: "Contact not found" });

    const nextName = normalizeName(req.body.name || contact.name);
    if (!nextName)
      return res.status(400).json({ message: "Contact name is required" });

    const payload = {
      ...contact.toObject(),
      ...req.body,
      name: nextName,
      company: normalizeName(req.body.company ?? contact.company),
      phone: normalizeName(req.body.phone ?? contact.phone),
      email: normalizeName(req.body.email ?? contact.email),
      address: normalizeName(req.body.address ?? contact.address),
      notes: normalizeName(req.body.notes ?? contact.notes),
      category: req.body.category || contact.category,
    };

    const updated = await Contact.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    res.json({ message: "Contact deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
