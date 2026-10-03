import express from "express";
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from "../controllers/contactController.js";

const router = express.Router();

router.get("/", listContacts);
router.post("/", createContact);
router.get("/:id", getContact);
router.put("/:id", updateContact);
router.delete("/:id", deleteContact);

export default router;
