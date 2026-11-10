import express from "express";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "../controllers/businessProfileController.js";

const router = express.Router();

router.route("/").get(getBusinessProfile).put(updateBusinessProfile);

export default router;