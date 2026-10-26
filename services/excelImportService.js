/**
 * Core Zeno workbook import logic.
 * ─────────────────────────────────
 * Shared by:
 *   - backend/scripts/importFromExcel.js  (CLI: `npm run migrate`)
 *   - backend/controllers/importController.js  (in-app upload, POST /api/import)
 *
 * Takes an already-parsed XLSX workbook (from XLSX.readFile or XLSX.read)
 * and writes Product / Purchase / Sale documents from its Inventory,
 * Purchase, and Sales sheets. See the CLI script's header comment for the
 * full rationale on why historical Purchase/Sale rows don't re-run through
 * the live stock-reconciliation engine.
 *
 * Everything this writes lands as normal documents in the same collections
 * the app's own CRUD screens use — so anything just imported is immediately
 * visible and editable in Inventory / Sales / Expenses, no separate "import
 * preview" table involved.
 */
import XLSX from "xlsx";
import Product from "../models/Product.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Contact from "../models/Contact.js";

// ───────────────────── header normalization ─────────────────────
function normalizeKey(k) {
  return String(k || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ALIASES = {
  itemid: "itemId",
  itemname: "name",
  type: "type",
  price: "price",
  stock: "stock",
  status: "status",
  notes: "notes",
  order: "order",
  product: "product",
  showininventory: "showInInventory",
  quantity: "quantity",
  orderdate: "orderDate",
  arriveby: "arriveBy",
  cost: "cost",
  pointofcontact: "pointOfContact",
  weightcbm: "weightCbm",
  delivery: "delivery",
  deliverypartner: "deliveryPartner",
  column12: "column12",
  paid: "paid",
  colour: "color",
  sku: "itemId",
  retailprice: "price",
  costprice: "costPrice",
  currentstock: "stock",
  lowstockalert: "lowStockAlert",
  colourbreakdown: "colorBreakdown",
  regularunitprice: "unitPrice",
  linetotal: "lineTotal",
  deliveryfeecustomer: "deliveryFeeCharged",
  deliverycostcourier: "deliveryCost",
  customer: "pointOfContact",
  phone: "customerPhone",
  billno: "billNo",
  billnumber: "billNo",
  payment: "paid",
  item: "product",
  category: "category",
  supplier: "pointOfContact",
  supplierphone: "supplierPhone",
  supplieremail: "supplierEmail",
  supplieraddress: "supplierAddress",
  suppliercompany: "supplierCompany",
  suppliernotes: "supplierNotes",
  tags: "tags",
};

function normalizeRow(row) {
  const out = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const norm = normalizeKey(rawKey);
    const canonical = ALIASES[norm] || norm;
    out[canonical] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

function findSheet(workbook, wantedNames) {
  const names = Array.isArray(wantedNames) ? wantedNames : [wantedNames];
  const match = workbook.SheetNames.find((n) =>
    names.some((name) => n.toLowerCase().trim() === name.toLowerCase()),
  );
  return match ? workbook.Sheets[match] : null;
}

function sheetRows(workbook, wantedNames) {
  const sheet = findSheet(workbook, wantedNames);
  if (!sheet) return null;
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  return raw.map(normalizeRow);
}

function toDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return d && !isNaN(d) ? d : null;
  }
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(String(value).replace(/[,$]/g, ""));
  return isNaN(n) ? fallback : n;
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[,$]/g, ""));
  return isNaN(n) ? null : n;
}

function truthy(value) {
  if (typeof value === "boolean") return value;
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return ["true", "yes", "y", "1"].includes(s);
}

function parseColorBreakdown(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((part) => {
      const [name, stock] = part.split(":").map((s) => (s || "").trim());
      if (!name) return null;
      return { name, stock: Number(stock) || 0 };
    })
    .filter(Boolean);
}

const PRODUCT_TYPES = ["Lamp", "Wallet", "Pouch", "Decor", "Packaging"];
const SALE_STATUSES = [
  "Delivered",
  "Packed",
  "Transit",
  "Returned",
  "Damaged",
  "In progress",
];
const NON_INVENTORY_KEYWORDS = [
  "meta ads",
  "ad spend",
  "advertising",
  "packaging",
  "salary",
  "salaries",
  "wages",
  "misc",
  "shipping",
  "freight",
  "courier",
  "delivery",
  "videography"
];

function guessProductType(rawType, name) {
  const t = String(rawType || "").trim();
  const exact = PRODUCT_TYPES.find((p) => p.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const n = (name || "").toLowerCase();
  if (n.includes("lamp")) return "Lamp";
  if (n.includes("wallet")) return "Wallet";
  if (n.includes("pouch")) return "Pouch";
  if (n.includes("packag")) return "Packaging";
  return "Decor";
}

function guessSaleStatus(raw) {
  const s = String(raw || "").trim();
  const match = SALE_STATUSES.find((v) => v.toLowerCase() === s.toLowerCase());
  return match || "In progress";
}

const STILL_JUST_ORDERED = ["order", "ordered", "requested", "pending", ""];

function guessPurchaseStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  return STILL_JUST_ORDERED.includes(s) ? "Ordered" : "Delivered";
}

function guessPaidStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (["paid", "y", "yes", "1", "true"].includes(s)) return "Paid";
  if (["unpaid", "n", "no", "0", "false"].includes(s)) return "Unpaid";
  return "COD";
}

function classifyPurchaseCategory(itemName, showInInventory) {
  const n = (itemName || "").toLowerCase();
  const hit = NON_INVENTORY_KEYWORDS.find((kw) => n.includes(kw));
  if (hit) {
    if (hit.includes("meta") || hit.includes("ad")) return "Meta Ads";
    if (hit.includes("packag")) return "Packaging";
    if (hit.includes("ship") || hit.includes("freight")) return "Shipping";
    if (hit.includes("salar") || hit.includes("wage")) return "Miscellaneous";
    return "Miscellaneous";
  }
  return showInInventory || itemName ? "Inventory" : "Miscellaneous";
}

export async function backfillDeliveryCosts(workbook) {
  const salesRows = sheetRows(workbook, "Sales");
  if (!salesRows) {
    const err = new Error('Workbook is missing the "Sales" sheet.');
    err.status = 400;
    throw err;
  }

  const result = {
    matched: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    noChargeInSheet: 0,
    warnings: [],
  };

  for (const [i, row] of salesRows.entries()) {
    const orderId = String(row.order || "").trim() || `AUTO-${i + 2}`;
    const deliveryCost = toNumberOrNull(row.delivery);
    if (deliveryCost === null) {
      result.noChargeInSheet++;
      continue;
    }

    const sale = await Sale.findOne({ orderId });
    if (!sale) {
      result.notFound++;
      result.warnings.push(
        `Row ${i + 2}: no existing sale matches Order ID "${orderId}" — skipped.`,
      );
      continue;
    }

    result.matched++;
    if (sale.deliveryCost !== deliveryCost) {
      sale.deliveryCost = deliveryCost;
      await sale.save();
      result.updated++;
    } else {
      result.unchanged++;
    }
  }

  return result;
}

export async function backfillPurchaseStatuses(workbook) {
  const purchaseRows = sheetRows(workbook, "Purchase");
  if (!purchaseRows) {
    const err = new Error('Workbook is missing the "Purchase" sheet.');
    err.status = 400;
    throw err;
  }

  const result = {
    matched: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    noOrderRefInSheet: 0,
    warnings: [],
  };

  for (const [i, row] of purchaseRows.entries()) {
    const orderRef = String(row.order || "").trim();
    if (!orderRef) {
      result.noOrderRefInSheet++;
      continue;
    }

    const correctStatus = guessPurchaseStatus(row.status);
    const purchase = await Purchase.findOne({ orderRef });
    if (!purchase) {
      result.notFound++;
      result.warnings.push(
        `Row ${i + 2}: no existing purchase matches Order "${orderRef}" — skipped.`,
      );
      continue;
    }

    result.matched++;
    if (purchase.status === correctStatus) {
      result.unchanged++;
      continue;
    }

    purchase.status = correctStatus;
    await purchase.save();

    result.updated++;
  }

  return result;
}

export async function resyncStockFromInventorySheet(workbook) {
  const inventoryRows = sheetRows(workbook, "Inventory");
  if (!inventoryRows) {
    const err = new Error('Workbook is missing the "Inventory" sheet.');
    err.status = 400;
    throw err;
  }

  const result = {
    matched: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    noStockInSheet: 0,
    warnings: [],
  };

  for (const row of inventoryRows) {
    const name = String(row.name || "").trim();
    if (!name) continue;

    const sheetStock = toNumberOrNull(row.stock);
    if (sheetStock === null) {
      result.noStockInSheet++;
      continue;
    }

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const product = await Product.findOne({
      name: new RegExp(`^${escaped}$`, "i"),
    });
    if (!product) {
      result.notFound++;
      result.warnings.push(`"${name}": no matching product found — skipped.`);
      continue;
    }

    result.matched++;
    if (product.currentStock === sheetStock) {
      result.unchanged++;
      continue;
    }

    await Product.findByIdAndUpdate(product._id, { currentStock: sheetStock });
    result.updated++;
  }

  return result;
}

export async function runExcelImport(workbook, { reset = false } = {}) {
  const stats = {
    productsCreated: 0,
    purchasesCreated: 0,
    purchasesLinkedToInventory: 0,
    purchasesSkipped: 0,
    salesCreated: 0,
    salesSkippedNoProduct: 0,
    salesDeliveryChargesImported: 0,
    duplicateOrderIdsRenamed: 0,
    productsWithCostPriceUpdated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    contactsSkipped: 0,
    warnings: [],
  };
  const warn = (msg) => stats.warnings.push(msg);

  const inventoryRows = sheetRows(workbook, ["Inventory", "Products"]);
  const purchaseRows = sheetRows(workbook, ["Purchase", "Expenses"]);
  const salesRows = sheetRows(workbook, "Sales");
  const contactRows = sheetRows(workbook, [
    "Suppliers & contacts",
    "Contacts",
    "Suppliers",
    "Contacts & suppliers",
  ]);

  const missing = [];
  if (!inventoryRows) missing.push("Inventory");
  if (!purchaseRows) missing.push("Purchase");
  if (!salesRows) missing.push("Sales");
  if (missing.length) {
    const err = new Error(
      `Workbook is missing required sheet(s): ${missing.join(", ")}. Expected sheets named "Inventory", "Purchase", and "Sales".`,
    );
    err.status = 400;
    throw err;
  }

  if (reset) {
    await Promise.all([
      Product.deleteMany({}),
      Purchase.deleteMany({}),
      Sale.deleteMany({}),
      Contact.deleteMany({}),
    ]);
  }

  if (contactRows) {
    for (const row of contactRows) {
      const name = String(row.name || row.contact || row.supplier || "").trim();
      if (!name) continue;

      const categoryValue = String(row.category || "Supplier").trim();
      const category = ["Supplier", "Customer", "Both", "Other"].includes(
        categoryValue,
      )
        ? categoryValue
        : "Supplier";

      const payload = {
        name,
        company: String(row.company || row.companyname || row.supplierCompany || "").trim() || "",
        phone: String(row.phone || row.customerPhone || row.supplierPhone || "").trim() || "",
        email: String(row.email || row.supplierEmail || "").trim() || "",
        address: String(row.address || row.supplierAddress || "").trim() || "",
        notes: String(row.notes || row.supplierNotes || "").trim() || "",
        category,
        isActive: true,
      };

      try {
        const existing = await Contact.findOne({ name });
        if (existing) {
          const changed =
            JSON.stringify({
              company: existing.company || "",
              phone: existing.phone || "",
              email: existing.email || "",
              address: existing.address || "",
              notes: existing.notes || "",
              category: existing.category || "Supplier",
            }) !==
            JSON.stringify({
              company: payload.company,
              phone: payload.phone,
              email: payload.email,
              address: payload.address,
              notes: payload.notes,
              category: payload.category,
            });

          if (!changed) {
            continue;
          }

          await Contact.findByIdAndUpdate(existing._id, payload, { new: true });
          stats.contactsUpdated++;
          continue;
        }

        await Contact.create(payload);
        stats.contactsCreated++;
      } catch (err) {
        warn(`Could not import contact "${name}": ${err.message}`);
        stats.contactsSkipped++;
      }
    }
  }

  const productByName = new Map();
  for (const p of await Product.find({})) {
    productByName.set(p.name.trim().toLowerCase(), p);
  }

  for (const row of inventoryRows) {
    const name = String(row.name || "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (productByName.has(key)) {
      warn(
        `Product "${name}" already exists — skipped duplicate Inventory row.`,
      );
      continue;
    }

    const sku = String(row.itemId || "").trim();
    const doc = {
      name,
      sku: sku || undefined,
      type: guessProductType(row.type, name),
      retailPrice: toNumber(row.price, 0),
      costPrice: toNumber(row.costPrice, 0),
      currentStock: toNumber(row.stock, 0),
      lowStockAlert: toNumber(row.lowStockAlert, 5),
      colors: parseColorBreakdown(row.colorBreakdown),
    };

    try {
      const created = await Product.create(doc);
      productByName.set(key, created);
      stats.productsCreated++;
    } catch (err) {
      warn(`Could not create product "${name}": ${err.message}`);
    }
  }

  const costAccumulator = new Map();

  for (const row of purchaseRows) {
    const itemName = String(row.product || "").trim();
    if (!itemName) continue;

    const showInInventory = truthy(row.showInInventory);
    const explicitCategory = String(row.category || "").trim();
    const category =
      explicitCategory || classifyPurchaseCategory(itemName, showInInventory);
    const matchedProduct =
      category === "Inventory"
        ? productByName.get(itemName.toLowerCase())
        : null;

    if (category === "Inventory" && !matchedProduct) {
      warn(
        `Purchase row for "${itemName}" looks like inventory but no matching product was found — imported as an unlinked expense.`,
      );
    }

    const quantity = toNumber(row.quantity, 0);
    const cost = toNumber(row.cost, 0);

    if (matchedProduct && quantity > 0 && cost > 0) {
      const acc = costAccumulator.get(matchedProduct._id.toString()) || {
        totalCost: 0,
        totalQty: 0,
      };
      acc.totalCost += cost;
      acc.totalQty += quantity;
      costAccumulator.set(matchedProduct._id.toString(), acc);
    }

    const tags = row.tags
      ? String(row.tags)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const doc = {
      orderRef: String(row.order || "").trim() || undefined,
      product: matchedProduct ? matchedProduct._id : undefined,
      productName: itemName,
      color: String(row.color || "").trim() || undefined,
      status: guessPurchaseStatus(row.status),
      quantity: quantity || undefined,
      orderDate: toDate(row.orderDate),
      arriveBy: toDate(row.arriveBy),
      cost,
      category,
      supplier: String(row.pointOfContact || "").trim() || undefined,
      notes: String(row.notes || "").trim() || undefined,
      weightCbm:
        String(row.weightcbm || row.weightCbm || "").trim() || undefined,
      tags,
    };

    try {
      await Purchase.create(doc);
      stats.purchasesCreated++;
      if (matchedProduct) stats.purchasesLinkedToInventory++;
    } catch (err) {
      warn(`Could not import purchase row "${itemName}": ${err.message}`);
      stats.purchasesSkipped++;
    }
  }

  for (const [productId, acc] of costAccumulator) {
    if (acc.totalQty <= 0) continue;
    const avgCost = acc.totalCost / acc.totalQty;
    await Product.findByIdAndUpdate(productId, {
      costPrice: Math.round(avgCost * 100) / 100,
    });
    stats.productsWithCostPriceUpdated++;
  }

  const seenOrderIds = new Set();
  for (const s of await Sale.find({}, "orderId")) seenOrderIds.add(s.orderId);

  for (const [i, row] of salesRows.entries()) {
    const productName = String(row.product || "").trim();
    if (!productName) continue;

    const matchedProduct = productByName.get(productName.toLowerCase());
    if (!matchedProduct) {
      warn(
        `Sale row ${i + 2}: no product matches "${productName}" — row skipped.`,
      );
      stats.salesSkippedNoProduct++;
      continue;
    }

    let orderId = String(row.order || "").trim() || `AUTO-${i + 2}`;
    if (seenOrderIds.has(orderId)) {
      const original = orderId;
      let suffix = 2;
      while (seenOrderIds.has(`${original}-${suffix}`)) suffix++;
      orderId = `${original}-${suffix}`;
      stats.duplicateOrderIdsRenamed++;
    }
    seenOrderIds.add(orderId);

    const status = guessSaleStatus(row.status);
    const quantity = toNumber(row.quantity, 1) || 1;

    let unitPrice, lineTotal;
    const hasExplicitLineTotal = String(row.lineTotal ?? "").trim() !== "";
    const hasExplicitUnitPrice = String(row.unitPrice ?? "").trim() !== "";

    if (hasExplicitLineTotal) {
      lineTotal = toNumber(row.lineTotal, 0);
      unitPrice = hasExplicitUnitPrice
        ? toNumber(row.unitPrice, 0)
        : Math.round((lineTotal / quantity) * 100) / 100;
    } else if (hasExplicitUnitPrice) {
      unitPrice = toNumber(row.unitPrice, 0);
      lineTotal = 0;
    } else {
      const priceValue = String(row.price ?? "").trim();
      lineTotal = priceValue === "" ? 0 : toNumber(row.price, 0);
      unitPrice =
        lineTotal === 0 ? 0 : Math.round((lineTotal / quantity) * 100) / 100;
    }

    let deliveryCost, deliveryFeeCharged;
    const extraNotes = [];
    if (row.notes) extraNotes.push(String(row.notes).trim());

    if (
      row.deliveryCost !== undefined ||
      row.deliveryFeeCharged !== undefined
    ) {
      deliveryCost = toNumberOrNull(row.deliveryCost) || 0;
      deliveryFeeCharged = toNumberOrNull(row.deliveryFeeCharged);
    } else {
      const deliveryCostParsed = toNumberOrNull(row.delivery);
      deliveryCost = deliveryCostParsed || 0;
      deliveryFeeCharged = null;
      if (deliveryCostParsed === null && row.delivery)
        extraNotes.push(`Delivery: ${row.delivery}`);
    }
    if (deliveryCost > 0) stats.salesDeliveryChargesImported++;
    if (row.column12) extraNotes.push(`Extra: ${row.column12}`);

    const doc = {
      orderId,
      product: matchedProduct._id,
      billNo: String(row.billNo || "").trim() || undefined,
      color: String(row.color || "").trim() || undefined,
      status,
      orderDate: toDate(row.orderDate) || new Date(),
      quantity,
      unitPrice,
      lineTotal,
      deliveryCost,
      deliveryFeeCharged,
      deliveryPartner: String(row.deliveryPartner || "").trim() || undefined,
      pointOfContact: String(row.pointOfContact || "").trim() || undefined,
      customerPhone: String(row.customerPhone || "").trim() || undefined,
      notes: extraNotes.join(" | ") || undefined,
      paidStatus: guessPaidStatus(row.paid),
    };

    try {
      await Sale.create(doc);
      stats.salesCreated++;
    } catch (err) {
      warn(
        `Could not import sale row ${i + 2} (order ${orderId}): ${err.message}`,
      );
    }
  }

  return stats;
}