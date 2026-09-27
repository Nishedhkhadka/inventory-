import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Requires a valid JWT (issued by POST /api/auth/login) in the
 * Authorization: Bearer <token> header. Attaches the authenticated user
 * (minus passwordHash) to req.user for downstream handlers/middleware.
 */
export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
}

/**
 * Use after `protect` to restrict a route to admins only (e.g. user
 * management, full financial analytics).
 */
export function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
