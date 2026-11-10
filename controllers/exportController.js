const SALES_COLUMNS = [
  { header: "Order", key: "orderId", width: 16 },
  { header: "Bill No", key: "billNo", width: 16 },
  { header: "Product", key: "product", width: 24 },
  { header: "Colour", key: "color", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "Order date", key: "orderDate", width: 14 },
  { header: "Quantity", key: "quantity", width: 10 },
  { header: "Regular unit price", key: "unitPrice", width: 16 },
  { header: "Line total", key: "lineTotal", width: 14 },
  { header: "Discount", key: "discount", width: 12 },
  { header: "Delivery fee (customer)", key: "deliveryFeeCharged", width: 18 },
  { header: "Delivery cost (courier)", key: "deliveryCost", width: 18 },
  { header: "Grand total", key: "grandTotal", width: 14 },
  { header: "Delivery partner", key: "deliveryPartner", width: 16 },
  { header: "Customer", key: "pointOfContact", width: 20 },
  { header: "Phone", key: "customerPhone", width: 16 },
  { header: "Payment", key: "paidStatus", width: 12 },
  { header: "Notes", key: "notes", width: 30 },
  { header: "Invoice remarks", key: "invoiceRemarks", width: 30 }, // <-- Added here
];

function salesRow(s) {
  const feeKnown =
    s.deliveryFeeCharged !== null && s.deliveryFeeCharged !== undefined;
  return {
    orderId: s.orderId || "",
    billNo: s.billNo  || "",
    product: s.product?.name || "—",
    color: s.color || "",
    status: s.status,
    orderDate: s.orderDate ? s.orderDate.toISOString().slice(0, 10) : "",
    quantity: s.quantity,
    unitPrice: money(s.unitPrice),
    lineTotal: money(s.lineTotal),
    discount: money(s.discount),
    deliveryFeeCharged: feeKnown ? money(s.deliveryFeeCharged) : "",
    deliveryCost: money(s.deliveryCost),
    grandTotal:
      money(s.lineTotal) + (feeKnown ? money(s.deliveryFeeCharged) : 0),
    deliveryPartner: s.deliveryPartner || "",
    pointOfContact: s.pointOfContact || "",
    customerPhone: s.customerPhone || "",
    paidStatus: s.paidStatus,
    notes: s.notes || "",
    invoiceRemarks: s.invoiceRemarks || "", // <-- Added here
  };
}