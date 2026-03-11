import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import type { CommentSubmit } from "@devvit/protos";
import { handleCommentSubmit } from "../commentIngestion.js";
import { REDIS_KEYS, SETTINGS, MAX_BODY_LENGTH } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRedis(): RedisClient & { _store: Map<string, string> } {
  const store = new Map<string, string>();

  const redis = {
    _store: store,
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
    zAdd: vi.fn(async () => 1),
    incrBy: vi.fn(async (key: string, value: number) => {
      const current = parseInt(store.get(key) ?? "0", 10);
      const next = current + value;
      store.set(key, String(next));
      return next;
    }),
  } as unknown as RedisClient & { _store: Map<string, string> };

  return redis;
}

function createMockSettings(
  values: Record<string, string | number | boolean | undefined> = {}
): SettingsClient {
  return {
    get: vi.fn(async <T>(key: string) => {
      return key in values ? (values[key] as T) : undefined;
    }),
    getAll: vi.fn(async () => values),
  } as unknown as SettingsClient;
}

/**
 * Build a mock TriggerContext that satisfies the fields used by
 * handleCommentSubmit: redis, settings, and reddit.getAppUser().
 */
function createMockContext(overrides: {
  redis?: ReturnType<typeof createMockRedis>;
  settings?: SettingsClient;
  appUsername?: string;
  getAppUserThrows?: boolean;
} = {}): TriggerContext {
  const redis = overrides.redis ?? createMockRedis();
  const settings = overrides.settings ?? createMockSettings({
    [SETTINGS.ENABLED]: true,
    [SETTINGS.ALLOWLIST_USERNAMES]: "",
  });

  const getAppUser = overrides.getAppUserThrows
    ? vi.fn().mockRejectedValue(new Error("Not available"))
    : vi.fn().mockResolvedValue(
        overrides.appUsername
          ? { username: overrides.appUsername }
          : { username: "BotditorApp" }
      );

  return {
    redis,
    settings,
    reddit: { getAppUser },
  } as unknown as TriggerContext;
}

/**
 * Build a CommentSubmit event with sensible defaults.
 */
function makeEvent(overrides: {
  commentId?: string;
  author?: string;
  body?: string;
  postId?: string;
  subredditName?: string;
  createdAt?: number;
  noComment?: boolean;
} = {}): CommentSubmit {
  if (overrides.noComment) {
    return { subreddit: { name: "testsub" } } as unknown as CommentSubmit;
  }

  return {
    comment: {
      id: overrides.commentId ?? "t1_test123",
      author: overrides.author ?? "RegularUser",
      body: overrides.body ?? "This is a test comment",
      postId: overrides.postId ?? "t3_post1",
      createdAt: overrides.createdAt ?? Date.now(),
    },
    subreddit: {
      name: overrides.subredditName ?? "testsub",
    },
  } as unknown as CommentSubmit;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a stored comment record from the mock Redis. */
function getStoredComment(redis: ReturnType<typeof createMockRedis>, commentId: string) {
  const raw = redis._store.get(REDIS_KEYS.comment(commentId));
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("commentIngestion – handleCommentSubmit", () => {
  // ── Happy path ────────────────────────────────────────────────────

  it("processes a normal comment and saves it as 'processing'", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent();

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("processing");
    expect(stored.authorName).toBe("RegularUser");
    expect(stored.body).toBe("This is a test comment");
  });

  // ── Disabled toggle ───────────────────────────────────────────────

  it("exits early when the app is disabled", async () => {
    const redis = createMockRedis();
    const settings = createMockSettings({ [SETTINGS.ENABLED]: false });
    const context = createMockContext({ redis, settings });
    const event = makeEvent();

    await handleCommentSubmit(event, context);

    // No comment should be stored
    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  // ── Missing comment payload ───────────────────────────────────────

  it("exits early when event has no comment", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent({ noComment: true });

    await handleCommentSubmit(event, context);

    expect(redis.set).not.toHaveBeenCalled();
  });

  // ── Empty / deleted body ──────────────────────────────────────────

  it("skips a comment with an empty body", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent({ body: "" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("skipped");
    expect(stored.skipReason).toBe("deleted");
  });

  it("skips a comment with whitespace-only body", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent({ body: "   \n  " });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("skipped");
  });

  // ── Self-comment (bot's own) ──────────────────────────────────────

  it("skips comments from the bot itself", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis, appUsername: "BotditorApp" });
    const event = makeEvent({ author: "BotditorApp" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("skipped");
    expect(stored.skipReason).toBe("self_comment");
  });

  it("self-comment detection is case-insensitive", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis, appUsername: "BotditorApp" });
    const event = makeEvent({ author: "botditorapp" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored!.status).toBe("skipped");
    expect(stored!.skipReason).toBe("self_comment");
  });

  // ── Allowlisted author ────────────────────────────────────────────

  it("skips comments from allowlisted authors (settings-based)", async () => {
    const redis = createMockRedis();
    const settings = createMockSettings({
      [SETTINGS.ENABLED]: true,
      [SETTINGS.ALLOWLIST_USERNAMES]: "TrustedMod, RegularUser",
    });
    const context = createMockContext({ redis, settings });
    const event = makeEvent({ author: "RegularUser" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("skipped");
    expect(stored.skipReason).toBe("allowlisted");
  });

  it("skips comments from allowlisted authors (Redis-based)", async () => {
    const redis = createMockRedis();

    // Pre-populate the Redis allowlist
    const allowlistKey = REDIS_KEYS.allowlistUser("trustedmod");
    redis._store.set(allowlistKey, "1");

    const settings = createMockSettings({
      [SETTINGS.ENABLED]: true,
      [SETTINGS.ALLOWLIST_USERNAMES]: "",
    });
    const context = createMockContext({ redis, settings });
    const event = makeEvent({ author: "TrustedMod" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("skipped");
    expect(stored.skipReason).toBe("allowlisted");
  });

  // ── Duplicate event re-delivery ───────────────────────────────────

  it("handles duplicate events idempotently", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent();

    await handleCommentSubmit(event, context);
    await handleCommentSubmit(event, context);

    // Should only have been stored once – the second call is a no-op
    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
  });

  // ── Body sanitization ─────────────────────────────────────────────

  it("truncates body exceeding MAX_BODY_LENGTH", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const longBody = "x".repeat(MAX_BODY_LENGTH + 500);
    const event = makeEvent({ body: longBody });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.body.length).toBe(MAX_BODY_LENGTH);
  });

  it("trims whitespace from body before storage", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent({ body: "  hello world  " });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored.body).toBe("hello world");
  });

  // ── getAppUser failure ────────────────────────────────────────────

  it("continues processing when getAppUser throws", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis, getAppUserThrows: true });
    const event = makeEvent();

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("processing");
  });
});
