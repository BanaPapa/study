import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const HISTORY_LIMIT = 20;

export const get = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const record = await ctx.db
      .query("nodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return record?.data ?? null;
  },
});

export const save = mutation({
  args: { data: v.string() },
  handler: async (ctx, { data }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("로그인이 필요합니다");
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      // 덮어쓰기 전에 직전 데이터를 이력으로 남긴다.
      // 같은 내용을 다시 저장하는 경우는 이력을 만들지 않는다.
      if (existing.data !== data) {
        await ctx.db.insert("nodesHistory", {
          userId,
          data: existing.data,
          savedAt: Date.now(),
        });
        const history = await ctx.db
          .query("nodesHistory")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .order("desc")
          .collect();
        for (const old of history.slice(HISTORY_LIMIT)) {
          await ctx.db.delete(old._id);
        }
      }
      await ctx.db.patch(existing._id, { data });
    } else {
      await ctx.db.insert("nodes", { userId, data });
    }
  },
});

// 이력 목록(내용 제외 메타데이터만). 복구 UI 에서 시점을 고를 때 사용한다.
export const listHistory = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const history = await ctx.db
      .query("nodesHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(HISTORY_LIMIT);
    return history.map((h) => ({ id: h._id, savedAt: h.savedAt, size: h.data.length }));
  },
});

// 특정 이력 시점의 데이터 전문을 가져온다.
export const getHistoryItem = query({
  args: { id: v.id("nodesHistory") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const item = await ctx.db.get(id);
    if (!item || item.userId !== userId) return null;
    return item.data;
  },
});
