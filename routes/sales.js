import express from "express";
import {
  getSales,
  getSale,
  createSale,
  updateSale,
  deleteSale,
  getSaleLogs, // <-- Import the audit log handler
} from "../controllers/saleController.js";
import { exportSales } from "../controllers/exportController.js";

const router = express.Router();

router.get("/export", exportSales);
router.route("/").get(getSales).post(createSale);
router.get("/:id/logs", getSaleLogs); // <-- New audit log route
router.route("/:id").get(getSale).put(updateSale).delete(deleteSale);

export default router;