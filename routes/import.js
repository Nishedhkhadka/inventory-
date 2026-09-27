import express from "express";
import multer from "multer";
import {
  importWorkbook,
  backfillDeliveryCostsFromSheet,
  backfillPurchaseStatusesFromSheet,
  resyncStockFromSheet,
} from "../controllers/importController.js";

// Memory storage: the workbook is small (a business ledger, not a media
// file) and only needs to live long enough to be parsed by XLSX, so there's
// no need to touch disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB is generous headroom for a ledger workbook
});

const router = express.Router();

router.post("/", upload.single("file"), importWorkbook);
router.post("/backfill-delivery-costs", upload.single("file"), backfillDeliveryCostsFromSheet);
router.post("/backfill-purchase-statuses", upload.single("file"), backfillPurchaseStatusesFromSheet);
router.post("/resync-stock", upload.single("file"), resyncStockFromSheet);

export default router;
