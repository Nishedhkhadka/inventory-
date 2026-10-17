import express from "express";
import {
  getLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from "../controllers/locationController.js";

const router = express.Router();

router.route("/").get(getLocations).post(createLocation);
router.route("/:id").put(updateLocation).delete(deleteLocation);

export default router;