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

    const rx = { $regex: q, $options: "i" };

    const [products, sales, purchases, contacts] = await Promise.all([
      Product.find({ $or: [{ name: rx }, { sku: rx }] })
        .limit(6)
        .select("name sku type retailPrice currentStock"),

      Sale.find({ $or: [{ orderId: rx }, { pointOfContact: rx }, { deliveryPartner: rx }, { billNo: rx }, { customerPhone: rx }] })
        .populate("product", "name")
        .limit(6)
        .sort({ orderDate: -1 }),

      Purchase.find({ $or: [{ productName: rx }, { supplier: rx }, { notes: rx }, { tags: rx }] })
        .limit(6)
        .sort({ orderDate: -1 }),

        Contact.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] })
        .limit(6)
        .sort({ name: 1 })
        .select("name email phone"),
    ]);

    res.json({ products, sales, purchases, contacts }); 
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
