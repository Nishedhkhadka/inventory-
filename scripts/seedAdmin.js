/**
 * One-time admin seed script.
 * ─────────────────────────────
 * Creates the FIRST admin user directly in MongoDB, with a bcrypt-hashed
 * password. This is the only place a plain-text password is ever read —
 * from ADMIN_USERNAME/ADMIN_PASSWORD in backend/.env, and only for the
 * duration of this script running. It is never stored anywhere; only its
 * bcrypt hash is written to the database.
 *
 * After running this successfully, REMOVE ADMIN_USERNAME and
 * ADMIN_PASSWORD from .env — they've done their job, and leaving a plain
 * password sitting in a config file defeats the point of hashing it.
 * Every login from now on is verified against the hash in MongoDB, not
 * against .env.
 *
 * Safe to re-run: if an admin user already exists, this refuses to touch
 * anything (no silent overwrite of an existing password) unless you pass
 * --force, which resets that admin's password to whatever is currently in
 * ADMIN_PASSWORD — useful for recovering a lost admin password, but use
 * deliberately.
 *
 * Usage:
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... in backend/.env, then:
 *   node scripts/seedAdmin.js
 *   node scripts/seedAdmin.js --force   (resets an existing admin's password)
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const FORCE = process.argv.includes("--force");

async function run() {
  const { MONGO_URI, ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET } = process.env;

  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set in backend/.env");
  }
  if (!JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is not set in backend/.env — add a long random string (e.g. `openssl rand -hex 32`) before seeding."
    );
  }
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      "Set ADMIN_USERNAME and ADMIN_PASSWORD in backend/.env before running this script (remove them again afterward)."
    );
  }
  if (ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  const username = ADMIN_USERNAME.trim().toLowerCase();
  const existingAdmin = await User.findOne({ role: "admin" });

  if (existingAdmin && !FORCE) {
    console.log(
      `An admin user already exists ("${existingAdmin.username}") — refusing to create another or ` +
        `change the password without --force.\n\nIf you're trying to recover a lost admin password, ` +
        `re-run with:\n  node scripts/seedAdmin.js --force\n`
    );
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await User.hashPassword(ADMIN_PASSWORD);

  if (existingAdmin && FORCE) {
    existingAdmin.username = username;
    existingAdmin.passwordHash = passwordHash;
    await existingAdmin.save();
    console.log(`Updated existing admin "${existingAdmin.username}" with a new password.\n`);
  } else {
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      throw new Error(
        `A user named "${username}" already exists with role "${existingUsername.role}". Choose a ` +
          `different ADMIN_USERNAME, or delete that user first.`
      );
    }
    await User.create({ username, passwordHash, role: "admin" });
    console.log(`Created admin user "${username}".\n`);
  }

  console.log("──────────────────────────────────────────────────");
  console.log("IMPORTANT: remove ADMIN_USERNAME and ADMIN_PASSWORD");
  console.log("from backend/.env now — they're no longer needed.");
  console.log("From here on, login is verified against the bcrypt");
  console.log("hash stored in MongoDB, not against .env.");
  console.log("──────────────────────────────────────────────────\n");

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nSeed failed:", err.message);
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch {}
  }
  process.exit(1);
});
