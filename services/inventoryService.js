import Product from "../models/Product.js";
import Location from "../models/Location.js";

/**
 * Applies a signed unit delta to a product's stock, to the matching colour
 * variant, and to the specified location's stock breakdown.
 *
 * @param {String} productId
 * @param {Number} delta - positive to add stock, negative to remove it
 * @param {String|null} color - colour variant name, or null/empty for uncoloured products
 * @param {String|null} locationId - location ID to adjust stock for
 */
async function applyStockDelta(productId, delta, color = null, locationId = null) {
  if (!delta) return null;

  const colorName = color ? String(color).trim() : "";

  // Get default location if no locationId is specified
  let targetLocationId = locationId;
  if (!targetLocationId) {
    const defaultLoc = await Location.findOne({ isDefault: true });
    if (defaultLoc) targetLocationId = defaultLoc._id;
  }

  // 1. Bump colour variant aggregate stock
  if (colorName) {
    await Product.updateOne(
      { _id: productId, "colors.name": colorName },
      { $inc: { "colors.$.stock": delta } }
    );
  }

  // 2. Bump overall product currentStock
  await Product.updateOne({ _id: productId }, { $inc: { currentStock: delta } });

  // 3. Bump per-location stock breakdown for this color variant
  if (targetLocationId) {
    const product = await Product.findById(productId);
    if (product) {
      const locMatch = (product.locationStocks || []).find(
        (ls) =>
          ls.location.toString() === targetLocationId.toString() &&
          (ls.color || "") === colorName
      );

      if (locMatch) {
        await Product.updateOne(
          {
            _id: productId,
            "locationStocks.location": targetLocationId,
            "locationStocks.color": colorName,
          },
          { $inc: { "locationStocks.$.stock": delta } }
        );
      } else {
        await Product.updateOne(
          { _id: productId },
          {
            $push: {
              locationStocks: {
                location: targetLocationId,
                color: colorName,
                stock: Math.max(0, delta),
              },
            },
          }
        );
      }
    }
  }

  return Product.findById(productId);
}

/**
 * Central rule for how a sale affects warehouse stock.
 */
function saleStockEffect(status, quantity) {
  return status === "Returned" ? 0 : -quantity;
}

/**
 * Central rule for how a purchase affects warehouse stock.
 */
function purchaseStockEffect(status, quantity, hasProduct) {
  if (!hasProduct) return 0;
  return status === "Delivered" ? quantity : 0;
}

/**
 * Applies the stock delta between a sale's before/after state to its product.
 */
export async function reconcileStockForSale({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldColor = null,
  oldLocationId = null,
  newStatus = null,
  newQuantity = 0,
  newColor = null,
  newLocationId = null,
}) {
  const before = oldStatus ? saleStockEffect(oldStatus, oldQuantity) : 0;
  const after = newStatus ? saleStockEffect(newStatus, newQuantity) : 0;

  if (before === 0 && after === 0) return null;

  if (oldColor !== newColor || String(oldLocationId) !== String(newLocationId)) {
    if (before !== 0) await applyStockDelta(productId, -before, oldColor, oldLocationId);
    if (after !== 0) await applyStockDelta(productId, after, newColor, newLocationId);
    return null;
  }

  const delta = after - before;
  if (delta === 0) return null;
  return applyStockDelta(productId, delta, newColor, newLocationId);
}

/**
 * Applies the stock delta between a purchase's before/after state to its linked product.
 */
export async function reconcileStockForPurchase({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldColor = null,
  oldLocationId = null,
  oldHasProduct = false,
  newStatus = null,
  newQuantity = 0,
  newColor = null,
  newLocationId = null,
  newHasProduct = false,
}) {
  const before = oldStatus && oldHasProduct ? purchaseStockEffect(oldStatus, oldQuantity, true) : 0;
  const after = newStatus && newHasProduct ? purchaseStockEffect(newStatus, newQuantity, true) : 0;

  if (before === 0 && after === 0) return null;

  if (oldColor !== newColor || String(oldLocationId) !== String(newLocationId)) {
    if (before !== 0) await applyStockDelta(productId, -before, oldColor, oldLocationId);
    if (after !== 0) await applyStockDelta(productId, after, newColor, newLocationId);
    return null;
  }

  const delta = after - before;
  if (delta === 0) return null;
  return applyStockDelta(productId, delta, newColor, newLocationId);
}

/**
 * Updates a product's weighted-average costPrice when a purchase newly counts units as received.
 */
export async function reconcileCostPriceForPurchase({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldHasProduct = false,
  newStatus = null,
  newQuantity = 0,
  newHasProduct = false,
  cost = 0,
}) {
  const before = oldStatus && oldHasProduct ? purchaseStockEffect(oldStatus, oldQuantity, true) : 0;
  const after = newStatus && newHasProduct ? purchaseStockEffect(newStatus, newQuantity, true) : 0;
  const addedUnits = after - before;
  if (addedUnits <= 0 || !newQuantity) return null;

  const product = await Product.findById(productId);
  if (!product) return null;

  const costPerUnit = (cost || 0) / newQuantity;
  const oldStock = Math.max(0, product.currentStock || 0);
  const oldAvgCost = product.costPrice || 0;
  const newAvgCost = (oldAvgCost * oldStock + costPerUnit * addedUnits) / (oldStock + addedUnits);

  await Product.findByIdAndUpdate(productId, { costPrice: Math.round(newAvgCost * 100) / 100 });
  return newAvgCost;
}

export { applyStockDelta };