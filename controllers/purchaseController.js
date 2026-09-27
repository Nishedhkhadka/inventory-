import Purchase from "../models/Purchase.js";
import Product from "../models/Product.js";
import { reconcileStockForPurchase, reconcileCostPriceForPurchase } from "./inventoryService.js";

// GET /api/purchases
export const getPurchases = async (req, res) => {
  try {
    const { search, status, category, tag, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (tag) filter.tags = tag;
    if (from || to) {
      filter.orderDate = {};
      if (from) filter.orderDate.$gte = new Date(from);
      if (to) filter.orderDate.$lte = new Date(to);
    }
    if (search) {
      filter.$or = [
        { productName: { $regex: search, $options: "i" } },
        { supplier: { $regex: search, $options: "i" } },
        { orderRef: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [purchases, total] = await Promise.all([
      Purchase.find(filter)
        .populate("product", "name sku type")
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Purchase.countDocuments(filter),
    ]);

    res.json({ data: purchases, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/purchases/tags — distinct tag list, for the filter dropdown and
// the tag input's autocomplete suggestions.
export const getPurchaseTags = async (req, res) => {
  try {
    const tags = await Purchase.distinct("tags");
    res.json(tags.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// A starting set so the category picker isn't empty on a fresh database —
// merged with whatever custom categories have actually been used.
const BASELINE_CATEGORIES = ["Inventory", "Meta Ads", "Packaging", "Shipping", "Miscellaneous"];

// GET /api/purchases/categories — baseline categories plus any custom ones
// already in use, for the Expenses page's category picker.
export const getPurchaseCategories = async (req, res) => {
  try {
    const used = await Purchase.distinct("category");
    const categories = [...new Set([...BASELINE_CATEGORIES, ...used.filter(Boolean)])].sort();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/purchases/:id
export const getPurchase = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).populate("product");
    if (!purchase) return res.status(404).json({ message: "Purchase not found" });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/purchases
export const createPurchase = async (req, res) => {
  try {
    if (req.body.product) {
      const product = await Product.findById(req.body.product);
      if (!product) return res.status(400).json({ message: "Product not found" });
      // Keep productName in sync so records stay readable even if the
      // catalog product is later renamed or removed.
      req.body.productName = req.body.productName || product.name;
    }

    const purchase = await Purchase.create(req.body);

    if (purchase.product) {
      // Cost-price update must happen BEFORE the stock change below — it
      // needs the product's stock level as it stood before this
      // purchase's units are added.
      await reconcileCostPriceForPurchase({
        productId: purchase.product,
        oldStatus: null,
        oldHasProduct: false,
        newStatus: purchase.status,
        newQuantity: purchase.quantity || 0,
        newHasProduct: true,
        cost: purchase.cost,
      });
      await reconcileStockForPurchase({
        productId: purchase.product,
        oldStatus: null,
        newStatus: purchase.status,
        newQuantity: purchase.quantity || 0,
        newColor: purchase.color || null,
        newHasProduct: true,
      });
    }

    const populated = await purchase.populate("product", "name sku type currentStock colors");
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/purchases/:id
// Mirrors the sale controller: any change to status/quantity/colour/product
// on an inventory-linked purchase is reconciled against warehouse stock so
// only 'Delivered' inventory purchases ever add units, exactly once.
export const updatePurchase = async (req, res) => {
  try {
    const existing = await Purchase.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Purchase not found" });

    const oldStatus = existing.status;
    const oldQuantity = existing.quantity || 0;
    const oldColor = existing.color || null;
    const oldProductId = existing.product ? existing.product.toString() : null;

    if (req.body.product) {
      const product = await Product.findById(req.body.product);
      if (!product) return res.status(400).json({ message: "Product not found" });
    }

    Object.assign(existing, req.body);
    await existing.save();

    const newProductId = existing.product ? existing.product.toString() : null;
    const newColor = existing.color || null;

    if (oldProductId !== newProductId) {
      if (oldProductId) {
        await reconcileStockForPurchase({
          productId: oldProductId,
          oldStatus,
          oldQuantity,
          oldColor,
          oldHasProduct: true,
          newStatus: null,
          newHasProduct: false,
        });
      }
      if (newProductId) {
        await reconcileCostPriceForPurchase({
          productId: newProductId,
          oldStatus: null,
          oldHasProduct: false,
          newStatus: existing.status,
          newQuantity: existing.quantity || 0,
          newHasProduct: true,
          cost: existing.cost,
        });
        await reconcileStockForPurchase({
          productId: newProductId,
          oldStatus: null,
          oldHasProduct: false,
          newStatus: existing.status,
          newQuantity: existing.quantity || 0,
          newColor,
          newHasProduct: true,
        });
      }
    } else if (newProductId) {
      await reconcileCostPriceForPurchase({
        productId: newProductId,
        oldStatus,
        oldQuantity,
        oldHasProduct: true,
        newStatus: existing.status,
        newQuantity: existing.quantity || 0,
        newHasProduct: true,
        cost: existing.cost,
      });
      await reconcileStockForPurchase({
        productId: newProductId,
        oldStatus,
        oldQuantity,
        oldColor,
        oldHasProduct: true,
        newStatus: existing.status,
        newQuantity: existing.quantity || 0,
        newColor,
        newHasProduct: true,
      });
    }

    const populated = await existing.populate("product", "name sku type currentStock colors");
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/purchases/:id
export const deletePurchase = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: "Purchase not found" });

    if (purchase.product) {
      await reconcileStockForPurchase({
        productId: purchase.product,
        oldStatus: purchase.status,
        oldQuantity: purchase.quantity || 0,
        oldColor: purchase.color || null,
        oldHasProduct: true,
        newStatus: null,
        newHasProduct: false,
      });
    }

    await purchase.deleteOne();
    res.json({ message: "Purchase deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
