import express from "express";
import { getSummary, getPnL } from "../controllers/analyticsController.js";
import { exportPnL } from "../controllers/exportController.js";
import { adminOnly } from "../middleware/auth.js";

const router = express.Router();

// Revenue/expense/profit figures are admin-only — a "user" role account
// gets a simplified dashboard (see frontend Dashboard.jsx) built from
// operational endpoints like /api/packaging/pending and
// /api/products?lowStockOnly=true instead, which stay open to any
// logged-in user since they're operational, not financial.
router.get("/summary", adminOnly, getSummary);
router.get("/pnl", adminOnly, getPnL);
router.get("/pnl/export", adminOnly, exportPnL);

export default router;
