import XLSX from "xlsx";
import {
  runExcelImport,
  backfillDeliveryCosts,
  backfillPurchaseStatuses,
  resyncStockFromInventorySheet,
} from "../services/excelImportService.js";

function readUploadedWorkbook(req) {
  if (!req.file) {
    const err = new Error('No file uploaded. Attach an .xlsx file as "file".');
    err.status = 400;
    throw err;
  }
  try {
    return XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    const wrapped = new Error(`Could not read that file as an Excel workbook: ${err.message}`);
    wrapped.status = 400;
    throw wrapped;
  }
}

// POST /api/import  (multipart/form-data, field name "file")
// Body also accepts `reset=true` to wipe Product/Purchase/Sale first — off
// by default so re-uploading a workbook only adds what's new.
// Everything imported lands as ordinary documents in the same collections
// the rest of the app reads/writes, so it's immediately visible and
// editable from Inventory / Sales / Expenses — no separate preview step.
export const importWorkbook = async (req, res) => {
  try {
    const workbook = readUploadedWorkbook(req);
    const reset = String(req.body.reset).toLowerCase() === "true";
    const stats = await runExcelImport(workbook, { reset });
    res.json({ message: "Import complete", stats });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// POST /api/import/backfill-delivery-costs  (multipart/form-data, field "file")
// For a re-exported sheet with corrected delivery cost values: matches
// each Sales row to its existing Sale by Order ID and patches only
// deliveryCost (the amount paid to the courier — never deliveryFeeCharged,
// the customer-facing amount, which the sheet has never recorded).
// Doesn't touch any other field, and never creates, duplicates, or
// deletes a Sale.
export const backfillDeliveryCostsFromSheet = async (req, res) => {
  try {
    const workbook = readUploadedWorkbook(req);
    const result = await backfillDeliveryCosts(workbook);
    res.json({ message: "Delivery cost backfill complete", result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// POST /api/import/backfill-purchase-statuses  (multipart/form-data, field "file")
// Fixes purchases imported before Approved/Dispatched sheet statuses were
// recognized (they were wrongly treated as Ordered). Corrects the status
// label only — does NOT touch stock; use backfill-stock-from-inventory
// below for that. See excelImportService.backfillPurchaseStatuses.
export const backfillPurchaseStatusesFromSheet = async (req, res) => {
  try {
    const workbook = readUploadedWorkbook(req);
    const result = await backfillPurchaseStatuses(workbook);
    res.json({ message: "Purchase status backfill complete", result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// POST /api/import/resync-stock  (multipart/form-data, field "file")
// Fixes stock counts thrown off by the historical double-deduction bug —
// see excelImportService.resyncStockFromInventorySheet. Overwrites
// currentStock directly from the Inventory sheet's Stock column.
export const resyncStockFromSheet = async (req, res) => {
  try {
    const workbook = readUploadedWorkbook(req);
    const result = await resyncStockFromInventorySheet(workbook);
    res.json({ message: "Stock resync complete", result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
