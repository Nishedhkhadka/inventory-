import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Product from "../models/Product.js";
import Contact from "../models/Contact.js";
import { getPnLData } from "./pnlData.js";

function dateRangeMatch(field, from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return { [field]: range };
}

const money = (n) => Number(n || 0);

// Shared between the standalone Sales export and the combined
// export-everything workbook, so the two never drift apart.
const SALES_COLUMNS = [
  { header: "Order", key: "orderId", width: 16 },
  { header: "Product", key: "product", width: 24 },
  { header: "Colour", key: "color", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "Order date", key: "orderDate", width: 14 },
  { header: "Quantity", key: "quantity", width: 10 },
  { header: "Regular unit price", key: "unitPrice", width: 16 },
  { header: "Line total", key: "lineTotal", width: 14 },
  { header: "Discount", key: "discount", width: 12 },
  { header: "Delivery fee (customer)", key: "deliveryFeeCharged", width: 18 },
  { header: "Delivery cost (courier)", key: "deliveryCost", width: 18 },
  { header: "Grand total", key: "grandTotal", width: 14 },
  { header: "Delivery partner", key: "deliveryPartner", width: 16 },
  { header: "Customer", key: "pointOfContact", width: 20 },
  { header: "Phone", key: "customerPhone", width: 16 },
  { header: "Payment", key: "paidStatus", width: 12 },
  { header: "Notes", key: "notes", width: 30 },
];

function salesRow(s) {
  // null deliveryFeeCharged means "not recorded" (historical data) — kept
  // as a blank cell rather than 0, and grandTotal is left as just the
  // line total in that case rather than silently implying free delivery.
  const feeKnown =
    s.deliveryFeeCharged !== null && s.deliveryFeeCharged !== undefined;
  return {
    orderId: s.orderId,
    product: s.product?.name || "—",
    color: s.color || "",
    status: s.status,
    orderDate: s.orderDate ? s.orderDate.toISOString().slice(0, 10) : "",
    quantity: s.quantity,
    unitPrice: money(s.unitPrice),
    lineTotal: money(s.lineTotal),
    discount: money(s.discount),
    deliveryFeeCharged: feeKnown ? money(s.deliveryFeeCharged) : "",
    deliveryCost: money(s.deliveryCost),
    grandTotal:
      money(s.lineTotal) + (feeKnown ? money(s.deliveryFeeCharged) : 0),
    deliveryPartner: s.deliveryPartner || "",
    pointOfContact: s.pointOfContact || "",
    customerPhone: s.customerPhone || "",
    paidStatus: s.paidStatus,
    notes: s.notes || "",
  };
}

const PURCHASE_COLUMNS = [
  { header: "Item", key: "productName", width: 24 },
  { header: "Colour", key: "color", width: 12 },
  { header: "Category", key: "category", width: 14 },
  { header: "Supplier", key: "supplier", width: 20 },
  { header: "Supplier phone", key: "supplierPhone", width: 16 },
  { header: "Supplier email", key: "supplierEmail", width: 22 },
  { header: "Supplier address", key: "supplierAddress", width: 28 },
  { header: "Status", key: "status", width: 12 },
  { header: "Quantity", key: "quantity", width: 10 },
  { header: "Cost", key: "cost", width: 12 },
  { header: "Order date", key: "orderDate", width: 14 },
  { header: "Arrive by", key: "arriveBy", width: 14 },
  { header: "Weight / CBM", key: "weightCbm", width: 14 },
  { header: "Tags", key: "tags", width: 20 },
  { header: "Notes", key: "notes", width: 30 },
];

function purchaseRow(p, contact) {
  return {
    productName: p.productName,
    color: p.color || "",
    category: p.category,
    supplier: p.supplier || "",
    supplierPhone: contact?.phone || "",
    supplierEmail: contact?.email || "",
    supplierAddress: contact?.address || "",
    status: p.status,
    quantity: p.quantity || "",
    cost: money(p.cost),
    orderDate: p.orderDate ? p.orderDate.toISOString().slice(0, 10) : "",
    arriveBy: p.arriveBy ? p.arriveBy.toISOString().slice(0, 10) : "",
    weightCbm: p.weightCbm || "",
    tags: (p.tags || []).join(", "),
    notes: p.notes || "",
  };
}

const PRODUCT_COLUMNS = [
  { header: "SKU", key: "sku", width: 14 },
  { header: "Name", key: "name", width: 24 },
  { header: "Type", key: "type", width: 14 },
  { header: "Retail price", key: "retailPrice", width: 14 },
  { header: "Cost price", key: "costPrice", width: 14 },
  { header: "Current stock", key: "currentStock", width: 14 },
  { header: "Low stock alert", key: "lowStockAlert", width: 16 },
  { header: "Colour breakdown", key: "colors", width: 30 },
  { header: "Stock value", key: "stockValue", width: 14 },
];

function productRow(p) {
  return {
    sku: p.sku || "",
    name: p.name,
    type: p.type,
    retailPrice: money(p.retailPrice),
    costPrice: money(p.costPrice),
    currentStock: p.currentStock,
    lowStockAlert: p.lowStockAlert,
    colors: (p.colors || []).map((c) => `${c.name}: ${c.stock}`).join(", "),
    stockValue: money(p.currentStock * p.retailPrice),
  };
}

// GET /api/sales/export?from=&to=&status=
export const exportSales = async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const filter = { ...dateRangeMatch("orderDate", from, to) };
    if (status) filter.status = status;

    const sales = await Sale.find(filter)
      .populate("product", "name sku")
      .sort({ orderDate: -1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sales");
    sheet.columns = SALES_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    sales.forEach((s) => sheet.addRow(salesRow(s)));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=zeno-sales.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/purchases/export?from=&to=&category=&status=
export const exportPurchases = async (req, res) => {
  try {
    const { from, to, category, status } = req.query;
    const filter = { ...dateRangeMatch("orderDate", from, to) };
    if (category) filter.category = category;
    if (status) filter.status = status;

    const purchases = await Purchase.find(filter)
      .populate("product", "name sku")
      .sort({ orderDate: -1 });
    const contacts = await Contact.find({
      name: { $in: purchases.map((p) => p.supplier).filter(Boolean) },
    }).lean();
    const contactByName = new Map(
      contacts.map((contact) => [
        String(contact.name).trim().toLowerCase(),
        contact,
      ]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Expenses");
    sheet.columns = PURCHASE_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    purchases.forEach((p) => {
      const key = String(p.supplier || "")
        .trim()
        .toLowerCase();
      const contact = key ? contactByName.get(key) : null;
      sheet.addRow(purchaseRow(p, contact));
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=zeno-expenses.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/analytics/pnl/export?from=&to=&format=xlsx|pdf
export const exportPnL = async (req, res) => {
  try {
    const { from, to, format = "xlsx" } = req.query;
    const pnl = await getPnLData({ from, to });

    if (format === "pdf") return sendPnLPdf(res, pnl);
    return sendPnLXlsx(res, pnl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

async function sendPnLXlsx(res, pnl) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("P&L Statement");
  sheet.columns = [
    { key: "label", width: 32 },
    { key: "value", width: 18 },
  ];

  const rangeLabel = `${pnl.range.from || "All time"} → ${pnl.range.to || "present"}`;
  sheet.addRow({ label: "Zeno — Profit & Loss Statement", value: "" }).font = {
    bold: true,
    size: 14,
  };
  sheet.addRow({ label: rangeLabel, value: "" });
  sheet.addRow({});
  sheet.addRow({ label: "Revenue", value: money(pnl.revenue) });
  sheet.addRow({ label: "Cost of Goods Sold", value: -money(pnl.cogs) });
  sheet.addRow({ label: "Gross Profit", value: money(pnl.grossProfit) }).font =
    { bold: true };
  sheet.addRow({
    label: "Gross Margin %",
    value: `${pnl.grossMarginPct.toFixed(1)}%`,
  });
  sheet.addRow({});
  sheet.addRow({ label: "Operating Expenses", value: "" }).font = {
    bold: true,
  };
  pnl.operatingExpenseBreakdown.forEach((e) =>
    sheet.addRow({ label: `  ${e.category}`, value: -money(e.total) }),
  );
  sheet.addRow({
    label: "Total Operating Expenses",
    value: -money(pnl.operatingExpenses),
  });
  sheet.addRow({});
  sheet.addRow({
    label: "Delivery fees collected (from customers)",
    value: money(pnl.deliveryFeesCollected),
  });
  sheet.addRow({
    label: "Delivery cost (paid to courier)",
    value: -money(pnl.deliveryCost),
  });
  if (pnl.ordersWithUnknownDeliveryFee > 0) {
    sheet.addRow({
      label: `  (${pnl.ordersWithUnknownDeliveryFee} delivered order(s) have no recorded customer delivery fee — historical data)`,
      value: "",
    });
  }
  sheet.addRow({});
  sheet.addRow({ label: "Net Profit", value: money(pnl.netProfit) }).font = {
    bold: true,
  };
  sheet.addRow({
    label: "Net Margin %",
    value: `${pnl.netMarginPct.toFixed(1)}%`,
  });
  sheet.addRow({});
  sheet.addRow({
    label: "Inventory purchased (capitalized, not expensed)",
    value: money(pnl.inventoryCapitalized),
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=zeno-pnl-statement.xlsx",
  );
  await workbook.xlsx.write(res);
  res.end();
}

function sendPnLPdf(res, pnl) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=zeno-pnl-statement.pdf",
  );
  doc.pipe(res);

  const rangeLabel = `${pnl.range.from || "All time"}  →  ${pnl.range.to || "present"}`;
  const fmt = (n) =>
    `$${money(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  doc.fontSize(20).text("Zeno — Profit & Loss Statement", { align: "left" });
  doc.fontSize(10).fillColor("#726C5F").text(rangeLabel);
  doc.moveDown(1.5);
  doc.fillColor("#211F1B");

  const line = (label, value, opts = {}) => {
    doc
      .fontSize(opts.size || 11)
      .font(opts.bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(label, { continued: true });
    doc.text(value, { align: "right" });
  };

  line("Revenue", fmt(pnl.revenue));
  line("Cost of Goods Sold", `(${fmt(pnl.cogs)})`);
  doc.moveDown(0.3);
  line("Gross Profit", fmt(pnl.grossProfit), { bold: true });
  line("Gross Margin", `${pnl.grossMarginPct.toFixed(1)}%`);
  doc.moveDown(0.8);

  doc.font("Helvetica-Bold").text("Operating Expenses");
  doc.font("Helvetica");
  pnl.operatingExpenseBreakdown.forEach((e) =>
    line(`  ${e.category}`, `(${fmt(e.total)})`),
  );
  line("Total Operating Expenses", `(${fmt(pnl.operatingExpenses)})`);
  doc.moveDown(0.8);

  line(
    "Delivery fees collected (from customers)",
    fmt(pnl.deliveryFeesCollected),
  );
  line("Delivery cost (paid to courier)", `(${fmt(pnl.deliveryCost)})`);
  if (pnl.ordersWithUnknownDeliveryFee > 0) {
    doc
      .fontSize(8)
      .fillColor("#726C5F")
      .text(
        `${pnl.ordersWithUnknownDeliveryFee} delivered order(s) have no recorded customer delivery fee (historical data) — not counted as $0 above.`,
      );
    doc.fillColor("#211F1B");
  }
  doc.moveDown(0.8);

  line("Net Profit", fmt(pnl.netProfit), { bold: true, size: 13 });
  line("Net Margin", `${pnl.netMarginPct.toFixed(1)}%`);
  doc.moveDown(0.8);

  doc
    .fontSize(9)
    .fillColor("#726C5F")
    .text(
      `Inventory purchased in this range: ${fmt(pnl.inventoryCapitalized)} (capitalized — expensed only as units sell, not shown above).`,
    );

  doc.end();
}

// GET /api/products/export?type=&lowStockOnly=
export const exportProducts = async (req, res) => {
  try {
    const { type, lowStockOnly } = req.query;
    const filter = {};
    if (type) filter.type = type;

    let products = await Product.find(filter).sort({ name: 1 });
    if (String(lowStockOnly).toLowerCase() === "true") {
      products = products.filter((p) => p.currentStock <= p.lowStockAlert);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Inventory");
    sheet.columns = PRODUCT_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    products.forEach((p) => sheet.addRow(productRow(p)));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=zeno-inventory.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/export/all?from=&to=
// One workbook, three sheets — Sales, Expenses, Inventory — each using the
// exact same columns as their standalone export, so this is never out of
// sync with those. from/to scope Sales and Expenses (transaction history);
// Inventory is always the current snapshot, same as its standalone export.
export const exportAll = async (req, res) => {
  try {
    const { from, to } = req.query;
    const saleFilter = { ...dateRangeMatch("orderDate", from, to) };
    const purchaseFilter = { ...dateRangeMatch("orderDate", from, to) };

    const [sales, purchases, products] = await Promise.all([
      Sale.find(saleFilter)
        .populate("product", "name sku")
        .sort({ orderDate: -1 }),
      Purchase.find(purchaseFilter)
        .populate("product", "name sku")
        .sort({ orderDate: -1 }),
      Product.find({}).sort({ name: 1 }),
    ]);

    const workbook = new ExcelJS.Workbook();

    const salesSheet = workbook.addWorksheet("Sales");
    salesSheet.columns = SALES_COLUMNS;
    salesSheet.getRow(1).font = { bold: true };
    sales.forEach((s) => salesSheet.addRow(salesRow(s)));

    const expensesSheet = workbook.addWorksheet("Purchase");
    expensesSheet.columns = PURCHASE_COLUMNS;
    expensesSheet.getRow(1).font = { bold: true };
    purchases.forEach((p) => expensesSheet.addRow(purchaseRow(p)));

    const inventorySheet = workbook.addWorksheet("Inventory");
    inventorySheet.columns = PRODUCT_COLUMNS;
    inventorySheet.getRow(1).font = { bold: true };
    products.forEach((p) => inventorySheet.addRow(productRow(p)));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=zeno-full-export.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
