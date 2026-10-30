import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { reconcileStockForSale } from "../services/inventoryService.js";

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
          "name sku type retailPrice currentStock colors locationStocks"
        )
        .populate("location", "name isDefault")
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
    const sale = await Sale.findById(req.params.id)
      .populate("product")
      .populate("location", "name isDefault");

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
 *
 * Bill numbers are completely manual.
 * The frontend may provide billNo, or leave it empty.
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

    const data = {
      ...req.body,
      billNo:
        req.body.billNo === undefined ||
        req.body.billNo === null ||
        String(req.body.billNo).trim() === ""
          ? null
          : String(req.body.billNo).trim(),
    };

    const sale = await Sale.create(data);

    /*
     * Reconcile stock for creation. 
     * Note: If status is "Returning", inventoryService will naturally treat 
     * it as in-transit back to warehouse (no stock added back yet).
     */
    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: null,
      oldLocationId: null,
      newStatus: sale.status,
      newQuantity: sale.quantity,
      newColor: sale.color || null,
      newLocationId: sale.location || null,
    });

    const populated = await sale.populate(
      "product",
      "name sku type retailPrice currentStock colors locationStocks"
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
 *
 * Handles status updates (e.g., moving an item to "Returning" while on transit,
 * or creating/updating replacement lines for exchanges).
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
    const oldLocationId = existing.location ? existing.location.toString() : null;
    const oldProductId = existing.product.toString();

    const updateData = {
      ...req.body,
    };

    if (
      updateData.billNo === undefined ||
      updateData.billNo === null ||
      String(updateData.billNo).trim() === ""
    ) {
      updateData.billNo = null;
    } else {
      updateData.billNo =
        String(updateData.billNo).trim();
    }

    delete updateData.billIssued;
    delete updateData.billIssuedAt;

    Object.assign(existing, updateData);

    await existing.save();

    const newProductId = existing.product.toString();
    const newColor = existing.color || null;
    const newLocationId = existing.location ? existing.location.toString() : null;

    if (oldProductId !== newProductId) {
      await reconcileStockForSale({
        productId: oldProductId,
        oldStatus,
        oldQuantity,
        oldColor,
        oldLocationId,
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
        newLocationId,
      });
    } else {
      await reconcileStockForSale({
        productId: newProductId,
        oldStatus,
        oldQuantity,
        oldColor,
        oldLocationId,
        newStatus: existing.status,
        newQuantity: existing.quantity,
        newColor,
        newLocationId,
      });
    }

    const populated = await existing.populate(
      "product",
      "name sku type retailPrice currentStock colors locationStocks"
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

    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: sale.status,
      oldQuantity: sale.quantity,
      oldColor: sale.color || null,
      oldLocationId: sale.location || null,
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