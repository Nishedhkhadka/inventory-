import Product from "../models/Product.js";
import StockLog from "../models/StockLog.js";

// GET /api/products
export const getProducts = async (req, res) => {
  try {
    const { search, type, lowStockOnly } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }
    if (type) filter.type = type;

    let products = await Product.find(filter).sort({ createdAt: -1 });

    if (lowStockOnly === "true") {
      products = products.filter((p) => p.currentStock <= p.lowStockAlert);
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/products/:id
export const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/products
export const createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/products/:id
// A manual edit that changes currentStock (via the Inventory page's edit
// form — automatic changes from Sales/Delivered or Expenses/Delivered
// don't go through this route) requires a reason, logged to StockLog so
// there's always an answer to "why did this count change?".
export const updateProduct = async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Product not found" });

    const { stockChangeComment, ...updates } = req.body;
    const newStock =
      updates.currentStock !== undefined ? Number(updates.currentStock) : existing.currentStock;
    const stockChanged = newStock !== existing.currentStock;

    if (stockChanged && !String(stockChangeComment || "").trim()) {
      return res.status(400).json({ message: "Please provide a reason for this stock change." });
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (stockChanged) {
      await StockLog.create({
        product: product._id,
        previousStock: existing.currentStock,
        newStock,
        delta: newStock - existing.currentStock,
        comment: stockChangeComment.trim(),
      });
    }

    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// GET /api/products/:id/stock-log — audit trail for a product's manual
// stock edits, newest first.
export const getProductStockLog = async (req, res) => {
  try {
    const logs = await StockLog.find({ product: req.params.id }).sort({ createdAt: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/products/:id
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
