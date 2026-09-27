import express from 'express';
import { getOrderStatus } from '../services/pickndrop.service.js';

const router = express.Router();

router.get('/status/:orderId', async (req, res) => {
  try {
    const data = await getOrderStatus(req.params.orderId);

    if (!data) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(data);
  } catch (err) {
  console.error(err.response?.status);
  console.error(err.response?.data);
  console.error(err.message);

  res.status(500).json({
    message: "Failed to fetch Pick & Drop status",
    details: err.response?.data || err.message,
  });
}
});

export default router;