import { describe, it, expect, vi } from "vitest";
import type { TriggerContext } from "@devvit/public-api";
import { sendWarning, interpolateTemplate } from "../warnings.js";
import { DEFAULT_RULES } from "../types.js";
import type { IngestedComment, ModerationRules } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockContext(overrides: {
  sendPmFn?: ReturnType<typeof vi.fn>;
  getCommentByIdFn?: ReturnType<typeof vi.fn>;
  redisGetFn?: ReturnType<typeof vi.fn>;
  redisSetFn?: ReturnType<typeof vi.fn>;
  redisExpireFn?: ReturnType<typeof vi.fn>;
  settingsGetFn?: ReturnType<typeof vi.fn>;
} = {}): TriggerContext {
  const sendPmFn = overrides.sendPmFn ?? vi.fn().mockResolvedValue(undefined);
  const getCommentByIdFn = overrides.getCommentByIdFn ??
    vi.fn().mockResolvedValue({ authorName: "FlaggedUser" });
  const redisGetFn = overrides.redisGetFn ?? vi.fn().mockResolvedValue(null);
  const redisSetFn = overrides.redisSetFn ?? vi.fn().mockResolvedValue(undefined);
  const redisExpireFn = overrides.redisExpireFn ?? vi.fn().mockResolvedValue(undefined);
  const settingsGetFn = overrides.settingsGetFn ?? vi.fn().mockResolvedValue(null);

  return {
    reddit: {
      sendPrivateMessage: sendPmFn,
      getCommentById: getCommentByIdFn,
    },
    redis: {
      get: redisGetFn,
      set: redisSetFn,
      expire: redisExpireFn,
    },
    settings: {
      get: settingsGetFn,
    },
  } as unknown as TriggerContext;
}

function makeRecord(overrides: Partial<IngestedComment> = {}): IngestedComment {
  return {
    commentId: "t1_warn123",
    postId: "t3_post1",
    subredditName: "testsub",
    authorName: "FlaggedUser",
    body: "This is a flagged comment",
    createdAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    status: "analyzed",
    ...overrides,
  };
}

function makeRules(overrides: Partial<ModerationRules> = {}): ModerationRules {
  return { ...DEFAULT_RULES, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendWarning", () => {
  // ── Happy path ──────────────────────────────────────────────────────

  it("sends PM, stores cooldown, and returns 'warned'", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const redisExpireFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn, redisSetFn, redisExpireFn });
    const record = makeRecord();

    const action = await sendWarning(record, "toxicity detected", makeRules(), context);

    expect(action).toBe("warned");
    expect(sendPmFn).toHaveBeenCalledWith({
      to: "FlaggedUser",
      subject: expect.stringContaining("r/testsub"),
      text: expect.stringContaining("FlaggedUser"),
    });
    // Verify the PM body includes the issue
    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.text).toContain("toxicity detected");
  });

  it("stores cooldown in Redis with 48-hour TTL", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const redisExpireFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn, redisExpireFn });
    const record = makeRecord();

    await sendWarning(record, "spam heuristics", makeRules(), context);

    // Cooldown key should be set
    const setCalls = redisSetFn.mock.calls;
    const cooldownCall = setCalls.find(
      (args: unknown[]) => (args[0] as string).startsWith("warned:")
    );
    expect(cooldownCall).toBeDefined();
    expect(cooldownCall![0]).toBe("warned:flaggeduser"); // lowercase
    const payload = JSON.parse(cooldownCall![1] as string);
    expect(payload.commentId).toBe("t1_warn123");
    expect(payload.issue).toBe("spam heuristics");
    expect(payload.timestamp).toBeDefined();

    // TTL should be 48 hours (172800 seconds)
    expect(redisExpireFn).toHaveBeenCalledWith("warned:flaggeduser", 172_800);
  });

  // ── Cooldown (48h dedup) ────────────────────────────────────────────

  it("skips warning when cooldown key already exists (within 48h)", async () => {
    const redisGetFn = vi.fn().mockResolvedValue('{"commentId":"t1_old"}');
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisGetFn, sendPmFn });
    const record = makeRecord();

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    expect(action).toBe("none");
    expect(sendPmFn).not.toHaveBeenCalled();
  });

  it("proceeds with warning when cooldown Redis read fails", async () => {
    const redisGetFn = vi.fn().mockRejectedValue(new Error("Redis down"));
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisGetFn, sendPmFn });
    const record = makeRecord();

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    expect(action).toBe("warned");
    expect(sendPmFn).toHaveBeenCalled();
  });

  // ── Dry-run mode ──────────────────────────────────────────────────

  it("returns 'dry_run_warn' and does NOT send PM in dry-run mode", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn, redisSetFn });
    const record = makeRecord();

    const action = await sendWarning(
      record,
      "toxicity",
      makeRules({ dryRun: true }),
      context
    );

    expect(action).toBe("dry_run_warn");
    expect(sendPmFn).not.toHaveBeenCalled();
    // Should NOT set cooldown key either
    expect(redisSetFn).not.toHaveBeenCalled();
  });

  // ── PM failure ──────────────────────────────────────────────────────

  it("returns 'none' when sendPrivateMessage throws", async () => {
    const sendPmFn = vi.fn().mockRejectedValue(new Error("User has PMs disabled"));
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn, redisSetFn });
    const record = makeRecord();

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    expect(action).toBe("none");
    // Should NOT set cooldown key on PM failure
    const cooldownCall = redisSetFn.mock.calls.find(
      (args: unknown[]) => (args[0] as string).startsWith("warned:")
    );
    expect(cooldownCall).toBeUndefined();
  });

  // ── Redis cooldown write failure ──────────────────────────────────

  it("still returns 'warned' when cooldown Redis write fails", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const redisSetFn = vi.fn().mockRejectedValue(new Error("Redis write fail"));
    const context = createMockContext({ sendPmFn, redisSetFn });
    const record = makeRecord();

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    // PM was sent successfully, so action is still "warned"
    expect(action).toBe("warned");
  });

  // ── Template selection ────────────────────────────────────────────

  it("uses strict template when profile is strict", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn });
    const record = makeRecord();

    await sendWarning(
      record,
      "severe toxicity",
      makeRules({ moderationProfile: "strict" }),
      context
    );

    const callArgs = sendPmFn.mock.calls[0][0];
    // Strict template uses formal language
    expect(callArgs.text).toContain("formal notice");
    expect(callArgs.text).toContain("severe toxicity");
    expect(callArgs.text).toContain("FlaggedUser");
  });

  it("uses chill template when profile is chill", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn });
    const record = makeRecord();

    await sendWarning(
      record,
      "mild spam",
      makeRules({ moderationProfile: "chill" }),
      context
    );

    const callArgs = sendPmFn.mock.calls[0][0];
    // Chill template uses informal language
    expect(callArgs.text).toContain("heads-up");
    expect(callArgs.text).toContain("mild spam");
    expect(callArgs.text).toContain("FlaggedUser");
  });

  it("uses custom template from settings when available", async () => {
    const customTemplate = "Dear {{username}}, you've been warned for {{issue}}. Rules: {{rulesLink}}";
    const settingsGetFn = vi.fn().mockResolvedValue(customTemplate);
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ settingsGetFn, sendPmFn });
    const record = makeRecord();

    await sendWarning(record, "spam", makeRules(), context);

    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.text).toBe("Dear FlaggedUser, you've been warned for spam. Rules: https://www.reddit.com/r/testsub/about/rules");
  });

  // ── Rules link ────────────────────────────────────────────────────

  it("includes correct subreddit rules link in the PM body", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn });
    const record = makeRecord({ subredditName: "MySubreddit" });

    await sendWarning(record, "toxicity", makeRules(), context);

    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.text).toContain("https://www.reddit.com/r/MySubreddit/about/rules");
  });

  // ── Subject line ──────────────────────────────────────────────────

  it("uses [botditor] prefixed subject with subreddit name", async () => {
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn });
    const record = makeRecord();

    await sendWarning(record, "toxicity", makeRules(), context);

    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.subject).toBe("[botditor] Warning — r/testsub");
  });

  // ── Username resolution ─────────────────────────────────────────────

  it("resolves actual username when record has internal user ID (t2_xxx)", async () => {
    const getCommentByIdFn = vi.fn().mockResolvedValue({ authorName: "RealUsername" });
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn, getCommentByIdFn });
    const record = makeRecord({ authorName: "t2_abc123" });

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    expect(action).toBe("warned");
    // PM should be sent to the resolved username, not the internal ID
    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.to).toBe("RealUsername");
    expect(callArgs.text).toContain("RealUsername");
    expect(callArgs.text).not.toContain("t2_abc123");
  });

  it("falls back to record authorName when getCommentById fails", async () => {
    const getCommentByIdFn = vi.fn().mockRejectedValue(new Error("Comment not found"));
    const sendPmFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ sendPmFn, getCommentByIdFn });
    const record = makeRecord({ authorName: "FallbackUser" });

    const action = await sendWarning(record, "toxicity", makeRules(), context);

    expect(action).toBe("warned");
    const callArgs = sendPmFn.mock.calls[0][0];
    expect(callArgs.to).toBe("FallbackUser");
  });
});

// ---------------------------------------------------------------------------
// interpolateTemplate
// ---------------------------------------------------------------------------

describe("interpolateTemplate", () => {
  it("replaces all known placeholders", () => {
    const template = "Hello {{username}}, issue: {{issue}}, rules: {{rulesLink}}";
    const result = interpolateTemplate(template, {
      username: "TestUser",
      issue: "toxicity",
      rulesLink: "https://example.com/rules",
    });
    expect(result).toBe("Hello TestUser, issue: toxicity, rules: https://example.com/rules");
  });

  it("leaves unknown placeholders as-is", () => {
    const template = "Hi {{username}}, your {{unknown}} is noted";
    const result = interpolateTemplate(template, { username: "Test" });
    expect(result).toBe("Hi Test, your {{unknown}} is noted");
  });

  it("handles templates with no placeholders", () => {
    const template = "This is a plain message.";
    const result = interpolateTemplate(template, { username: "Test" });
    expect(result).toBe("This is a plain message.");
  });

  it("handles empty template", () => {
    const result = interpolateTemplate("", { username: "Test" });
    expect(result).toBe("");
  });

  it("replaces multiple occurrences of the same placeholder", () => {
    const template = "{{username}} said something. Listen up, {{username}}!";
    const result = interpolateTemplate(template, { username: "Alice" });
    expect(result).toBe("Alice said something. Listen up, Alice!");
  });
});
