import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { reconcileStockForSale } from "./inventoryService.js";

/*
 * Nepal fiscal year.
 *
 * Example:
 * July 2026 - June 2027 = 2083/84
 */
const getFiscalYear = (date = new Date()) => {
  const d = new Date(date);

  const adYear = d.getFullYear();
  const month = d.getMonth() + 1;

  const bsYear = adYear + 57;

  if (month >= 7) {
    return `${bsYear}/${String(bsYear + 1).slice(-2)}`;
  }

  return `${bsYear - 1}/${String(bsYear).slice(-2)}`;
};

/*
 * Generate the next bill number atomically.
 *
 * Example:
 * INV-2083/84-0001
 * INV-2083/84-0002
 */
const generateBillNo = async (date) => {
  const fiscalYear = getFiscalYear(date);

  const counter = await Counter.findOneAndUpdate(
    {
      key: `bill-${fiscalYear}`,
    },
    {
      $inc: {
        seq: 1,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return `INV-${fiscalYear}-${String(counter.seq).padStart(4, "0")}`;
};

/*
 * Convert frontend billIssued values safely.
 */
const isTrue = (value) =>
  value === true ||
  value === "true" ||
  value === 1 ||
  value === "1";

/*
 * GET /api/sales
 */
export const getSales = async (req, res) => {
  try {
    const {
      search,
      status,
      from,
      to,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (req.query.date) {
      const start = new Date(req.query.date);
      start.setHours(0, 0, 0, 0);

      const end = new Date(req.query.date);
      end.setHours(23, 59, 59, 999);

      filter.orderDate = {
        $gte: start,
        $lte: end,
      };
    } else if (from || to) {
      filter.orderDate = {};

      if (from) {
        filter.orderDate.$gte = new Date(from);
      }

      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);

        filter.orderDate.$lte = end;
      }
    }

    if (search) {
      const rx = {
        $regex: search,
        $options: "i",
      };

      const matchingProducts = await Product.find(
        {
          name: rx,
        },
        "_id"
      );

      filter.$or = [
        { orderId: rx },
        { billNo: rx },
        { pointOfContact: rx },
        { customerPhone: rx },
        { deliveryPartner: rx },
        { color: rx },
        {
          product: {
            $in: matchingProducts.map((p) => p._id),
          },
        },
      ];
    }

    const skip =
      (Number(page) - 1) * Number(limit);

    const [sales, total] = await Promise.all([
      Sale.find(filter)
        .populate(
          "product",
          "name sku type retailPrice currentStock colors"
        )
        .sort({
          orderDate: -1,
        })
        .skip(skip)
        .limit(Number(limit)),

      Sale.countDocuments(filter),
    ]);

    res.json({
      data: sales,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

/*
 * GET /api/sales/:id
 */
export const getSale = async (req, res) => {
  try {
    const sale = await Sale.findById(
      req.params.id
    ).populate("product");

    if (!sale) {
      return res.status(404).json({
        message: "Sale not found",
      });
    }

    res.json(sale);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

/*
 * POST /api/sales
 */
export const createSale = async (req, res) => {
  try {
    const product = await Product.findById(
      req.body.product
    );

    if (!product) {
      return res.status(400).json({
        message: "Product not found",
      });
    }

    const wantsBill = isTrue(req.body.billIssued);

    /*
     * Never accept a bill number from the frontend.
     * The server generates it.
     */
    const data = {
      ...req.body,

      billIssued: false,
      billNo: null,
      billIssuedAt: null,
    };

    delete data.billNo;

    /*
     * Only generate a bill when explicitly requested.
     */
    if (wantsBill) {
      data.billNo = await generateBillNo(
        data.orderDate
      );

      data.billIssued = true;
      data.billIssuedAt = new Date();
    }

    const sale = await Sale.create(data);

    /*
     * Existing stock behavior.
     */
    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: null,
      newStatus: sale.status,
      newQuantity: sale.quantity,
      newColor: sale.color || null,
    });

    const populated = await sale.populate(
      "product",
      "name sku type retailPrice currentStock colors"
    );

    res.status(201).json(populated);
  } catch (err) {
    console.error("createSale error:", err);

    res.status(400).json({
      message: err.message,
    });
  }
};

/*
 * PUT /api/sales/:id
 */
export const updateSale = async (req, res) => {
  try {
    const existing = await Sale.findById(
      req.params.id
    );

    if (!existing) {
      return res.status(404).json({
        message: "Sale not found",
      });
    }

    const oldStatus = existing.status;
    const oldQuantity = existing.quantity;
    const oldColor = existing.color || null;
    const oldProductId =
      existing.product.toString();

    /*
     * A bill is considered issued if either field exists.
     * This also supports old records created before billIssued
     * was added.
     */
    const alreadyHasBill =
      Boolean(existing.billNo) ||
      existing.billIssued === true;

    const requestedBillIssued =
      isTrue(req.body.billIssued);

    /*
     * IMPORTANT:
     * Do not let the frontend overwrite billNo or billIssued
     * through Object.assign().
     */
    const updateData = {
      ...req.body,
    };

    delete updateData.billNo;
    delete updateData.billIssued;
    delete updateData.billIssuedAt;

    /*
     * Apply all normal editable fields.
     */
    Object.assign(existing, updateData);

    /*
     * BILL LOGIC
     */

    if (alreadyHasBill) {
      /*
       * Once a bill exists, it is permanent.
       * We keep the original bill number.
       */
      existing.billIssued = true;

      /*
       * If an old record has billIssued=false but has a billNo,
       * normalize it.
       */
      if (!existing.billNo) {
        return res.status(400).json({
          message:
            "This order is marked as billed but has no bill number.",
        });
      }

      /*
       * Never allow turning an issued bill back to No.
       */
    } else if (requestedBillIssued) {
      /*
       * This is the important transition:
       *
       * No bill
       *     ↓
       * Yes
       *
       * Generate the bill number now.
       */
      existing.billNo = await generateBillNo(
        existing.orderDate
      );

      existing.billIssued = true;
      existing.billIssuedAt = new Date();
    } else {
      /*
       * Still no bill.
       */
      existing.billIssued = false;
      existing.billNo = null;
      existing.billIssuedAt = null;
    }

    await existing.save();

    const newProductId =
      existing.product.toString();

    const newColor =
      existing.color || null;

    /*
     * Existing stock reconciliation.
     */
    if (oldProductId !== newProductId) {
      await reconcileStockForSale({
        productId: oldProductId,
        oldStatus,
        oldQuantity,
        oldColor,
        newStatus: null,
        newQuantity: 0,
      });

      await reconcileStockForSale({
        productId: newProductId,
        oldStatus: null,
        oldQuantity: 0,
        newStatus: existing.status,
        newQuantity: existing.quantity,
        newColor,
      });
    } else {
      await reconcileStockForSale({
        productId: newProductId,
        oldStatus,
        oldQuantity,
        oldColor,
        newStatus: existing.status,
        newQuantity: existing.quantity,
        newColor,
      });
    }

    const populated = await existing.populate(
      "product",
      "name sku type retailPrice currentStock colors"
    );

    res.json(populated);
  } catch (err) {
    console.error("updateSale error:", err);

    res.status(400).json({
      message: err.message,
    });
  }
};

/*
 * DELETE /api/sales/:id
 */
export const deleteSale = async (req, res) => {
  try {
    const sale = await Sale.findById(
      req.params.id
    );

    if (!sale) {
      return res.status(404).json({
        message: "Sale not found",
      });
    }

    /*
     * Never delete a sale after a bill has been issued.
     *
     * The bill number must not be reused.
     */
    if (sale.billIssued || sale.billNo) {
      return res.status(400).json({
        message:
          "This order has an issued bill and cannot be deleted. Mark it as Returned or Cancelled instead.",
      });
    }

    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: sale.status,
      oldQuantity: sale.quantity,
      oldColor: sale.color || null,
      newStatus: null,
      newQuantity: 0,
    });

    await sale.deleteOne();

    res.json({
      message: "Sale deleted",
    });
  } catch (err) {
    console.error("deleteSale error:", err);

    res.status(500).json({
      message: err.message,
    });
  }
};