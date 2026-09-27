import express from "express";
import { login, me, listUsers, createUser, deleteUser, resetPassword } from "../controllers/authController.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// Public
router.post("/login", login);

// Any authenticated user
router.get("/me", protect, me);

// Admin only — user management
router.get("/users", protect, adminOnly, listUsers);
router.post("/users", protect, adminOnly, createUser);
router.delete("/users/:id", protect, adminOnly, deleteUser);
router.put("/users/:id/password", protect, adminOnly, resetPassword);

export default router;
