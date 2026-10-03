import express from "express";
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductStockLog,
  getProductTypes,
  createProductType,
  deleteProductType,
} from "../controllers/productController.js";
import { exportProducts } from "../controllers/exportController.js";

const router = express.Router();

router.get("/export", exportProducts);
router.get("/types", getProductTypes);
router.post("/types", createProductType);
router.delete("/types/:typeName", deleteProductType);
router.route("/").get(getProducts).post(createProduct);
router.route("/:id").get(getProduct).put(updateProduct).delete(deleteProduct);
router.get("/:id/stock-log", getProductStockLog);

export default router;
