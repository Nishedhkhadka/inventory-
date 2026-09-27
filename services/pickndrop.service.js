import axios from "axios";



export async function getOrderStatus(orderId) {
  try {
  const BASE_URL = process.env.PICKNDROP_BASE_URL;
const API_KEY = process.env.PICKNDROP_API_KEY;
const API_SECRET = process.env.PICKNDROP_API_SECRET;

    const url = `${BASE_URL}/api/method/logi360.api.get_order_details`;

    console.log("URL =", url);

    const response = await axios.get(url, {
      params: {
        order_id: orderId,
      },
      headers: {
        Authorization: `token ${API_KEY}:${API_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    console.log(response.data);

    const order = response.data?.message?.data?.[0];

    if (!order) {
      return null;
    }

    return {
      orderId: order.order_name,
      courierStatus: order.status,
      customerName: order.customer_name,
      codAmount: order.cod_amount,
      deliveryAmount: order.delivery_amount,
      deliveredDate: order.delivered_date,
      logs: order.status_logs,
    };
  } catch (err) {
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data);
    console.error("Message:", err.message);
    throw err;
  }
}