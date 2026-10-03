import mongoose from "mongoose";
import Contact from "../models/Contact.js";

const normalizeName = (value) => String(value || "").trim();

const isValidContactId = (value) => {
  if (value === null || value === undefined) return false;
  const raw = String(value).trim();
  if (!raw || raw === "undefined" || raw === "null") return false;
  return mongoose.Types.ObjectId.isValid(raw);
};

const readContactId = (req, res) => {
  const rawId = req.params?.id;
  if (!isValidContactId(rawId)) {
    res.status(400).json({ message: "Contact ID is required." });
    return null;
  }

  return rawId;
};

export const listContacts = async (req, res) => {
  try {
    // Contacts are intentionally manual-only. Expense and export sheet values
    // must never be auto-materialized into the contact directory.
    const contacts = await Contact.find({ isActive: { $ne: false } })
      .sort({ name: 1 })
      .lean();

    const safeContacts = contacts.filter(
      (contact) => contact && isValidContactId(contact._id),
    );

    res.json(safeContacts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getContact = async (req, res) => {
  try {
    const contactId = readContactId(req, res);
    if (!contactId) return;

    const contact = await Contact.findById(contactId);
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
    const contactId = readContactId(req, res);
    if (!contactId) return;

    const contact = await Contact.findById(contactId);
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

    const updated = await Contact.findByIdAndUpdate(contactId, payload, {
      new: true,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteContact = async (req, res) => {
  try {
    const contactId = readContactId(req, res);
    if (!contactId) return;

    const contact = await Contact.findByIdAndDelete(contactId);
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    res.json({ message: "Contact deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
