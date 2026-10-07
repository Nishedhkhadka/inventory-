import Product from "../models/Product.js";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Contact from "../models/Contact.js";

// GET /api/search?q=
// Fans one query out across all three collections in parallel and returns
// a small, ranked set from each so the search modal can render instantly.
export const search = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ products: [], sales: [], purchases: [] });

    const rx = { $regex: q,$options: "i" };

    const matchingSales = await Sale.find({
      $or: [
        { orderId: rx },
        { pointOfContact: rx },
        { deliveryPartner: rx },
        { billNo: rx },
        { customerPhone: rx },
      ],
    })
      .select("orderId")
      .limit(20);

    const baseOrderIds = Array.from(
      new Set(
        matchingSales.map((s) => {
          if (!s.orderId) return s._id.toString();
          return s.orderId.split("-line-")[0];
        })
      )
    );

    const saleGroupPromises = baseOrderIds.map((baseId) =>
      Sale.find({
        $or: [
          { orderId: baseId },
          { orderId: { $regex: `^${baseId}-line-` } },
        ],
      })
        .populate("product", "name")
        .sort({ orderDate: -1 })
    );

    const [products, saleGroups, purchases, contacts] = await Promise.all([
      Product.find({ $or: [{ name: rx }, { sku: rx }] })
        .limit(6)
        .select("name sku type retailPrice currentStock"),

      Promise.all(saleGroupPromises),

      Purchase.find({
        $or: [{ productName: rx }, { supplier: rx }, { notes: rx }, { tags: rx }],
      })
        .limit(6)
        .sort({ orderDate: -1 }),

      Contact.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] })
        .limit(6)
        .sort({ name: 1 })
        .select("name email phone"),
    ]);

    const sales = saleGroups
      .map((groupLines) => {
        if (!groupLines || !groupLines.length) return null;

        const primary =
          groupLines.find((l) => l.billNo) ||
          groupLines.find((l) => l.pointOfContact) ||
          groupLines[0];

        const deliveryLine =
          groupLines.find(
            (l) =>
              l.deliveryFeeCharged !== null &&
              l.deliveryFeeCharged !== undefined
          ) || groupLines[0];

        const lineTotalSum = groupLines.reduce(
          (sum, l) => sum + (Number(l.lineTotal) || 0),
          0
        );
        const deliveryFee = Number(deliveryLine?.deliveryFeeCharged) || 0;
        const grandTotal = Math.round((lineTotalSum + deliveryFee) * 100) / 100;

        const productNames = groupLines
          .map((l) => l.product?.name)
          .filter(Boolean);

        return {
          _id: primary._id,
          orderId: primary.orderId ? primary.orderId.split("-line-")[0] : "",
          pointOfContact: primary.pointOfContact,
          billNo: primary.billNo,
          status: primary.status,
          product: {
            name:
              productNames.length > 1
                ? `${productNames[0]} (+${productNames.length - 1} more)`
                : productNames[0] || "—",
          },
          grandTotal,
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    res.json({ products, sales, purchases, contacts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};