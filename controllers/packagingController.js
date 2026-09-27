import Sale from "../models/Sale.js";
import { reconcileStockForSale } from "./inventoryService.js";
import { extractText } from "../services/ocr.service.js";
import { matchOrder } from "../services/orderMatching.service.js";

// GET /api/packaging/pending
// Every order still 'In progress', newest first — the packaging page's
// card list. Deliberately not date-scoped: a packer working through a
// backlog should still see everything waiting to be packed, not just
// today's orders.
export const getPendingPackaging = async (req, res) => {
  try {
    const sales = await Sale.find({ status: "In progress" })
      .populate("product", "name colors")
      .sort({ orderDate: -1 });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/packaging/verify  (multipart/form-data, field "photo")
// Runs OCR on the uploaded package photo, then fuzzy-matches the detected
// text against every currently-pending order. Does NOT change any Sale —
// this only returns candidates for the packer to confirm.
export const verifyPackage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No photo uploaded. Attach an image as "photo".' });
    }

    const ocrText = await extractText(req.file.path);
    const pending = await Sale.find({ status: "In progress" }).populate("product", "name colors");
    const { matches } = matchOrder(ocrText, pending);

    res.json({
      // Relative path — the frontend builds the full URL against its API
      // base, and this is what gets stored on the Sale on confirm.
      imagePath: `packages/${req.file.filename}`,
      ocrText,
      matches: matches.slice(0, 15).map((m) => ({
        saleId: m.sale._id,
        orderId: m.sale.orderId,
        customer: m.sale.pointOfContact,
        product: m.sale.product?.name,
        color: m.sale.color,
        confidence: m.score,
        matchedOn: m.matchedOn,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/packaging/confirm
// Body: { saleId, imagePath, ocrText, confidence }
// Moves the chosen order to Packed and records the verification. Routes
// through the same reconcileStockForSale every other status change uses —
// since In progress and Packed both hold stock deducted (see
// inventoryService.saleStockEffect), this is a net-zero stock change, but
// going through the shared function is what guarantees that instead of
// assuming it.
export const confirmPackaging = async (req, res) => {
  try {
    const { saleId, imagePath, ocrText, confidence } = req.body;
    if (!saleId || !imagePath) {
      return res.status(400).json({ message: "saleId and imagePath are required" });
    }

    const sale = await Sale.findById(saleId);
    if (!sale) return res.status(404).json({ message: "Sale not found" });
    if (sale.status !== "In progress") {
      return res.status(400).json({
        message: `This order is no longer pending packaging (current status: ${sale.status}).`,
      });
    }

    const oldStatus = sale.status;
    sale.status = "Packed";
    sale.packagePhoto = imagePath;
    sale.packagedAt = new Date();
    sale.ocrText = ocrText || null;
    sale.ocrConfidence = typeof confidence === "number" ? confidence : Number(confidence) || null;
    await sale.save();

    await reconcileStockForSale({
      productId: sale.product,
      oldStatus,
      oldQuantity: sale.quantity,
      oldColor: sale.color || null,
      newStatus: sale.status,
      newQuantity: sale.quantity,
      newColor: sale.color || null,
    });

    const populated = await sale.populate("product", "name colors");
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
