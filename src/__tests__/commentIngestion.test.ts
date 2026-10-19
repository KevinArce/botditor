import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    // Mirrors Devvit: SET NX returns "" when the key already exists
    set: vi.fn(async (key: string, value: string, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return "";
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
  /** `event.author.name` — the username (COR-1). */
  authorUsername?: string;
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
    ...(overrides.authorUsername !== undefined
      ? { author: { id: "t2_author", name: overrides.authorUsername } }
      : {}),
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

  it("processes a normal comment and saves it as 'analyzed'", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });
    const event = makeEvent();

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("analyzed");
    expect(stored.authorName).toBe("RegularUser");
    expect(stored.body).toBe("This is a test comment");
    // No API key in mock settings → safe fallback scores
    expect(stored.analysis).toBeDefined();
    expect(stored.analysis.toxicityScore).toBe(0);
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
    expect(redis._store.get(REDIS_KEYS.commentCount("testsub"))).toBe("1");
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
    expect(stored.status).toBe("analyzed");
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level behaviour (COR-1, PERF-1, Story 05, COR-3)
// ---------------------------------------------------------------------------

describe("commentIngestion – pipeline", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Make the Gemini call return these scores. */
  function mockGemini(scores: {
    toxicityScore?: number;
    spamScore?: number;
    botLikelihood?: number;
  }) {
    const text = JSON.stringify({
      toxicityScore: 0,
      spamScore: 0,
      botLikelihood: 0,
      sentiment: "neutral",
      reason: "model reason",
      ...scores,
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    } as Response);
  }

  /** Context with a working Gemini key and Reddit report/remove mocks. */
  function pipelineContext(redis = createMockRedis()) {
    const report = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const settings = createMockSettings({
      [SETTINGS.ENABLED]: true,
      [SETTINGS.GEMINI_API_KEY]: "key",
    });
    const context = {
      redis,
      settings,
      reddit: {
        getAppUser: vi.fn().mockResolvedValue({ username: "BotditorApp" }),
        getCommentById: vi.fn().mockResolvedValue({
          id: "t1_test123",
          authorName: "RegularUser",
          remove,
          addRemovalNote: vi.fn().mockResolvedValue(undefined),
        }),
        getUserByUsername: vi.fn().mockResolvedValue(undefined),
        report,
        sendPrivateMessage: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as TriggerContext;
    return { context, settings, report, remove, redis };
  }

  it("uses event.author.name when comment.author is a t2_ ID (COR-1)", async () => {
    const redis = createMockRedis();
    const settings = createMockSettings({
      [SETTINGS.ENABLED]: true,
      [SETTINGS.ALLOWLIST_USERNAMES]: "trusteduser",
    });
    const context = createMockContext({ redis, settings });
    const event = makeEvent({ author: "t2_abc123", authorUsername: "TrustedUser" });

    await handleCommentSubmit(event, context);

    const stored = getStoredComment(redis, "t1_test123");
    expect(stored.authorName).toBe("TrustedUser");
    expect(stored.skipReason).toBe("allowlisted");
  });

  it("falls back to comment.author when event.author is absent", async () => {
    const redis = createMockRedis();
    const context = createMockContext({ redis });

    await handleCommentSubmit(makeEvent({ author: "LegacyName" }), context);

    expect(getStoredComment(redis, "t1_test123").authorName).toBe("LegacyName");
  });

  it("fetches settings once per comment (PERF-1)", async () => {
    mockGemini({});
    const { context, settings } = pipelineContext();

    await handleCommentSubmit(makeEvent(), context);

    expect(settings.getAll).toHaveBeenCalledTimes(1);
    expect(settings.get).not.toHaveBeenCalled();
  });

  it("reports a likely bot without removing or warning (Story 05)", async () => {
    mockGemini({ botLikelihood: 0.9 });
    const { context, report, remove, redis } = pipelineContext();

    await handleCommentSubmit(makeEvent(), context);

    expect(report).toHaveBeenCalledWith(expect.anything(), {
      reason: "[botditor] bot-likelihood=0.9 — model reason",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(context.reddit.sendPrivateMessage).not.toHaveBeenCalled();
    expect(getStoredComment(redis, "t1_test123").moderationAction).toBe("bot_flagged");
  });

  it("enforces the AI spam score when rule heuristics are quiet (COR-3)", async () => {
    mockGemini({ spamScore: 0.7 });
    const { context, report, redis } = pipelineContext();

    await handleCommentSubmit(makeEvent(), context);

    expect(report).toHaveBeenCalledWith(expect.anything(), {
      reason: expect.stringContaining("[botditor] spam=0.7"),
    });
    const stored = getStoredComment(redis, "t1_test123");
    expect(stored.analysis.spamScore).toBe(0.7);
  });

  it("takes no action when the AI call fails (zero fallback scores)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const { context, report, remove } = pipelineContext();

    await handleCommentSubmit(makeEvent(), context);

    expect(report).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
