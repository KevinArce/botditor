import { describe, it, expect, vi } from "vitest";
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import {
  computeSpamScore,
  extractUrls,
  parseDomainList,
  matchesDomainList,
  simpleHash,
} from "../spam.js";
import { enforceSpam } from "../moderation.js";
import { SETTINGS } from "../types.js";
import type { IngestedComment, SpamResult } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRedis(
  store: Record<string, string> = {}
): RedisClient {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    expire: vi.fn(async () => {}),
  } as unknown as RedisClient;
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
  settings?: SettingsClient;
  redis?: RedisClient;
  userCreatedAt?: Date;
  userKarma?: { commentKarma: number; linkKarma: number };
  userNotFound?: boolean;
} = {}): TriggerContext {
  const settings = overrides.settings ?? createMockSettings({
    [SETTINGS.SPAM_BLOCKED_DOMAINS]: "",
    [SETTINGS.ALLOWLIST_DOMAINS]: "",
    [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.80,
    [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.50,
    [SETTINGS.SPAM_MODE]: "flag",
    [SETTINGS.DRY_RUN]: false,
  });

  const redis = overrides.redis ?? createMockRedis();

  const userCreatedAt = overrides.userCreatedAt ?? new Date("2020-01-01");
  const userKarma = overrides.userKarma ?? { commentKarma: 1000, linkKarma: 500 };

  const mockUser = overrides.userNotFound
    ? undefined
    : {
        username: "TestUser",
        createdAt: userCreatedAt,
        commentKarma: userKarma.commentKarma,
        linkKarma: userKarma.linkKarma,
      };

  return {
    settings,
    redis,
    reddit: {
      getUserByUsername: overrides.userNotFound
        ? vi.fn().mockRejectedValue(new Error("User not found"))
        : vi.fn().mockResolvedValue(mockUser),
      getCommentById: vi.fn().mockResolvedValue({
        remove: vi.fn().mockResolvedValue(undefined),
        id: "t1_test123",
      }),
      report: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as TriggerContext;
}

function makeRecord(overrides: Partial<IngestedComment> = {}): IngestedComment {
  return {
    commentId: "t1_test123",
    postId: "t3_post1",
    subredditName: "testsub",
    authorName: "TestUser",
    body: "This is a test comment",
    createdAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    status: "analyzed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

describe("extractUrls", () => {
  it("extracts URLs from text", () => {
    const text = "Check out https://example.com and http://test.org/page";
    expect(extractUrls(text)).toEqual([
      "https://example.com",
      "http://test.org/page",
    ]);
  });

  it("returns empty array for text without URLs", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });

  it("handles multiple URLs on the same line", () => {
    const text = "https://a.com https://b.com https://c.com https://d.com";
    expect(extractUrls(text)).toHaveLength(4);
  });
});

describe("parseDomainList", () => {
  it("parses comma-separated domains", () => {
    expect(parseDomainList("bit.ly, tinyurl.com, example.com")).toEqual([
      "bit.ly",
      "tinyurl.com",
      "example.com",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseDomainList("")).toEqual([]);
  });

  it("normalizes to lowercase", () => {
    expect(parseDomainList("BIT.LY")).toEqual(["bit.ly"]);
  });
});

describe("matchesDomainList", () => {
  it("matches exact domain", () => {
    expect(matchesDomainList("https://bit.ly/abc", ["bit.ly"])).toBe(true);
  });

  it("matches subdomain", () => {
    expect(matchesDomainList("https://m.bit.ly/abc", ["bit.ly"])).toBe(true);
  });

  it("does not match unrelated domain", () => {
    expect(matchesDomainList("https://example.com", ["bit.ly"])).toBe(false);
  });

  it("returns false for empty domain list", () => {
    expect(matchesDomainList("https://example.com", [])).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(matchesDomainList("not-a-url", ["example.com"])).toBe(false);
  });
});

describe("simpleHash", () => {
  it("produces consistent hashes", () => {
    const h1 = simpleHash("hello world");
    const h2 = simpleHash("hello world");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different inputs", () => {
    expect(simpleHash("abc")).not.toBe(simpleHash("xyz"));
  });
});

// ---------------------------------------------------------------------------
// computeSpamScore tests
// ---------------------------------------------------------------------------

describe("computeSpamScore", () => {
  it("returns score 0 for clean comment", async () => {
    const context = createMockContext();
    const result = await computeSpamScore(
      "This is a perfectly normal comment.",
      "TestUser",
      context
    );
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
    expect(result.blockedDomain).toBe(false);
  });

  it("adds 0.4 for >3 URLs", async () => {
    const context = createMockContext();
    const body =
      "Check https://a.com https://b.com https://c.com https://d.com";
    const result = await computeSpamScore(body, "TestUser", context);
    expect(result.score).toBeCloseTo(0.4, 2);
    expect(result.reasons.some((r) => r.includes("URLs detected"))).toBe(true);
  });

  it("does not penalize 3 or fewer URLs", async () => {
    const context = createMockContext();
    const body = "Check https://a.com https://b.com https://c.com";
    const result = await computeSpamScore(body, "TestUser", context);
    // Only URL count not applied; account age check passes (old account)
    expect(result.score).toBe(0);
  });

  it("skips allowlisted domains in URL count", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.ALLOWLIST_DOMAINS]: "reddit.com",
        [SETTINGS.SPAM_BLOCKED_DOMAINS]: "",
      }),
    });
    // 4 URLs but 2 are allowlisted reddit.com → only 2 non-allowlisted
    const body =
      "https://reddit.com/a https://reddit.com/b https://spam.com https://spam2.com";
    const result = await computeSpamScore(body, "TestUser", context);
    expect(result.score).toBe(0); // only 2 non-allowlisted URLs, threshold is >3
  });

  it("returns score 1.0 for blocked domain", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.SPAM_BLOCKED_DOMAINS]: "bit.ly,tinyurl.com",
        [SETTINGS.ALLOWLIST_DOMAINS]: "",
      }),
    });
    const body = "Check out https://bit.ly/malware";
    const result = await computeSpamScore(body, "TestUser", context);
    expect(result.score).toBe(1.0);
    expect(result.blockedDomain).toBe(true);
    expect(result.reasons.some((r) => r.includes("blocked domain"))).toBe(true);
  });

  it("adds 0.5 for repeated body within window", async () => {
    const store: Record<string, string> = {};
    const redis = createMockRedis(store);

    const context = createMockContext({ redis });

    // First submission — sets the key
    await computeSpamScore("buy now!", "TestUser", context);

    // Second submission — should detect duplicate
    const hash = simpleHash("buy now!");
    // The first call set the key, now it exists for the second call
    const result = await computeSpamScore("buy now!", "TestUser", context);
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.reasons.some((r) => r.includes("repeated"))).toBe(true);
  });

  it("adds 0.3 for new account with low karma", async () => {
    const context = createMockContext({
      userCreatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day old
      userKarma: { commentKarma: 3, linkKarma: 2 },
    });
    const result = await computeSpamScore(
      "Hello world",
      "NewUser",
      context
    );
    expect(result.score).toBeCloseTo(0.3, 2);
    expect(result.reasons.some((r) => r.includes("new account"))).toBe(true);
  });

  it("does not penalize old account or high karma", async () => {
    const context = createMockContext({
      userCreatedAt: new Date("2020-01-01"),
      userKarma: { commentKarma: 5000, linkKarma: 2000 },
    });
    const result = await computeSpamScore(
      "Hello world",
      "OldUser",
      context
    );
    expect(result.score).toBe(0);
  });

  it("clamps composite score to 1.0", async () => {
    // URL count (+0.4) + repeated body (+0.5) + new account (+0.3) = 1.2 → clamp to 1.0
    const store: Record<string, string> = {};
    const redis = createMockRedis(store);

    const context = createMockContext({
      redis,
      userCreatedAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour old
      userKarma: { commentKarma: 0, linkKarma: 0 },
    });

    const body =
      "https://a.com https://b.com https://c.com https://d.com spam";
    // First call sets the key
    await computeSpamScore(body, "Spammer", context);
    // Second call triggers all heuristics
    const result = await computeSpamScore(body, "Spammer", context);
    expect(result.score).toBe(1.0);
  });

  it("returns safe default on unexpected error", async () => {
    // Create a context where settings.get throws
    const context = {
      settings: {
        get: vi.fn().mockRejectedValue(new Error("boom")),
      },
      redis: createMockRedis(),
      reddit: {
        getUserByUsername: vi.fn().mockRejectedValue(new Error("boom")),
      },
    } as unknown as TriggerContext;

    const result = await computeSpamScore("test", "User", context);
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
    expect(result.blockedDomain).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enforceSpam tests
// ---------------------------------------------------------------------------

describe("enforceSpam", () => {
  it("flags when score >= flag threshold in flag mode", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.60,
      reasons: ["4 URLs detected"],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("spam_flagged");
    expect(context.reddit.report).toHaveBeenCalled();
  });

  it("flags even when score >= remove threshold in flag mode (safe default)", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.90,
      reasons: ["spam"],
      blockedDomain: false,
    };

    // In flag mode, should flag, not remove
    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("spam_flagged");
  });

  it("removes when score >= threshold in remove mode", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.80,
        [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.50,
        [SETTINGS.SPAM_MODE]: "remove",
        [SETTINGS.DRY_RUN]: false,
      }),
    });
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.85,
      reasons: ["spam"],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("spam_removed");
  });

  it("always removes for blocked domains regardless of mode", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.SPAM_MODE]: "flag", // flag mode
        [SETTINGS.DRY_RUN]: false,
      }),
    });
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 1.0,
      reasons: ["blocked domain: https://bit.ly/malware"],
      blockedDomain: true,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("spam_removed");
  });

  it("returns dry_run_spam_remove in dry-run mode", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.80,
        [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.50,
        [SETTINGS.SPAM_MODE]: "remove",
        [SETTINGS.DRY_RUN]: true,
      }),
    });
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.90,
      reasons: ["spam"],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("dry_run_spam_remove");
    expect(context.reddit.getCommentById).not.toHaveBeenCalled();
  });

  it("returns dry_run_spam_flag in dry-run mode", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.80,
        [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.50,
        [SETTINGS.SPAM_MODE]: "flag",
        [SETTINGS.DRY_RUN]: true,
      }),
    });
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.60,
      reasons: ["spam"],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("dry_run_spam_flag");
    expect(context.reddit.report).not.toHaveBeenCalled();
  });

  it("returns none when score is below flag threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.20,
      reasons: [],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("none");
  });

  it("returns none on internal error (fail safe)", async () => {
    const context = {
      settings: {
        get: vi.fn().mockRejectedValue(new Error("settings unavailable")),
      },
      reddit: {},
    } as unknown as TriggerContext;
    const record = makeRecord();
    const spamResult: SpamResult = {
      score: 0.90,
      reasons: ["spam"],
      blockedDomain: false,
    };

    const action = await enforceSpam(record, spamResult, context);
    expect(action).toBe("none");
  });
});
