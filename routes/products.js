import express from "express";
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductStockLog,
} from "../controllers/productController.js";
import { exportProducts } from "../controllers/exportController.js";

const router = express.Router();

router.get("/export", exportProducts);
router.route("/").get(getProducts).post(createProduct);
router.route("/:id").get(getProduct).put(updateProduct).delete(deleteProduct);
router.get("/:id/stock-log", getProductStockLog);

export default router;
