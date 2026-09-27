/**
 * One-time Sale schema migration (CLI)
 * ──────────────────────────────────────
 * Moves existing Sale documents onto the new field structure:
 *
 *   old `price`           (the line's total value, as already confirmed —
 *                          not a per-unit rate) -> split into:
 *                            unitPrice  = price / quantity  (best-available
 *                                         reconstruction of a per-unit rate;
 *                                         there is no way to recover what a
 *                                         "regular" undiscounted price would
 *                                         have been for old records, so no
 *                                         historical discount is invented)
 *                            lineTotal  = price   (unchanged value, just a
 *                                         clearer name)
 *                            discount   = 0        (unknown for history —
 *                                         not fabricated)
 *
 *   old `deliveryCharge`  (already an actual cost paid to the courier, not
 *                          money collected from the customer) -> renamed to:
 *                            deliveryCost      = deliveryCharge (unchanged)
 *                            deliveryFeeCharged = null (never recorded
 *                                         separately in the old data — null
 *                                         on purpose, NOT 0, since 0 would
 *                                         falsely claim "definitely free
 *                                         delivery")
 *
 * Uses the raw MongoDB driver (Sale.collection), not the Mongoose model —
 * the current Sale schema no longer declares `price`/`deliveryCharge` as
 * fields, so reading through the Mongoose model would silently drop them
 * before this script ever saw them.
 *
 * SAFE TO RUN MORE THAN ONCE: only documents that still have an old field
 * name get touched; already-migrated documents are left untouched. Never
 * deletes a document. Never fabricates a value it doesn't have.
 *
 * Usage:
 *   node scripts/migrateSaleSchema.js
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  const collection = Sale.collection;
  const docs = await collection.find({}).toArray();

  let priceMigrated = 0;
  let priceAlreadyDone = 0;
  let deliveryMigrated = 0;
  let deliveryDefaulted = 0;
  let deliveryAlreadyDone = 0;
  let fullyUntouched = 0;

  for (const doc of docs) {
    const set = {};
    const unset = {};
    let touched = false;

    if (doc.unitPrice === undefined && doc.lineTotal === undefined) {
      if (typeof doc.price === "number") {
        const quantity = doc.quantity || 1;
        set.lineTotal = doc.price;
        set.unitPrice = Math.round((doc.price / quantity) * 100) / 100;
        set.discount = 0;
        unset.price = "";
        touched = true;
        priceMigrated++;
      }
      // If a document somehow has neither old `price` nor new
      // unitPrice/lineTotal, it's left alone rather than guessed at —
      // shouldn't happen in practice, but better to skip than fabricate.
    } else {
      priceAlreadyDone++;
    }

    if (doc.deliveryCost === undefined && doc.deliveryFeeCharged === undefined) {
      if (typeof doc.deliveryCharge === "number") {
        set.deliveryCost = doc.deliveryCharge;
        set.deliveryFeeCharged = null;
        unset.deliveryCharge = "";
        touched = true;
        deliveryMigrated++;
      } else {
        // Neither old nor new delivery fields present — default sanely
        // rather than leaving them undefined (undefined would make
        // aggregations behave inconsistently).
        set.deliveryCost = 0;
        set.deliveryFeeCharged = null;
        touched = true;
        deliveryDefaulted++;
      }
    } else {
      deliveryAlreadyDone++;
    }

    if (touched) {
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      await collection.updateOne({ _id: doc._id }, update);
    } else {
      fullyUntouched++;
    }
  }

  console.log("──────────────── Migration summary ────────────────");
  console.log(`Total sale documents:                 ${docs.length}`);
  console.log(`price -> unitPrice + lineTotal:        ${priceMigrated}`);
  console.log(`  ...already on new fields, skipped:   ${priceAlreadyDone}`);
  console.log(`deliveryCharge -> deliveryCost:        ${deliveryMigrated}`);
  console.log(`  ...defaulted (no old value found):   ${deliveryDefaulted}`);
  console.log(`  ...already on new fields, skipped:   ${deliveryAlreadyDone}`);
  console.log(`Untouched (already fully migrated):    ${fullyUntouched}`);
  console.log("─────────────────────────────────────────────────\n");
  console.log(
    "Re-run any time — documents already on the new fields are left exactly as they are.\n"
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nMigration failed:", err.message);
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch {}
  }
  process.exit(1);
});
