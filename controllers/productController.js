import Product from "../models/Product.js";
import ProductType from "../models/ProductType.js";
import StockLog from "../models/StockLog.js";

const BASELINE_TYPES = [
  "Lamp",
  "Wallet",
  "Pouch",
  "Decor",
  "Packaging",
  "Miscellaneous",
];

const normalizeTypeName = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

export const getProductTypes = async (req, res) => {
  try {
    const distinct = await Product.distinct("type");
    const savedTypes = await ProductType.find({}).sort({ name: 1 }).lean();
    const merged = [
      ...new Set([
        ...BASELINE_TYPES,
        ...distinct.filter(Boolean),
        ...savedTypes.map((type) => type.name).filter(Boolean),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    res.json(merged);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createProductType = async (req, res) => {
  try {
    const name = normalizeTypeName(req.body?.name || req.body?.type);
    if (!name)
      return res.status(400).json({ message: "Type name is required" });

    const productType = await ProductType.findOneAndUpdate(
      { name },
      { name },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(201).json(productType);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const updateProductType = async (req, res) => {
  try {
    const oldName = normalizeTypeName(req.params.typeName);
    const newName = normalizeTypeName(req.body?.name || req.body?.type);

    if (!oldName || !newName) {
      return res.status(400).json({ message: "Type names are required" });
    }

    if (oldName === "Miscellaneous") {
      return res
        .status(400)
        .json({ message: "Miscellaneous cannot be renamed" });
    }

    const result = await Product.updateMany(
      { type: oldName },
      { $set: { type: newName } },
    );

    await ProductType.findOneAndUpdate(
      { name: oldName },
      { name: newName },
      { upsert: true, new: true },
    );

    res.json({
      oldName,
      newName,
      updated: result.modifiedCount,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteProductType = async (req, res) => {
  try {
    const name = normalizeTypeName(req.params.typeName);
    if (!name)
      return res.status(400).json({ message: "Type name is required" });

    if (name === "Miscellaneous") {
      return res
        .status(400)
        .json({ message: "Miscellaneous cannot be deleted" });
    }

    const result = await Product.updateMany(
      { type: name },
      { $set: { type: "Miscellaneous" } },
    );

    await ProductType.deleteOne({ name });
    res.json({
      message: "Type deleted",
      movedTo: "Miscellaneous",
      updated: result.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

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
    if (!existing)
      return res.status(404).json({ message: "Product not found" });

    const { stockChangeComment, ...updates } = req.body;
    const newStock =
      updates.currentStock !== undefined
        ? Number(updates.currentStock)
        : existing.currentStock;
    const stockChanged = newStock !== existing.currentStock;

    if (stockChanged && !String(stockChangeComment || "").trim()) {
      return res
        .status(400)
        .json({ message: "Please provide a reason for this stock change." });
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
    const logs = await StockLog.find({ product: req.params.id }).sort({
      createdAt: -1,
    });
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
