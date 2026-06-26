import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  nodes: defineTable({
    userId: v.id("users"),
    data: v.string(), // JSON.stringify(StudyNode[])
  }).index("by_user", ["userId"]),
});
