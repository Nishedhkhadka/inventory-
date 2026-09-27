/**
 * Zeno ledger migration script (CLI)
 * ─────────────────────────────
 * Reads the existing "Zeno (16).xlsx" business workbook and seeds MongoDB:
 *   1. Inventory sheet  -> Product collection   (seeded FIRST — everything
 *                                                 else references it. Its
 *                                                 Stock column is treated
 *                                                 as the already-reconciled
 *                                                 current count.)
 *   2. Purchase sheet   -> Purchase collection  (expenses; inventory-category
 *                                                 rows are linked to a Product.
 *                                                 Does NOT touch stock.)
 *   3. Sales sheet      -> Sale collection      (linked to Product. Does NOT
 *                                                 touch stock either — see
 *                                                 excelImportService.js for
 *                                                 why.)
 *
 * Usage:
 *   node scripts/importFromExcel.js [path/to/workbook.xlsx] [--reset]
 *
 *   --reset     Wipe existing Product/Purchase/Sale collections first.
 *               Without this flag the script only ADDS records — safe to
 *               re-run, but will skip rows that violate a unique index
 *               (e.g. a SKU or a Sale orderId it has already imported).
 *
 * If no path is given, the script looks for the first *.xlsx file in the
 * backend/ folder.
 *
 * This is the same import logic used by the in-app "Import" page in
 * backend/services/excelImportService.js — the CLI is just an alternate
 * way to run it (e.g. before the app is even deployed). Either way,
 * everything it writes lands as normal Product/Sale/Purchase documents,
 * editable immediately from Inventory / Sales / Expenses.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import XLSX from "xlsx";

import { runExcelImport } from "../services/excelImportService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const explicitFile = args.find((a) => !a.startsWith("--"));

function resolveWorkbookPath() {
  if (explicitFile) return path.resolve(explicitFile);
  const backendDir = path.join(__dirname, "..");
  const candidate = fs.readdirSync(backendDir).find((f) => f.toLowerCase().endsWith(".xlsx"));
  if (!candidate) {
    throw new Error(
      "No .xlsx file given and none found in backend/. Usage: node scripts/importFromExcel.js <path-to-Zeno.xlsx>"
    );
  }
  return path.join(backendDir, candidate);
}

async function run() {
  const workbookPath = resolveWorkbookPath();
  console.log(`\nZeno migration — reading ${workbookPath}\n`);

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);
  if (RESET) console.log("--reset given: clearing Product, Purchase, Sale collections…\n");

  const stats = await runExcelImport(workbook, { reset: RESET });

  console.log("\n──────────────── Migration summary ────────────────");
  console.log(`Products created:                 ${stats.productsCreated}`);
  console.log(`Products back-filled with cost:   ${stats.productsWithCostPriceUpdated}`);
  console.log(`Purchases imported:                ${stats.purchasesCreated}`);
  console.log(`  …linked to a catalog product:    ${stats.purchasesLinkedToInventory}`);
  console.log(`  …skipped on error:               ${stats.purchasesSkipped}`);
  console.log(`Sales imported:                    ${stats.salesCreated}`);
  console.log(`  …with a delivery charge:         ${stats.salesDeliveryChargesImported}`);
  console.log(`  …skipped, no matching product:   ${stats.salesSkippedNoProduct}`);
  console.log(`  …duplicate order IDs renamed:    ${stats.duplicateOrderIdsRenamed}`);
  console.log(`Warnings:                          ${stats.warnings.length}`);
  stats.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  console.log("─────────────────────────────────────────────────\n");

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nMigration failed:", err.message);
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch {}
  }
  process.exit(1);
});
