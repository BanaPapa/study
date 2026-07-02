import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  nodes: defineTable({
    userId: v.id("users"),
    data: v.string(), // JSON.stringify(StudyNode[])
  }).index("by_user", ["userId"]),
  // 저장할 때마다 직전 데이터를 보관하는 이력 테이블.
  // 클라이언트 버그·기기 간 경쟁 조건으로 데이터가 덮어써져도 복구할 수 있게 한다.
  nodesHistory: defineTable({
    userId: v.id("users"),
    data: v.string(),
    savedAt: v.number(),
  }).index("by_user", ["userId", "savedAt"]),
});
