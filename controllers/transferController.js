import Product from "../models/Product.js";
import StockTransfer from "../models/StockTransfer.js";
import { applyStockDelta } from "../services/inventoryService.js";

// POST /api/transfers
export const transferStock = async (req, res) => {
  try {
    const { productId, color, fromLocationId, toLocationId, quantity, notes } = req.body;
    const qty = Number(quantity);

    if (!productId || !fromLocationId || !toLocationId || !qty || qty <= 0) {
      return res.status(400).json({ message: "All transfer fields are required with a valid quantity." });
    }

    if (fromLocationId === toLocationId) {
      return res.status(400).json({ message: "Source and destination locations cannot be identical." });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found." });

    const colorName = color ? String(color).trim() : "";

    // Verify source location stock
    const sourceLoc = (product.locationStocks || []).find(
      (ls) =>
        ls.location.toString() === fromLocationId.toString() &&
        (ls.color || "") === colorName
    );

    const availableStock = sourceLoc ? sourceLoc.stock : 0;
    if (availableStock < qty) {
      return res.status(400).json({
        message: `Insufficient stock at source location (${availableStock} available for ${colorName || "default"}).`,
      });
    }

    // Move stock
    await applyStockDelta(productId, -qty, colorName, fromLocationId);
    await applyStockDelta(productId, qty, colorName, toLocationId);

    const transfer = await StockTransfer.create({
      product: productId,
      color: colorName,
      fromLocation: fromLocationId,
      toLocation: toLocationId,
      quantity: qty,
      notes: String(notes || "").trim(),
    });

    res.status(201).json(transfer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/transfers/:productId
export const getStockTransfers = async (req, res) => {
  try {
    const transfers = await StockTransfer.find({ product: req.params.productId })
      .populate("fromLocation", "name")
      .populate("toLocation", "name")
      .sort({ createdAt: -1 });

    res.json(transfers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};