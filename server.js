import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";

import productRoutes from "./routes/products.js";
import saleRoutes from "./routes/sales.js";
import purchaseRoutes from "./routes/purchases.js";
import analyticsRoutes from "./routes/analytics.js";
import searchRoutes from "./routes/search.js";
import importRoutes from "./routes/import.js";
import packagingRoutes from "./routes/packaging.routes.js";
import exportRoutes from "./routes/export.js";
import authRoutes from "./routes/auth.js";
import { protect } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();
connectDB();

const app = express();

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Package verification photos, e.g. GET /uploads/packages/169..-photo.jpg
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Login is public; everything else under /api/auth (current user, user
// management) requires a token, enforced route-by-route inside auth.js.
app.use("/api/auth", authRoutes);

// Every other /api/* route requires a valid, logged-in session.
app.use("/api", protect);

app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/import", importRoutes);
app.use("/api/packaging", packagingRoutes);
app.use("/api/export", exportRoutes);

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`[server] Zeno API running on port ${PORT}`));
