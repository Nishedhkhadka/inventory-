import express from "express";
import { exportAll } from "../controllers/exportController.js";

const router = express.Router();

router.get("/all", exportAll);

export default router;
