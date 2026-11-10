import Product from "../models/Product.js";
import Location from "../models/Location.js";

/**
 * Backfills all products without location-specific inventory 
 * so that their stock and colour variants reside in the default location.
 */
export async function initializeDefaultLocationStocks() {
  try {
    let defaultLoc = await Location.findOne({ isDefault: true });

    if (!defaultLoc) {
      defaultLoc = await Location.create({
        name: "Main Warehouse",
        isDefault: true,
      });
    }

    const products = await Product.find({});

    for (const product of products) {
      let updated = false;

      if (product.colors && product.colors.length > 0) {
        for (const colorObj of product.colors) {
          const exists = (product.locationStocks || []).some(
            (ls) =>
              ls.location &&
              ls.location.toString() === defaultLoc._id.toString() &&
              ls.color === colorObj.name
          );

          if (!exists) {
            if (!product.locationStocks) product.locationStocks = [];
            product.locationStocks.push({
              location: defaultLoc._id,
              color: colorObj.name,
              stock: Math.max(0, colorObj.stock || 0),
            });
            updated = true;
          }
        }
      } else {
        const exists = (product.locationStocks || []).some(
          (ls) =>
            ls.location &&
            ls.location.toString() === defaultLoc._id.toString() &&
            (!ls.color || ls.color === "")
        );

        if (!exists) {
          if (!product.locationStocks) product.locationStocks = [];
          product.locationStocks.push({
            location: defaultLoc._id,
            color: "",
            stock: Math.max(0, product.currentStock || 0),
          });
          updated = true;
        }
      }

      if (updated) {
        await product.save();
      }
    }
  } catch (err) {
    console.error("Error initializing default location stocks:", err);
  }
}

async function applyStockDelta(productId, delta, color = null, locationId = null) {
  if (!delta) return null;

  const colorName = color ? String(color).trim() : "";

  let targetLocationId = locationId;
  if (!targetLocationId) {
    const defaultLoc = await Location.findOne({ isDefault: true });
    if (defaultLoc) targetLocationId = defaultLoc._id;
  }

  if (colorName) {
    const prodCheck = await Product.findOne({ _id: productId, "colors.name": colorName });
    if (prodCheck) {
      const targetColor = prodCheck.colors.find((c) => c.name === colorName);
      const newColorStock = Math.max(0, (targetColor?.stock || 0) + delta);
      await Product.updateOne(
        { _id: productId, "colors.name": colorName },
        { $set: { "colors.$.stock": newColorStock } }
      );
    }
  }

  const productDoc = await Product.findById(productId);
  if (productDoc) {
    const newGlobalStock = Math.max(0, (productDoc.currentStock || 0) + delta);
    await Product.updateOne({ _id: productId }, { $set: { currentStock: newGlobalStock } });
  }

  if (targetLocationId) {
    const freshProduct = await Product.findById(productId);
    if (freshProduct) {
      if (!freshProduct.locationStocks) freshProduct.locationStocks = [];

      const locMatchIndex = freshProduct.locationStocks.findIndex(
        (ls) =>
          ls.location &&
          ls.location.toString() === targetLocationId.toString() &&
          (ls.color || "") === colorName
      );

      if (locMatchIndex > -1) {
        const existingStock = freshProduct.locationStocks[locMatchIndex].stock || 0;
        const updatedLocStock = Math.max(0, existingStock + delta);
        freshProduct.locationStocks[locMatchIndex].stock = updatedLocStock;
      } else {
        freshProduct.locationStocks.push({
          location: targetLocationId,
          color: colorName,
          stock: Math.max(0, delta),
        });
      }

      await freshProduct.save();
    }
  }

  return Product.findById(productId);
}

function saleStockEffect(status, quantity) {
  return status === "Returned" ? 0 : -quantity;
}

function purchaseStockEffect(status, quantity, hasProduct) {
  if (!hasProduct) return 0;
  return status === "Delivered" ? quantity : 0;
}

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
 * Implements Perpetual Weighted Average Inventory Costing with absolute net financial valuation deltas.
 */
export async function reconcileCostPriceForPurchase({
  productId,
  oldStatus = null,
  oldQuantity = 0,
  oldCost = 0,
  oldHasProduct = false,
  newStatus = null,
  newQuantity = 0,
  newCost = 0,
  newHasProduct = false,
}) {
  const beforeUnits = oldStatus === "Delivered" && oldHasProduct ? oldQuantity : 0;
  const afterUnits = newStatus === "Delivered" && newHasProduct ? newQuantity : 0;
  
  const beforeTotalCost = beforeUnits > 0 ? oldCost : 0;
  const afterTotalCost = afterUnits > 0 ? newCost : 0;

  const netUnits = afterUnits - beforeUnits;
  const netCostDelta = afterTotalCost - beforeTotalCost;

  if (netUnits === 0 && netCostDelta === 0) return null;

  const product = await Product.findById(productId);
  if (!product) return null;

  const currentStock = Math.max(0, product.currentStock || 0);
  const currentAvgCost = product.costPrice || 0;
  const currentTotalValuation = currentStock * currentAvgCost;

  let newAvgCost = currentAvgCost;
  const newStock = currentStock + netUnits;

  if (newStock <= 0) {
    newAvgCost = 0;
  } else {
    const newTotalValuation = Math.max(0, currentTotalValuation + netCostDelta);
    newAvgCost = newTotalValuation / newStock;
  }

  const roundedAvgCost = Math.round(Math.max(0, newAvgCost) * 100) / 100;

  await Product.findByIdAndUpdate(productId, { costPrice: roundedAvgCost });
  return roundedAvgCost;
}

export function matchOrder(ocrText, pendingSales) {
  const text = (ocrText || "").toLowerCase();
  const matches = (pendingSales || []).map((sale) => {
    let score = 0;
    const matchedOn = [];

    const orderId = (sale.orderId || "").toLowerCase();
    if (orderId && text.includes(orderId)) {
      score += 50;
      matchedOn.push("orderId");
    }

    const phone = (sale.customerPhone || "").toLowerCase();
    if (phone && text.includes(phone)) {
      score += 40;
      matchedOn.push("phone");
    }

    const customer = (sale.pointOfContact || "").toLowerCase();
    if (customer && customer.length > 2 && text.includes(customer)) {
      score += 30;
      matchedOn.push("customer");
    }

    return {
      sale,
      score,
      matchedOn,
    };
  });

  matches.sort((a, b) => b.score - a.score);
  return { matches };
}

export { applyStockDelta };