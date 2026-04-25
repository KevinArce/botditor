import { describe, it, expect, vi } from "vitest";
import type { SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import { enforceToxicity } from "../moderation.js";
import { DEFAULT_RULES } from "../types.js";
import type { AnalysisResult, IngestedComment, ModerationRules } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockContext(overrides: {
  removeThrows?: boolean;
  removeFn?: ReturnType<typeof vi.fn>;
  reportFn?: ReturnType<typeof vi.fn>;
  modLogFn?: ReturnType<typeof vi.fn>;
  modLogThrows?: boolean;
  redisGetFn?: ReturnType<typeof vi.fn>;
  redisSetFn?: ReturnType<typeof vi.fn>;
  redisExpireFn?: ReturnType<typeof vi.fn>;
} = {}): TriggerContext {
  const removeFn = overrides.removeFn ?? (overrides.removeThrows
    ? vi.fn().mockRejectedValue(new Error("404 not found"))
    : vi.fn().mockResolvedValue(undefined));

  const reportFn = overrides.reportFn ?? vi.fn().mockResolvedValue(undefined);

  const modLogFn = overrides.modLogFn ?? (overrides.modLogThrows
    ? vi.fn().mockRejectedValue(new Error("Mod log unavailable"))
    : vi.fn().mockResolvedValue(undefined));

  const redisGetFn = overrides.redisGetFn ?? vi.fn().mockResolvedValue(null);
  const redisSetFn = overrides.redisSetFn ?? vi.fn().mockResolvedValue(undefined);
  const redisExpireFn = overrides.redisExpireFn ?? vi.fn().mockResolvedValue(undefined);

  const mockComment = {
    remove: removeFn,
    id: "t1_test123",
  };

  return {
    reddit: {
      getCommentById: vi.fn().mockResolvedValue(mockComment),
      report: reportFn,
    },
    modLog: {
      add: modLogFn,
    },
    redis: {
      get: redisGetFn,
      set: redisSetFn,
      expire: redisExpireFn,
    },
  } as unknown as TriggerContext;
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
    status: "analyzed",
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    toxicityScore: 0,
    spamScore: 0,
    botLikelihood: 0,
    sentiment: "neutral",
    reason: "test reason",
    ...overrides,
  };
}

function makeRules(overrides: Partial<ModerationRules> = {}): ModerationRules {
  return { ...DEFAULT_RULES, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enforceToxicity", () => {
  // ── Remove action ─────────────────────────────────────────────────

  it("removes comment when toxicity >= remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.90 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("removed");
    const comment = await (context.reddit.getCommentById as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(comment.remove).toHaveBeenCalled();
  });

  it("removes at exactly the remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.85 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("removed");
  });

  // ── Flag action ───────────────────────────────────────────────────

  it("flags comment when toxicity >= flag threshold but < remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("flagged");
    expect(context.reddit.report).toHaveBeenCalled();
  });

  it("flags at exactly the flag threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.60 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("flagged");
  });

  // ── No action ─────────────────────────────────────────────────────

  it("takes no action when toxicity is below both thresholds", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.30 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("none");
  });

  it("takes no action for zero scores (safe fallback)", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("none");
  });

  // ── Dry-run mode ──────────────────────────────────────────────────

  it("returns dry_run_remove in dry-run mode when above remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(
      record,
      analysis,
      makeRules({ dryRun: true }),
      context
    );
    expect(action).toBe("dry_run_remove");
    // Should NOT have called remove
    expect(context.reddit.getCommentById).not.toHaveBeenCalled();
  });

  it("returns dry_run_flag in dry-run mode when above flag threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(
      record,
      analysis,
      makeRules({ dryRun: true }),
      context
    );
    expect(action).toBe("dry_run_flag");
    expect(context.reddit.report).not.toHaveBeenCalled();
  });

  // ── Error handling ────────────────────────────────────────────────

  it("returns none when comment remove throws (already deleted)", async () => {
    const context = createMockContext({ removeThrows: true });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("none");
  });

  it("returns none when report throws", async () => {
    const reportFn = vi.fn().mockRejectedValue(new Error("Report failed"));
    const context = createMockContext({ reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("none");
  });

  // ── Custom thresholds ─────────────────────────────────────────────

  it("respects custom thresholds from rules", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const rules = makeRules({
      toxicityRemoveThreshold: 0.50,
      toxicityFlagThreshold: 0.20,
    });

    // Score of 0.55 should trigger remove with threshold 0.50
    const action = await enforceToxicity(record, makeAnalysis({ toxicityScore: 0.55 }), rules, context);
    expect(action).toBe("removed");
  });

  it("uses defaults when rules have default values", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.30 });

    // Should fall through to "none" with default thresholds (0.85/0.60)
    const action = await enforceToxicity(record, analysis, makeRules(), context);
    expect(action).toBe("none");
  });

  // ── Story 07: Mod log entries ─────────────────────────────────────

  it("writes to mod log after successful removal with botditor details tag", async () => {
    const modLogFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ modLogFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95, reason: "extremely toxic language" });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("removed");
    expect(modLogFn).toHaveBeenCalledWith({
      action: "removecomment",
      target: "t1_test123",
      details: "botditor",
      description: "extremely toxic language",
    });
  });

  it("still returns removed when mod log write fails", async () => {
    const context = createMockContext({ modLogThrows: true });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    // Removal should succeed even if mod log fails
    expect(action).toBe("removed");
  });

  it("does NOT write mod log in dry-run mode", async () => {
    const modLogFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ modLogFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    await enforceToxicity(record, analysis, makeRules({ dryRun: true }), context);

    expect(modLogFn).not.toHaveBeenCalled();
  });

  // ── Story 07: Deduplication via Redis ─────────────────────────────

  it("sets dedup key in Redis after successful removal", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("removed");
    expect(redisSetFn).toHaveBeenCalledWith("removed:t1_test123", "1");
  });

  it("skips removal when dedup key already exists", async () => {
    const redisGetFn = vi.fn().mockResolvedValue("1"); // Already removed
    const context = createMockContext({ redisGetFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("none");
    // Should NOT have attempted to fetch/remove the comment
    expect(context.reddit.getCommentById).not.toHaveBeenCalled();
  });

  it("does NOT set dedup key in dry-run mode", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    await enforceToxicity(record, analysis, makeRules({ dryRun: true }), context);

    expect(redisSetFn).not.toHaveBeenCalled();
  });

  it("proceeds with removal when dedup Redis read fails", async () => {
    const redisGetFn = vi.fn().mockRejectedValue(new Error("Redis down"));
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisGetFn, redisSetFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    // Should still remove despite Redis failure
    expect(action).toBe("removed");
  });
});

// ---------------------------------------------------------------------------
// Story 08 – Flag for Manual Review
// ---------------------------------------------------------------------------

describe("enforceToxicity — Story 08 flagging", () => {
  it("reports with structured reason including score type and value", async () => {
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.72, reason: "possibly offensive" });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("flagged");
    expect(reportFn).toHaveBeenCalledWith(
      expect.anything(),
      { reason: expect.stringContaining("[botditor] toxicity=0.72") }
    );
    // Verify the reason text is included after the dash
    const callArgs = reportFn.mock.calls[0][1];
    expect(callArgs.reason).toContain("possibly offensive");
  });

  it("stores flagged record in Redis with score, reason, and timestamp", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const redisExpireFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn, redisExpireFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70, reason: "borderline content" });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("flagged");
    // The second set call is for the flagged record (first may be from dedup)
    const flagSetCall = redisSetFn.mock.calls.find(
      (args: unknown[]) => (args[0] as string).startsWith("flagged:")
    );
    expect(flagSetCall).toBeDefined();
    expect(flagSetCall![0]).toBe("flagged:t1_test123");
    const payload = JSON.parse(flagSetCall![1] as string);
    expect(payload.score).toBe(0.70);
    expect(payload.reason).toContain("borderline content");
    expect(payload.timestamp).toBeDefined();
  });

  it("sets 24-hour TTL on flagged record", async () => {
    const redisExpireFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisExpireFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.65 });

    await enforceToxicity(record, analysis, makeRules(), context);

    expect(redisExpireFn).toHaveBeenCalledWith("flagged:t1_test123", 86_400);
  });

  it("skips flag when dedup key already exists (within 24h window)", async () => {
    // Simulate: flagged:<id> already exists
    const redisGetFn = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("flagged:")) return Promise.resolve('{"score":0.7}');
      return Promise.resolve(null);
    });
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisGetFn, reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("none");
    // Should NOT have called report
    expect(reportFn).not.toHaveBeenCalled();
  });

  it("proceeds with flag when dedup Redis read fails", async () => {
    const redisGetFn = vi.fn().mockRejectedValue(new Error("Redis down"));
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisGetFn, reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("flagged");
    expect(reportFn).toHaveBeenCalled();
  });

  it("still returns flagged when Redis persistence fails", async () => {
    const redisSetFn = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("flagged:")) return Promise.reject(new Error("Redis write fail"));
      return Promise.resolve(undefined);
    });
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn, reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    // Report succeeded, so action is still "flagged" even though Redis write failed
    expect(action).toBe("flagged");
  });

  it("does NOT store flag record in dry-run mode", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn, reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(
      record,
      analysis,
      makeRules({ dryRun: true }),
      context
    );

    expect(action).toBe("dry_run_flag");
    expect(reportFn).not.toHaveBeenCalled();
    // No flagged: key should be written
    const flagSetCall = redisSetFn.mock.calls.find(
      (args: unknown[]) => (args[0] as string).startsWith("flagged:")
    );
    expect(flagSetCall).toBeUndefined();
  });
});
