import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { reconcileStockForSale } from "./inventoryService.js";
import Counter from "../models/Counter.js";

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
 * Generate the next bill number for a Nepal fiscal year.
 *
 * Example:
 * INV-2083/84-0001
 * INV-2083/84-0002
 */
const generateBillNo = async (date) => {
  const fiscalYear = getFiscalYear(date);

  /*
   * Atomically increment the counter.
   */
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

  let sequence = counter.seq;

  /*
   * Extra protection:
   *
   * If the Counter was reset/deleted while bills already exist,
   * make sure we don't generate a duplicate bill number.
   */
  while (
    await Sale.exists({
      billNo: `INV-${fiscalYear}-${String(sequence).padStart(4, "0")}`,
    })
  ) {
    sequence += 1;

    await Counter.findOneAndUpdate(
      {
        key: `bill-${fiscalYear}`,
      },
      {
        $max: {
          seq: sequence,
        },
      },
      {
        upsert: true,
      }
    );
  }

  return `INV-${fiscalYear}-${String(sequence).padStart(4, "0")}`;
}; 
/*
 * Validate a manually entered bill number.
 *
 * Bill numbers must look like:
 *
 * INV-2083/84-0001
 */
const validateBillNo = async ({
  billNo,
  orderDate,
  saleId = null,
}) => {
  if (!billNo) {
    throw new Error("Bill number is required.");
  }

  const normalized = String(billNo).trim().toUpperCase();

  const fiscalYear = getFiscalYear(orderDate);

  /*
   * Expected format:
   * INV-2083/84-0001
   */
  const pattern = new RegExp(
    `^INV-${fiscalYear.replace("/", "\\/")}-\\d{4}$`
  );

  if (!pattern.test(normalized)) {
    throw new Error(
      `Invalid bill number. Expected format: INV-${fiscalYear}-0001`
    );
  }

  /*
   * Check duplicate bill number.
   */
  const duplicateFilter = {
    billNo: normalized,
  };

  /*
   * When editing an existing sale, exclude itself.
   */
  if (saleId) {
    duplicateFilter._id = {
      $ne: saleId,
    };
  }

  const duplicate = await Sale.exists(
    duplicateFilter
  );

  if (duplicate) {
    throw new Error(
      `Bill number ${normalized} is already used.`
    );
  }

  return normalized;
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

    const wantsBill = isTrue(
      req.body.billIssued
    );

    const data = {
      ...req.body,
      billIssued: false,
      billNo: null,
      billIssuedAt: null,
    };

    /*
     * Never blindly trust the frontend bill number.
     */
    delete data.billNo;
    delete data.billIssuedAt;

    if (wantsBill) {
      /*
       * If frontend supplied a bill number,
       * validate it.
       *
       * Otherwise generate one.
       */
      if (req.body.billNo) {
        data.billNo = await validateBillNo({
          billNo: req.body.billNo,
          orderDate: data.orderDate,
        });
      } else {
        data.billNo = await generateBillNo(
          data.orderDate
        );
      }

      data.billIssued = true;
      data.billIssuedAt = new Date();
    }

    const sale = await Sale.create(data);

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

    /*
     * Mongo duplicate-key protection.
     */
    if (err.code === 11000) {
      return res.status(400).json({
        message:
          "This bill number is already in use.",
      });
    }

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

    const alreadyHasBill =
      Boolean(existing.billNo) ||
      existing.billIssued === true;

    const requestedBillIssued =
      isTrue(req.body.billIssued);

    const updateData = {
      ...req.body,
    };

    /*
     * Handle bill fields separately.
     */
    delete updateData.billNo;
    delete updateData.billIssued;
    delete updateData.billIssuedAt;

    /*
     * Apply normal editable fields first.
     */
    Object.assign(existing, updateData);

    /*
     * BILL LOGIC
     */

    if (alreadyHasBill) {
      /*
       * Existing bill stays issued.
       */
      existing.billIssued = true;

      /*
       * If the user supplied a NEW bill number,
       * validate and allow editing.
       */
      if (
        req.body.billNo &&
        req.body.billNo !== existing.billNo
      ) {
        existing.billNo = await validateBillNo({
          billNo: req.body.billNo,
          orderDate: existing.orderDate,
          saleId: existing._id,
        });
      }

      /*
       * Safety check for corrupted old records.
       */
      if (!existing.billNo) {
        return res.status(400).json({
          message:
            "This order is marked as billed but has no bill number.",
        });
      }
    } else if (requestedBillIssued) {
      /*
       * First time issuing a bill.
       *
       * Use the manually entered number if provided.
       * Otherwise generate one automatically.
       */
      if (req.body.billNo) {
        existing.billNo = await validateBillNo({
          billNo: req.body.billNo,
          orderDate: existing.orderDate,
          saleId: existing._id,
        });
      } else {
        existing.billNo = await generateBillNo(
          existing.orderDate
        );
      }

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

    if (err.code === 11000) {
      return res.status(400).json({
        message:
          "This bill number is already in use.",
      });
    }

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