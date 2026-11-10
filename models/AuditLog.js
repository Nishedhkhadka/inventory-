import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      default: "Sale",
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "entityType",
      required: true,
    },
    orderId: {
      type: String, // Human-friendly order ID like A-1234
    },
    action: {
      type: String,
      required: true, // e.g. "CREATE", "UPDATE", "STATUS_CHANGE", "DELETE"
    },
    changes: {
      type: mongoose.Schema.Types.Mixed, // Stores old/new values or summary description
    },
    performedBy: {
      type: String, // Username or user ID if available
      default: "System",
    },
  },
  { timestamps: true }
);

export default mongoose.model("AuditLog", auditLogSchema);