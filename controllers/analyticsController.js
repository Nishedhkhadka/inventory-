import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Product from "../models/Product.js";
import { getPnLData } from "./pnlData.js";

// Builds a Mongo date-range match stage from ?from=&to= query params in standard UTC.
function dateRangeMatch(field, from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) range.$lte = new Date(`${to}T23:59:59.999Z`);
  return { [field]: range };
}

export const getSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const saleDateMatch = dateRangeMatch("orderDate", from, to);
    const purchaseDateMatch = dateRangeMatch("orderDate", from, to);

    const [
      revenueResult,
      expenseResult,
      warehouseValueResult,
      productPerformance,
      expenseBreakdown,
      monthlyRevenue,
      deliveryResult,
    ] = await Promise.all([
      // 1. Total Delivered Revenue
      Sale.aggregate([
        { $match: { status: "Delivered", ...saleDateMatch } },
        { $group: { _id: null, total: { $sum: "$lineTotal" } } },
      ]),

      // 2. Total Expenses & Costs
      Purchase.aggregate([
        { $match: { ...purchaseDateMatch } },
        { $group: { _id: null, total: { $sum: "$cost" } } },
      ]),

      // 3. Warehouse Asset Valuation
      Product.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: {$multiply: ["$currentStock", "$retailPrice"] } },
          },
        },
      ]),

      // 4. Product Performance Breakdown
      Sale.aggregate([
        { $match: { status: "Delivered", ...saleDateMatch } },
        {
          $group: {
            _id: "$product",
            unitsSold: { $sum: "$quantity" },
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
            productId: "$product._id",
            name: "$product.name",
            sku: "$product.sku",
            type: "$product.type",
            unitsSold: 1,
            revenue: 1,
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      // 5. Expense Breakdown by category
      Purchase.aggregate([
        { $match: { ...purchaseDateMatch } },
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

      // 6. Monthly Revenue Trajectory (Latest 12 months)
      Sale.aggregate([
        { $match: { status: "Delivered", ...saleDateMatch } },
        {
          $group: {
            _id: {
              year: { $year: "$orderDate" },
              month: { $month: "$orderDate" },
            },
            revenue: { $sum: "$lineTotal" },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },         {$project: {
            _id: 0,
            year: "$_id.year",
            month: "$_id.month",
            revenue: 1,
          },
        },
      ]),

      // 7. Delivery Fees Calculation & Null Check Fix
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
              $sum: {$cond: [
                  { $eq: ["$status", "Delivered"] },
                  { $ifNull: ["$deliveryFeeCharged", 0] },
                  0,
                ],
              },
            },
            costPaid: { $sum: { $ifNull: ["$deliveryCost", 0] } },
            unknownFeeCount: {
              $sum: {$cond: [
                  {
                    $and: [
                      { $eq: ["$status", "Delivered"] },
                      {
                        $or: [
                          { $eq: ["$deliveryFeeCharged", null] },
                          { $eq: [{ $type: "$deliveryFeeCharged" }, "missing"] },
                        ],
                      },
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

    const totalDeliveredRevenue = revenueResult[0]?.total || 0;
    const totalExpenses = expenseResult[0]?.total || 0;
    const warehouseAssetValuation = warehouseValueResult[0]?.total || 0;
    const deliveryFeesCollected = deliveryResult[0]?.feesCollected || 0;
    const deliveryCostTotal = deliveryResult[0]?.costPaid || 0;
    const ordersWithUnknownDeliveryFee =
      deliveryResult[0]?.unknownFeeCount || 0;

    const netCashFlow =
      totalDeliveredRevenue +
      deliveryFeesCollected -
      totalExpenses -
      deliveryCostTotal;

    res.json({
      totalDeliveredRevenue,
      totalExpenses,
      deliveryFeesCollected,
      deliveryCostTotal,
      ordersWithUnknownDeliveryFee,
      netCashFlow,
      warehouseAssetValuation,
      productPerformance,
      expenseBreakdown,
      // Reverse monthly revenue back to chronological order (oldest to newest)
      monthlyRevenue: monthlyRevenue.reverse(),
      range: { from: from || null, to: to || null },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getPnL = async (req, res) => {
  try {
    const { from, to } = req.query;
    const pnl = await getPnLData({ from, to });
    res.json(pnl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};