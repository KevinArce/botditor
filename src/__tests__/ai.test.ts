import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import {
  analyzeComment,
  buildPrompt,
  parseAnalysisResponse,
  extractGeneratedText,
  isEmojiOnly,
} from "../ai.js";
import {
  ANALYSIS_FALLBACK,
  REDIS_KEYS,
  SETTINGS,
  MAX_PROMPT_BODY_LENGTH,
} from "../types.js";
import type { IngestedComment } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories (reuse the same pattern as commentIngestion tests)
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
    commentId: "t1_test123",
    postId: "t3_post1",
    subredditName: "testsub",
    authorName: "RegularUser",
    body: "This is a test comment",
    createdAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    status: "processing",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests – isEmojiOnly
// ---------------------------------------------------------------------------

describe("isEmojiOnly", () => {
  it("returns true for empty string", () => {
    expect(isEmojiOnly("")).toBe(true);
  });

  it("returns true for whitespace-only", () => {
    expect(isEmojiOnly("   \n  ")).toBe(true);
  });

  it("returns true for emoji-only", () => {
    expect(isEmojiOnly("🎉🔥👍")).toBe(true);
  });

  it("returns false for text with emoji", () => {
    expect(isEmojiOnly("hello 🎉")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isEmojiOnly("hello world")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests – buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("includes the comment body in the prompt", () => {
    const prompt = buildPrompt("test comment");
    expect(prompt).toContain('Comment: "test comment"');
    expect(prompt).toContain("toxicityScore");
  });

  it("truncates long bodies and appends [truncated]", () => {
    const longBody = "x".repeat(MAX_PROMPT_BODY_LENGTH + 500);
    const prompt = buildPrompt(longBody);
    expect(prompt).toContain("[truncated]");
    expect(prompt).not.toContain("x".repeat(MAX_PROMPT_BODY_LENGTH + 1));
  });

  it("does not truncate short bodies", () => {
    const prompt = buildPrompt("short");
    expect(prompt).not.toContain("[truncated]");
  });
});

// ---------------------------------------------------------------------------
// Tests – extractGeneratedText
// ---------------------------------------------------------------------------

describe("extractGeneratedText", () => {
  it("extracts text from a valid Gemini response", () => {
    const response = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"toxicityScore": 0.5}' }] } }],
    });
    expect(extractGeneratedText(response)).toBe('{"toxicityScore": 0.5}');
  });

  it("returns null for malformed JSON", () => {
    expect(extractGeneratedText("not json")).toBeNull();
  });

  it("returns null for missing candidates", () => {
    expect(extractGeneratedText(JSON.stringify({}))).toBeNull();
  });

  it("returns null for empty candidates", () => {
    expect(extractGeneratedText(JSON.stringify({ candidates: [] }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests – parseAnalysisResponse
// ---------------------------------------------------------------------------

describe("parseAnalysisResponse", () => {
  it("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      toxicityScore: 0.8,
      spamScore: 0.3,
      botLikelihood: 0.1,
      sentiment: "negative",
      reason: "Contains offensive language",
    });
    const result = parseAnalysisResponse(raw);
    expect(result.toxicityScore).toBe(0.8);
    expect(result.spamScore).toBe(0.3);
    expect(result.botLikelihood).toBe(0.1);
    expect(result.sentiment).toBe("negative");
    expect(result.reason).toBe("Contains offensive language");
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const raw = '```json\n{"toxicityScore": 0.5, "spamScore": 0.2, "botLikelihood": 0, "sentiment": "neutral", "reason": "fine"}\n```';
    const result = parseAnalysisResponse(raw);
    expect(result.toxicityScore).toBe(0.5);
    expect(result.sentiment).toBe("neutral");
  });

  it("returns fallback for missing fields", () => {
    const raw = JSON.stringify({ toxicityScore: 0.5 }); // missing other fields
    const result = parseAnalysisResponse(raw);
    expect(result.reason).toBe("parse error");
    expect(result.toxicityScore).toBe(0);
  });

  it("returns fallback for malformed JSON", () => {
    const result = parseAnalysisResponse("not valid json at all");
    expect(result.reason).toBe("parse error");
    expect(result.toxicityScore).toBe(0);
  });

  it("clamps scores to 0–1 range", () => {
    const raw = JSON.stringify({
      toxicityScore: 1.5,
      spamScore: -0.3,
      botLikelihood: 0.5,
      sentiment: "positive",
      reason: "test",
    });
    const result = parseAnalysisResponse(raw);
    expect(result.toxicityScore).toBe(1);
    expect(result.spamScore).toBe(0);
  });

  it("returns fallback for invalid sentiment value", () => {
    const raw = JSON.stringify({
      toxicityScore: 0.1,
      spamScore: 0.1,
      botLikelihood: 0.1,
      sentiment: "angry", // invalid
      reason: "test",
    });
    const result = parseAnalysisResponse(raw);
    expect(result.reason).toBe("parse error");
  });
});

// ---------------------------------------------------------------------------
// Tests – analyzeComment
// ---------------------------------------------------------------------------

describe("analyzeComment", () => {
  it("returns fallback when no API key is configured", async () => {
    const context = createMockContext();
    const record = makeRecord();

    const result = await analyzeComment(record, context);

    expect(result.toxicityScore).toBe(0);
    expect(result.reason).toBe("no api key configured");
  });

  it("returns heuristic scores for emoji-only comments", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
      }),
    });
    const record = makeRecord({ body: "🎉🔥👍" });

    const result = await analyzeComment(record, context);

    expect(result.toxicityScore).toBe(0);
    expect(result.spamScore).toBe(0.1);
    expect(result.botLikelihood).toBe(0.2);
    expect(result.reason).toBe("emoji-only comment");
  });

  it("returns cached result on cache hit", async () => {
    const redis = createMockRedis();
    const cachedResult = {
      toxicityScore: 0.9,
      spamScore: 0.1,
      botLikelihood: 0,
      sentiment: "negative",
      reason: "cached result",
    };
    const cacheKey = REDIS_KEYS.analysisCache("t1_test123");
    redis._store.set(cacheKey, JSON.stringify(cachedResult));

    const context = createMockContext({
      redis,
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
      }),
    });
    const record = makeRecord();

    const result = await analyzeComment(record, context);

    expect(result.toxicityScore).toBe(0.9);
    expect(result.reason).toBe("cached result");
  });

  it("returns fallback when fetch throws", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
        [SETTINGS.GEMINI_MODEL]: "gemini-1.5-flash",
      }),
    });
    const record = makeRecord();

    // Mock global fetch to reject
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    try {
      const result = await analyzeComment(record, context);
      expect(result.toxicityScore).toBe(0);
      expect(result.reason).toBe("fetch error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns fallback on non-OK response", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
      }),
    });
    const record = makeRecord();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });
    try {
      const result = await analyzeComment(record, context);
      expect(result.toxicityScore).toBe(0);
      expect(result.reason).toBe("api error 429");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns fallback on malformed API response body", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
      }),
    });
    const record = makeRecord();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "not json at all",
    });
    try {
      const result = await analyzeComment(record, context);
      expect(result.toxicityScore).toBe(0);
      expect(result.reason).toBe("empty response");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses and caches a valid API response", async () => {
    const redis = createMockRedis();
    const context = createMockContext({
      redis,
      settings: createMockSettings({
        [SETTINGS.GEMINI_API_KEY]: "test-key",
      }),
    });
    const record = makeRecord();

    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              toxicityScore: 0.7,
              spamScore: 0.2,
              botLikelihood: 0.05,
              sentiment: "negative",
              reason: "mildly toxic language",
            }),
          }],
        },
      }],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(geminiResponse),
    });
    try {
      const result = await analyzeComment(record, context);
      expect(result.toxicityScore).toBe(0.7);
      expect(result.spamScore).toBe(0.2);
      expect(result.sentiment).toBe("negative");

      // Verify it was cached
      const cacheKey = REDIS_KEYS.analysisCache("t1_test123");
      expect(redis.set).toHaveBeenCalledWith(
        cacheKey,
        expect.stringContaining("0.7")
      );
      expect(redis.expire).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
