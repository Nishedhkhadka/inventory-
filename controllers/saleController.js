import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import AuditLog from "../models/AuditLog.js"; // <-- Import AuditLog
import mongoose from "mongoose";
import { reconcileStockForSale } from "../services/inventoryService.js";

// Helper to log audit actions safely
async function logAudit({ entityId, orderId, action, changes, performedBy = "System", session = null }) {
  try {
    const logData = {
      entityType: "Sale",
      entityId,
      orderId,
      action,
      changes,
      performedBy,
    };
    if (session) {
      await AuditLog.create([logData], { session });
    } else {
      await AuditLog.create(logData);
    }
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

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

    const skip = (Number(page) - 1) * Number(limit);

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
 * GET /api/sales/:id/logs (New endpoint to fetch audit history for an order)
 */
export const getSaleLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({ entityId: req.params.id }).sort({ createdAt: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/*
 * POST /api/sales
 */
export const createSale = async (req, res) => {
  try {
    const product = await Product.findById(req.body.product);

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

    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: null,
      oldLocationId: null,
      newStatus: sale.status,
      newQuantity: sale.quantity,
      newColor: sale.color || null,
      newLocationId: sale.location || null,
    });

    // Record Audit Log
    await logAudit({
      entityId: sale._id,
      orderId: sale.orderId,
      action: "CREATE",
      changes: `Created sale line for product ${product.name} (Qty: ${sale.quantity}, Status: ${sale.status})`,
      performedBy: req.user?.username || "System",
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
 * POST /api/sales/batch
 */
export const createBatchSales = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { lines, shared } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: "No order lines provided" });
    }

    const createdSales = [];

    for (const line of lines) {
      const product = await Product.findById(line.product).session(session);
      if (!product) {
        throw new Error(`Product not found: ${line.product}`);
      }

      const data = {
        ...shared,
        ...line,
        billNo:
          shared.billNo === undefined ||
          shared.billNo === null ||
          String(shared.billNo).trim() === ""
            ? null
            : String(shared.billNo).trim(),
      };

      const [sale] = await Sale.create([data], { session });

      await reconcileStockForSale({
        productId: sale.product,
        oldStatus: null,
        oldLocationId: null,
        newStatus: sale.status,
        newQuantity: sale.quantity,
        newColor: sale.color || null,
        newLocationId: sale.location || null,
      });

      await logAudit({
        entityId: sale._id,
        orderId: sale.orderId,
        action: "CREATE",
        changes: `Batch order line created for ${product.name} (Qty: ${sale.quantity})`,
        performedBy: req.user?.username || "System",
        session,
      });

      const populated = await sale.populate({
        path: "product",
        select: "name sku type retailPrice currentStock colors locationStocks",
        session,
      });

      createdSales.push(populated);
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(createdSales);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("createBatchSales transaction error:", err);
    res.status(400).json({ message: err.message });
  }
};

/*
 * PUT /api/sales/:id
 */
export const updateSale = async (req, res) => {
  try {
    const existing = await Sale.findById(req.params.id);

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

    const updateData = { ...req.body };

    if (
      updateData.billNo === undefined ||
      updateData.billNo === null ||
      String(updateData.billNo).trim() === ""
    ) {
      updateData.billNo = null;
    } else {
      updateData.billNo = String(updateData.billNo).trim();
    }

    delete updateData.billIssued;
    delete updateData.billIssuedAt;

    // Detect what changed for audit log
    const changeSummary = [];
    if (updateData.status && updateData.status !== oldStatus) {
      changeSummary.push(`Status changed from "${oldStatus}" to "${updateData.status}"`);
    }
    if (updateData.quantity !== undefined && Number(updateData.quantity) !== oldQuantity) {
      changeSummary.push(`Quantity changed from ${oldQuantity} to ${updateData.quantity}`);
    }
    if (updateData.notes !== undefined && updateData.notes !== existing.notes) {
      changeSummary.push(`Notes updated`);
    }

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

    // Record Audit Log
    await logAudit({
      entityId: existing._id,
      orderId: existing.orderId,
      action: updateData.status && updateData.status !== oldStatus ? "STATUS_CHANGE" : "UPDATE",
      changes: changeSummary.length > 0 ? changeSummary.join(", ") : "Order details updated",
      performedBy: req.user?.username || "System",
    });

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
    const sale = await Sale.findById(req.params.id);

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

    // Record Audit Log before deletion
    await logAudit({
      entityId: sale._id,
      orderId: sale.orderId,
      action: "DELETE",
      changes: `Deleted sale order line (Status was: ${sale.status})`,
      performedBy: req.user?.username || "System",
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