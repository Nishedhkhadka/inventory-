import Location from "./Location.js";

productSchema.pre("save", async function (next) {
  // Sync aggregate currentStock with colors sum
  if (this.colors && this.colors.length > 0) {
    this.currentStock = this.colors.reduce((sum, c) => sum + (c.stock || 0), 0);
  }

  // Populate default location stock array if empty
  if (this.isNew && (!this.locationStocks || this.locationStocks.length === 0)) {
    try {
      let defaultLoc = await Location.findOne({ isDefault: true });
      if (!defaultLoc) {
        defaultLoc = await Location.create({
          name: "Main Warehouse",
          isDefault: true,
        });
      }

      if (this.colors && this.colors.length > 0) {
        this.locationStocks = this.colors.map((c) => ({
          location: defaultLoc._id,
          color: c.name,
          stock: c.stock || 0,
        }));
      } else {
        this.locationStocks = [
          {
            location: defaultLoc._id,
            color: "",
            stock: this.currentStock || 0,
          },
        ];
      }
    } catch (e) {
      console.error("Failed to seed location stock on product creation:", e);
    }
  }

  next();
});