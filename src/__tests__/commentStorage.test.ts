import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisClient } from "@devvit/public-api";
import {
  saveComment,
  getComment,
  updateCommentStatus,
  listCommentIds,
  getCommentCount,
} from "../commentStorage.js";
import type { IngestedComment } from "../types.js";
import { REDIS_KEYS } from "../types.js";

// ---------------------------------------------------------------------------
// Mock RedisClient factory
// ---------------------------------------------------------------------------

function createMockRedis(): RedisClient {
  const store = new Map<string, string>();
  const sortedSets = new Map<string, { member: string; score: number }[]>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? undefined),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
    zAdd: vi.fn(
      async (
        key: string,
        ...members: { member: string; score: number }[]
      ) => {
        if (!sortedSets.has(key)) sortedSets.set(key, []);
        const set = sortedSets.get(key)!;
        for (const m of members) {
          set.push(m);
        }
        set.sort((a, b) => a.score - b.score);
        return members.length;
      }
    ),
    zRange: vi.fn(
      async (
        key: string,
        start: number | string,
        stop: number | string,
        options?: { reverse?: boolean; by?: string }
      ) => {
        const set = sortedSets.get(key) ?? [];
        const s = Number(start);
        const e = Number(stop);
        let slice = set.slice(s, e + 1);
        if (options?.reverse) {
          const reversed = [...set].reverse();
          slice = reversed.slice(s, e + 1);
        }
        return slice;
      }
    ),
    incrBy: vi.fn(async (key: string, value: number) => {
      const current = parseInt(store.get(key) ?? "0", 10);
      const next = current + value;
      store.set(key, String(next));
      return next;
    }),
  } as unknown as RedisClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(
  overrides: Partial<IngestedComment> = {}
): IngestedComment {
  return {
    commentId: "t1_abc123",
    postId: "t3_post1",
    subredditName: "testsub",
    authorName: "testuser",
    body: "Hello, world!",
    createdAt: "2026-03-10T00:00:00.000Z",
    ingestedAt: "2026-03-10T00:00:01.000Z",
    status: "pending",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("commentStorage", () => {
  let redis: RedisClient;

  beforeEach(() => {
    redis = createMockRedis();
  });

  // ── saveComment & getComment ──────────────────────────────────────

  describe("saveComment", () => {
    it("saves and retrieves a comment round-trip", async () => {
      const comment = makeComment();
      const result = await saveComment(comment, redis);

      expect(result).toBe("saved");

      const stored = await getComment("t1_abc123", redis);
      expect(stored).not.toBeNull();
      expect(stored!.commentId).toBe("t1_abc123");
      expect(stored!.authorName).toBe("testuser");
      expect(stored!.body).toBe("Hello, world!");
      expect(stored!.status).toBe("pending");
    });

    it("returns 'duplicate' for the same comment ID", async () => {
      const comment = makeComment();

      const first = await saveComment(comment, redis);
      expect(first).toBe("saved");

      const second = await saveComment(comment, redis);
      expect(second).toBe("duplicate");
    });

    it("adds the comment to the per-subreddit sorted set index", async () => {
      const comment = makeComment();
      await saveComment(comment, redis);

      const indexKey = REDIS_KEYS.commentIndex("testsub");
      expect(redis.zAdd).toHaveBeenCalledWith(indexKey, {
        member: "t1_abc123",
        score: expect.any(Number),
      });
    });

    it("increments the subreddit comment counter", async () => {
      const comment = makeComment();
      await saveComment(comment, redis);

      const countKey = REDIS_KEYS.commentCount("testsub");
      expect(redis.incrBy).toHaveBeenCalledWith(countKey, 1);
    });

    it("does not increment counter on duplicate", async () => {
      const comment = makeComment();
      await saveComment(comment, redis);
      await saveComment(comment, redis);

      expect(redis.incrBy).toHaveBeenCalledTimes(1);
    });
  });

  // ── getComment ────────────────────────────────────────────────────

  describe("getComment", () => {
    it("returns null for non-existent comment", async () => {
      const result = await getComment("t1_nonexistent", redis);
      expect(result).toBeNull();
    });
  });

  // ── updateCommentStatus ───────────────────────────────────────────

  describe("updateCommentStatus", () => {
    it("updates status of an existing comment", async () => {
      await saveComment(makeComment(), redis);

      const updated = await updateCommentStatus(
        "t1_abc123",
        { status: "processing" },
        redis
      );

      expect(updated).toBe(true);

      const stored = await getComment("t1_abc123", redis);
      expect(stored!.status).toBe("processing");
    });

    it("updates status with error message", async () => {
      await saveComment(makeComment(), redis);

      await updateCommentStatus(
        "t1_abc123",
        { status: "error", errorMessage: "AI pipeline timeout" },
        redis
      );

      const stored = await getComment("t1_abc123", redis);
      expect(stored!.status).toBe("error");
      expect(stored!.errorMessage).toBe("AI pipeline timeout");
    });

    it("returns false for non-existent comment", async () => {
      const result = await updateCommentStatus(
        "t1_nonexistent",
        { status: "processing" },
        redis
      );
      expect(result).toBe(false);
    });
  });

  // ── listCommentIds ────────────────────────────────────────────────

  describe("listCommentIds", () => {
    it("returns comment IDs ordered by ingestion time (newest first)", async () => {
      const c1 = makeComment({
        commentId: "t1_first",
        ingestedAt: "2026-03-10T00:00:01.000Z",
      });
      const c2 = makeComment({
        commentId: "t1_second",
        ingestedAt: "2026-03-10T00:00:02.000Z",
      });
      const c3 = makeComment({
        commentId: "t1_third",
        ingestedAt: "2026-03-10T00:00:03.000Z",
      });

      await saveComment(c1, redis);
      await saveComment(c2, redis);
      await saveComment(c3, redis);

      const ids = await listCommentIds("testsub", redis);

      // newest first (reverse order)
      expect(ids[0]).toBe("t1_third");
      expect(ids[1]).toBe("t1_second");
      expect(ids[2]).toBe("t1_first");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await saveComment(
          makeComment({
            commentId: `t1_c${i}`,
            ingestedAt: `2026-03-10T00:00:0${i}.000Z`,
          }),
          redis
        );
      }

      const ids = await listCommentIds("testsub", redis, 2);
      expect(ids).toHaveLength(2);
    });
  });

  // ── getCommentCount ───────────────────────────────────────────────

  describe("getCommentCount", () => {
    it("returns 0 for a subreddit with no comments", async () => {
      const count = await getCommentCount("emptysub", redis);
      expect(count).toBe(0);
    });

    it("returns correct count after multiple saves", async () => {
      await saveComment(makeComment({ commentId: "t1_a" }), redis);
      await saveComment(makeComment({ commentId: "t1_b" }), redis);
      await saveComment(makeComment({ commentId: "t1_c" }), redis);

      const count = await getCommentCount("testsub", redis);
      expect(count).toBe(3);
    });
  });
});
