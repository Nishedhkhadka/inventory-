import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { reconcileStockForSale } from "./inventoryService.js";

// GET /api/sales
export const getSales = async (req, res) => {
  try {
    const { search, status, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
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
      const rx = { $regex: search, $options: "i" };
      // Product is a reference, not a text field on Sale itself — find
      // matching product IDs first so "search by product name" works too.
      const matchingProducts = await Product.find({ name: rx }, "_id");
      filter.$or = [
        { orderId: rx },
        { pointOfContact: rx },
        { customerPhone: rx },
        { deliveryPartner: rx },
        { color: rx },
        { product: { $in: matchingProducts.map((p) => p._id) } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [sales, total] = await Promise.all([
      Sale.find(filter)
        .populate("product", "name sku type retailPrice currentStock colors")
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Sale.countDocuments(filter),
    ]);

    res.json({ data: sales, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/sales/:id
export const getSale = async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate("product");
    if (!sale) return res.status(404).json({ message: "Sale not found" });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/sales
export const createSale = async (req, res) => {
  try {
    const product = await Product.findById(req.body.product);
    if (!product) return res.status(400).json({ message: "Product not found" });

    const sale = await Sale.create(req.body);

    // A sale can be created directly with status 'Delivered', so the stock
    // effect must be applied on create too, not just on later updates.
    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: null,
      newStatus: sale.status,
      newQuantity: sale.quantity,
      newColor: sale.color || null,
    });

    const populated = await sale.populate("product", "name sku type retailPrice currentStock colors");
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/sales/:id
// Handles every stock-relevant transition: creating/editing while In
// progress, Packed, Delivered, or Damaged all keep the order's quantity
// deducted from stock; only a change to/from Returned moves stock (see
// inventoryService.saleStockEffect for the full rule). Also handles a
// quantity/colour edit on an already-deducted order (adjusts by the
// difference) and a product swap.
export const updateSale = async (req, res) => {
  try {
    const existing = await Sale.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Sale not found" });

    const oldStatus = existing.status;
    const oldQuantity = existing.quantity;
    const oldColor = existing.color || null;
    const oldProductId = existing.product.toString();

    Object.assign(existing, req.body);
    await existing.save();

    const newProductId = existing.product.toString();
    const newColor = existing.color || null;

    if (oldProductId !== newProductId) {
      // Product changed: fully reverse the effect on the old product,
      // fully apply the new effect on the new product.
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

    const populated = await existing.populate("product", "name sku type retailPrice currentStock colors");
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/sales/:id
export const deleteSale = async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "Sale not found" });

    await reconcileStockForSale({
      productId: sale.product,
      oldStatus: sale.status,
      oldQuantity: sale.quantity,
      oldColor: sale.color || null,
      newStatus: null,
      newQuantity: 0,
    });

    await sale.deleteOne();
    res.json({ message: "Sale deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
