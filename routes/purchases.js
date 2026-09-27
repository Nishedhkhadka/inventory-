import express from "express";
import {
  getPurchases,
  getPurchase,
  createPurchase,
  updatePurchase,
  deletePurchase,
  getPurchaseTags,
  getPurchaseCategories,
} from "../controllers/purchaseController.js";
import { exportPurchases } from "../controllers/exportController.js";

const router = express.Router();

router.get("/export", exportPurchases);
router.get("/tags", getPurchaseTags);
router.get("/categories", getPurchaseCategories);
router.route("/").get(getPurchases).post(createPurchase);
router.route("/:id").get(getPurchase).put(updatePurchase).delete(deletePurchase);

export default router;
