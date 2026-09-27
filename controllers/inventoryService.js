import Product from "../models/Product.js";

/**
 * Applies a signed unit delta to a product's stock, and to the matching
 * colour variant's stock if a colour is given. This is the one place that
 * actually touches Product.currentStock / Product.colors[].stock, so both
 * the sale side and the purchase side of the ledger stay consistent.
 *
 * @param {String} productId
 * @param {Number} delta - positive to add stock, negative to remove it
 * @param {String|null} color - colour variant name, or null for uncoloured products
 */
async function applyStockDelta(productId, delta, color = null) {
  if (!delta) return null;

  if (color) {
    // Bump the specific colour variant, then resync the aggregate
    // currentStock field from the variant list in one round trip.
    const updated = await Product.findOneAndUpdate(
      { _id: productId, "colors.name": color },
      { $inc: { "colors.$.stock": delta } },
      { new: true }
    );
    if (updated) {
      updated.currentStock = updated.colors.reduce((sum, c) => sum + (c.stock || 0), 0);
      await updated.save();
      return updated;
    }
    // Colour not found on the product (e.g. it was removed later) — fall
    // through to a plain top-level adjustment so the delta isn't lost.
  }

  return Product.findByIdAndUpdate(productId, { $inc: { currentStock: delta } }, { new: true });
}

/**
 * Central rule for how a sale affects warehouse stock.
 * Stock is deducted the moment an order exists — the default 'In progress'
 * status already holds it reserved — and stays deducted all the way
 * through Packed, Delivered, and Damaged. 'Returned' is the only status
 * that releases it back to sellable stock. Because reconcileStockForSale
 * always applies the DIFFERENCE between the old and new status's effect,
 * a single before/after pair here (rather than a special case per status)
 * is enough to cover every transition: In progress -> Packed -> Delivered
 * moves -qty to -qty to -qty (net zero further change), while anything ->
 * Returned moves -qty to 0 (a +qty restock).
 */
function saleStockEffect(status, quantity) {
  return status === "Returned" ? 0 : -quantity;
}

/**
 * Central rule for how a purchase affects warehouse stock.
 * Goods only physically land in the warehouse once a purchase is marked
 * 'Delivered'. 'Ordered' (still in transit / not yet received) and
 * non-inventory expense categories have no stock effect at all.
 */
function purchaseStockEffect(status, quantity, hasProduct) {
  if (!hasProduct) return 0;
  return status === "Delivered" ? quantity : 0;
}

/**
 * Applies the stock delta between a sale's before/after state to its product.
 * Call this any time a sale is created, updated, or deleted so
 * Product.currentStock always reflects reality.
 *
 * @param {Object} params
 * @param {String} params.productId
 * @param {String|null} params.oldStatus - null when the sale is being created
 * @param {Number} params.oldQuantity - ignored when oldStatus is null
 * @param {String|null} params.oldColor
 * @param {String|null} params.newStatus - null when the sale is being deleted
 * @param {Number} params.newQuantity - ignored when newStatus is null
 * @param {String|null} params.newColor
 */
export async function reconcileStockForSale({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldColor = null,
  newStatus = null,
  newQuantity = 0,
  newColor = null,
}) {
  const before = oldStatus ? saleStockEffect(oldStatus, oldQuantity) : 0;
  const after = newStatus ? saleStockEffect(newStatus, newQuantity) : 0;

  if (before === 0 && after === 0) return null;

  // If the colour changed, reverse the old colour's delta and apply the new
  // colour's delta separately rather than net them against each other.
  if (oldColor !== newColor) {
    if (before !== 0) await applyStockDelta(productId, -before, oldColor);
    if (after !== 0) await applyStockDelta(productId, after, newColor);
    return null;
  }

  const delta = after - before;
  if (delta === 0) return null;
  return applyStockDelta(productId, delta, newColor);
}

/**
 * Applies the stock delta between a purchase's before/after state to its
 * linked product. Mirrors reconcileStockForSale but the sign runs the other
 * way: a 'Delivered' inventory purchase adds units instead of removing them.
 * A no-op when the purchase has no linked product (i.e. it's a plain expense).
 */
export async function reconcileStockForPurchase({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldColor = null,
  oldHasProduct = false,
  newStatus = null,
  newQuantity = 0,
  newColor = null,
  newHasProduct = false,
}) {
  const before = oldStatus && oldHasProduct ? purchaseStockEffect(oldStatus, oldQuantity, true) : 0;
  const after = newStatus && newHasProduct ? purchaseStockEffect(newStatus, newQuantity, true) : 0;

  if (before === 0 && after === 0) return null;

  if (oldColor !== newColor) {
    if (before !== 0) await applyStockDelta(productId, -before, oldColor);
    if (after !== 0) await applyStockDelta(productId, after, newColor);
    return null;
  }

  const delta = after - before;
  if (delta === 0) return null;
  return applyStockDelta(productId, delta, newColor);
}

/**
 * Updates a product's weighted-average costPrice when a purchase newly
 * counts units as received (see purchaseStockEffect) — e.g. its status
 * moves to 'Delivered', or its quantity increases while already
 * Delivered. This is the live-app equivalent of the cost-averaging the
 * Excel import already does (see excelImportService.js) — without it,
 * costPrice only ever reflects whatever was true at import time.
 *
 * Never runs backwards: reducing a purchase's quantity or un-delivering
 * it leaves costPrice as-is, since a weighted average isn't cleanly
 * reversible. A no-op for non-inventory purchases or when no new units
 * are actually being added.
 *
 * IMPORTANT: call this BEFORE reconcileStockForPurchase changes the
 * product's currentStock — the weighted-average formula needs the stock
 * level as it stood before this purchase's units were added.
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
