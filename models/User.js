import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    // Never store or return the plain password — only its bcrypt hash.
    // The field is named passwordHash (not password) so it's impossible
    // to accidentally assign a plain-text value to it by mistake.
    passwordHash: {
      type: String,
      required: true,
    },
    // admin: full access, including creating other users and seeing every
    // dashboard metric. user: everyday operational access (Sales,
    // Expenses, Inventory, Packaging) with a simplified dashboard — no
    // revenue/profit/expense figures.
    role: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
  },
  { timestamps: true }
);

// Never sent to the client — belt-and-suspenders alongside controllers
// already hand-picking which fields to return.
userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 12);
};

export default mongoose.model("User", userSchema);
