import mongoose from "mongoose";

/**
 * Opens the MongoDB connection using MONGO_URI from the environment.
 * Exits the process on failure so the app never runs against a dead DB.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (err) {
    console.error(`[db] Connection failed: ${err.message}`);
    process.exit(1);
  }
};

export default connectDB;
