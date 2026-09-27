import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";

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

/**
 * Computes the accrual-style P&L for a date range:
 *   Revenue (delivered sales) - COGS (units sold x product cost price)
 *   = Gross Profit - Operating Expenses (non-inventory purchases) = Net Profit
 * Inventory purchases are reported separately as capitalized spend, not
 * folded into operating expenses (they become COGS only once sold).
 * Shared by the /analytics/pnl JSON endpoint and the XLSX/PDF exporter so
 * the numbers can never drift between what's shown on screen and exported.
 */
export async function getPnLData({ from, to }) {
  const saleDateMatch = dateRangeMatch("orderDate", from, to);
  const purchaseDateMatch = dateRangeMatch("orderDate", from, to);

  const [deliveredLines, expenseRows, inventoryPurchaseResult, deliveryResult] =
    await Promise.all([
      Sale.aggregate([
        { $match: { status: "Delivered", ...saleDateMatch } },
        {
          $group: {
            _id: "$product",
            unitsSold: { $sum: "$quantity" },
            // lineTotal is the actual charged amount for this line (already
            // net of any discount) — never quantity × unitPrice.
            revenue: { $sum: "$lineTotal" },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        {
          $project: {
            _id: 0,
            name: "$product.name",
            unitsSold: 1,
            revenue: 1,
            costPrice: { $ifNull: ["$product.costPrice", 0] },
            cogs: {
              $multiply: ["$unitsSold", { $ifNull: ["$product.costPrice", 0] }],
            },
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      Purchase.aggregate([
        { $match: { category: { $ne: "Inventory" }, ...purchaseDateMatch } },
        { $group: { _id: "$category", total: { $sum: "$cost" } } },
        {
          $project: {
            _id: 0,
            category: { $ifNull: ["$_id", "Miscellaneous"] },
            total: 1,
          },
        },
        { $sort: { total: -1 } },
      ]),

      Purchase.aggregate([
        { $match: { category: "Inventory", ...purchaseDateMatch } },
        { $group: { _id: null, total: { $sum: "$cost" } } },
      ]),

      // Delivery fees collected from customers are revenue-like and should be
      // counted only on Delivered orders, but the amount actually paid to the
      // courier is a real business expense regardless of status. Returned sales
      // still incurred the courier cost, so it must stay in the expense total.
      Sale.aggregate([
        {
          $match: {
            status: { $in: ["Delivered", "Returned"] },
            ...saleDateMatch,
          },
        },
        {
          $group: {
            _id: null,
            feesCollected: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "Delivered"] },
                  { $ifNull: ["$deliveryFeeCharged", 0] },
                  0,
                ],
              },
            },
            costPaid: { $sum: { $ifNull: ["$deliveryCost", 0] } },
            unknownFeeCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "Delivered"] },
                      { $eq: ["$deliveryFeeCharged", null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

  const revenue = deliveredLines.reduce((s, l) => s + l.revenue, 0);
  const cogs = deliveredLines.reduce((s, l) => s + l.cogs, 0);
  const grossProfit = revenue - cogs;
  const operatingExpenses = expenseRows.reduce((s, r) => s + r.total, 0);
  const deliveryFeesCollected = deliveryResult[0]?.feesCollected || 0;
  const deliveryCost = deliveryResult[0]?.costPaid || 0;
  const ordersWithUnknownDeliveryFee = deliveryResult[0]?.unknownFeeCount || 0;
  // Delivery fees collected are revenue the business actually received —
  // they add to profit; delivery cost paid to the courier is a real
  // expense — it subtracts. Net delivery effect can be positive (fee
  // exceeded cost) or negative (a delivery "subsidy").
  const netProfit =
    grossProfit - operatingExpenses - deliveryCost + deliveryFeesCollected;
  const inventoryCapitalized = inventoryPurchaseResult[0]?.total || 0;

  return {
    range: { from: from || null, to: to || null },
    revenue,
    cogs,
    grossProfit,
    grossMarginPct: revenue ? (grossProfit / revenue) * 100 : 0,
    operatingExpenses,
    operatingExpenseBreakdown: expenseRows,
    deliveryFeesCollected,
    deliveryCost,
    deliveryNet: deliveryFeesCollected - deliveryCost,
    ordersWithUnknownDeliveryFee,
    netProfit,
    netMarginPct: revenue ? (netProfit / revenue) * 100 : 0,
    inventoryCapitalized,
    productLines: deliveredLines,
  };
}
