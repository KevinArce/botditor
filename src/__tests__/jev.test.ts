import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RedisClient, SettingsClient, TriggerContext } from "@devvit/public-api";
import {
  analyzeCommentWithJev,
  buildJevRequestBody,
  parseJevResponse,
} from "../jev.js";
import {
  ANALYSIS_FALLBACK,
  REDIS_KEYS,
  SETTINGS,
  DEFAULT_JEV_API_HOST,
  DEFAULT_JEV_MODEL,
} from "../types.js";
import type { IngestedComment } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRedis(): RedisClient & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? undefined),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => {}),
  } as unknown as RedisClient & { _store: Map<string, string> };
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

function createMockContext(overrides: {
  redis?: ReturnType<typeof createMockRedis>;
  settings?: SettingsClient;
} = {}): TriggerContext {
  const redis = overrides.redis ?? createMockRedis();
  const settings = overrides.settings ?? createMockSettings({});
  return { redis, settings } as unknown as TriggerContext;
}

function makeRecord(overrides: Partial<IngestedComment> = {}): IngestedComment {
  return {
    commentId: "t1_jev123",
    postId: "t3_post1",
    subredditName: "testsub",
    authorName: "RegularUser",
    body: "This is a regular comment for testing Jev.",
    createdAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    status: "processing",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests – buildJevRequestBody
// ---------------------------------------------------------------------------

describe("buildJevRequestBody", () => {
  it("constructs state-based payload matching TypeSafe Jev contract", () => {
    const record = makeRecord({
      commentId: "t1_abc",
      body: "Hello world",
      subredditName: "science",
      authorName: "Researcher",
    });

    const body = buildJevRequestBody(record, "jev-fast-v1") as {
      model: string;
      target: string;
      state: Record<string, string>;
      decision_schema: Record<string, unknown>;
    };

    expect(body.model).toBe("jev-fast-v1");
    expect(body.target).toBe("reddit_comment");
    expect(body.state.commentId).toBe("t1_abc");
    expect(body.state.body).toBe("Hello world");
    expect(body.state.subreddit).toBe("science");
    expect(body.state.author).toBe("Researcher");
    expect(body.decision_schema).toHaveProperty("toxicityScore");
    expect(body.decision_schema).toHaveProperty("spamScore");
    expect(body.decision_schema).toHaveProperty("botLikelihood");
    expect(body.decision_schema).toHaveProperty("sentiment");
  });
});

// ---------------------------------------------------------------------------
// Tests – parseJevResponse
// ---------------------------------------------------------------------------

describe("parseJevResponse", () => {
  it("parses flat JSON decision response", () => {
    const payload = JSON.stringify({
      toxicityScore: 0.92,
      spamScore: 0.05,
      botLikelihood: 0.1,
      sentiment: "negative",
      reason: "Hostile insult",
    });

    const result = parseJevResponse(payload);
    expect(result).toEqual({
      toxicityScore: 0.92,
      spamScore: 0.05,
      botLikelihood: 0.1,
      sentiment: "negative",
      reason: "Hostile insult",
    });
  });

  it("parses nested decision envelope response", () => {
    const payload = JSON.stringify({
      decision: {
        toxicityScore: 0.1,
        spamScore: 0.85,
        botLikelihood: 0.95,
        sentiment: "neutral",
        reason: "Affiliate link spam",
      },
      latencyMs: 142,
    });

    const result = parseJevResponse(payload);
    expect(result).toEqual({
      toxicityScore: 0.1,
      spamScore: 0.85,
      botLikelihood: 0.95,
      sentiment: "neutral",
      reason: "Affiliate link spam",
    });
  });

  it("clamps scores out of [0, 1] range", () => {
    const payload = JSON.stringify({
      toxicityScore: 1.5,
      spamScore: -0.2,
      botLikelihood: 0.5,
      sentiment: "positive",
      reason: "ok",
    });

    const result = parseJevResponse(payload);
    expect(result.toxicityScore).toBe(1);
    expect(result.spamScore).toBe(0);
    expect(result.botLikelihood).toBe(0.5);
  });

  it("returns parse error fallback on invalid JSON", () => {
    const result = parseJevResponse("not a json");
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when required score fields are missing", () => {
    const payload = JSON.stringify({ toxicityScore: 0.5 });
    const result = parseJevResponse(payload);
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when sentiment is invalid", () => {
    const payload = JSON.stringify({
      toxicityScore: 0.1,
      spamScore: 0.1,
      botLikelihood: 0.1,
      sentiment: "angry",
    });
    const result = parseJevResponse(payload);
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });
});

// ---------------------------------------------------------------------------
// Tests – analyzeCommentWithJev
// ---------------------------------------------------------------------------

describe("analyzeCommentWithJev", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns fast heuristic for emoji-only comment without calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const record = makeRecord({ body: "🚀🔥🎉" });
    const context = createMockContext();

    const result = await analyzeCommentWithJev(record, context);
    expect(result.reason).toBe("emoji-only comment");
    expect(result.toxicityScore).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns cached result from Redis without calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const cachedResult = {
      toxicityScore: 0.77,
      spamScore: 0.1,
      botLikelihood: 0.2,
      sentiment: "negative" as const,
      reason: "cached jev decision",
    };

    const redis = createMockRedis();
    redis._store.set(
      REDIS_KEYS.analysisCache("t1_jev123"),
      JSON.stringify(cachedResult)
    );
    const context = createMockContext({ redis });

    const result = await analyzeCommentWithJev(makeRecord(), context);
    expect(result).toEqual(cachedResult);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns safe fallback when no Jev API key is configured", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const context = createMockContext({
      settings: createMockSettings({ [SETTINGS.JEV_API_KEY]: "" }),
    });

    const result = await analyzeCommentWithJev(makeRecord(), context);
    expect(result).toEqual({
      ...ANALYSIS_FALLBACK,
      reason: "no jev api key configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Jev API endpoint and caches valid decision", async () => {
    const decisionResponse = {
      decision: {
        toxicityScore: 0.88,
        spamScore: 0.05,
        botLikelihood: 0.12,
        sentiment: "negative",
        reason: "Insult detected",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(decisionResponse),
    } as Response);
    globalThis.fetch = fetchMock;

    const redis = createMockRedis();
    const settings = createMockSettings({
      [SETTINGS.JEV_API_KEY]: "test-jev-key",
      [SETTINGS.JEV_API_HOST]: "api.typesafe.ai",
      [SETTINGS.JEV_MODEL]: "jev-test",
    });
    const context = createMockContext({ redis, settings });

    const result = await analyzeCommentWithJev(makeRecord(), context);

    expect(result.toxicityScore).toBe(0.88);
    expect(result.sentiment).toBe("negative");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/decide",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-jev-key",
          "x-api-key": "test-jev-key",
        }),
      })
    );

    // Verify cached in Redis
    expect(redis.set).toHaveBeenCalledWith(
      REDIS_KEYS.analysisCache("t1_jev123"),
      JSON.stringify(result)
    );
    expect(redis.expire).toHaveBeenCalled();
  });

  it("returns fallback when Jev API returns HTTP 500 error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);
    globalThis.fetch = fetchMock;

    const settings = createMockSettings({
      [SETTINGS.JEV_API_KEY]: "test-jev-key",
    });
    const context = createMockContext({ settings });

    const result = await analyzeCommentWithJev(makeRecord(), context);
    expect(result).toEqual({
      ...ANALYSIS_FALLBACK,
      reason: "jev api error 500",
    });
  });

  it("returns fallback on network or fetch error without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection refused"));
    globalThis.fetch = fetchMock;

    const settings = createMockSettings({
      [SETTINGS.JEV_API_KEY]: "test-jev-key",
    });
    const context = createMockContext({ settings });

    const result = await analyzeCommentWithJev(makeRecord(), context);
    expect(result.reason).toBe("timeout or network error");
  });
});
