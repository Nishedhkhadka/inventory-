import express from "express";
import {
  getLocations,
  createLocation,
} from "../controllers/locationController.js";

const router = express.Router();

router.route("/").get(getLocations).post(createLocation);

export default router;