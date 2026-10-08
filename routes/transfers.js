import express from "express";
import {
  transferStock,
  getStockTransfers,
} from "../controllers/transferController.js";

const router = express.Router();

router.route("/").post(transferStock);
router.route("/:productId").get(getStockTransfers);

export default router;