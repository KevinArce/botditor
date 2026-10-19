import { describe, it, expect, vi } from "vitest";
import type { SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import { enforceToxicity, enforceBot } from "../moderation.js";
import { DEFAULT_RULES, REMOVED_DEDUP_TTL_S } from "../types.js";
import type { AnalysisResult, IngestedComment, ModerationRules } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockContext(overrides: {
  removeThrows?: boolean;
  removeFn?: ReturnType<typeof vi.fn>;
  reportFn?: ReturnType<typeof vi.fn>;
  removalNoteFn?: ReturnType<typeof vi.fn>;
  removalNoteThrows?: boolean;
  redisGetFn?: ReturnType<typeof vi.fn>;
  redisSetFn?: ReturnType<typeof vi.fn>;
  redisExpireFn?: ReturnType<typeof vi.fn>;
} = {}): TriggerContext {
  const removeFn = overrides.removeFn ?? (overrides.removeThrows
    ? vi.fn().mockRejectedValue(new Error("404 not found"))
    : vi.fn().mockResolvedValue(undefined));

  const reportFn = overrides.reportFn ?? vi.fn().mockResolvedValue(undefined);

  const removalNoteFn = overrides.removalNoteFn ?? (overrides.removalNoteThrows
    ? vi.fn().mockRejectedValue(new Error("Removal note unavailable"))
    : vi.fn().mockResolvedValue(undefined));

  const redisGetFn = overrides.redisGetFn ?? vi.fn().mockResolvedValue(null);
  const redisSetFn = overrides.redisSetFn ?? vi.fn().mockResolvedValue(undefined);
  const redisExpireFn = overrides.redisExpireFn ?? vi.fn().mockResolvedValue(undefined);

  const mockComment = {
    remove: removeFn,
    addRemovalNote: removalNoteFn,
    id: "t1_test123",
  };

  return {
    reddit: {
      getCommentById: vi.fn().mockResolvedValue(mockComment),
      report: reportFn,
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

  // ── Story 07 / OPS-3: Removal notes ───────────────────────────────

  it("adds a mod-facing removal note with the botditor reason after removal", async () => {
    const removalNoteFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ removalNoteFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95, reason: "extremely toxic language" });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("removed");
    expect(removalNoteFn).toHaveBeenCalledWith({
      reasonId: "",
      modNote: "[botditor] extremely toxic language",
    });
  });

  it("truncates the removal note to Reddit's 100-character limit", async () => {
    const removalNoteFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ removalNoteFn });
    const analysis = makeAnalysis({ toxicityScore: 0.95, reason: "x".repeat(300) });

    await enforceToxicity(makeRecord(), analysis, makeRules(), context);

    const { modNote } = removalNoteFn.mock.calls[0][0] as { modNote: string };
    expect(modNote.length).toBe(100);
    expect(modNote.endsWith("…")).toBe(true);
  });

  it("still returns removed when the removal note fails", async () => {
    const context = createMockContext({ removalNoteThrows: true });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    // Removal should succeed even if the note fails
    expect(action).toBe("removed");
  });

  it("does NOT add a removal note in dry-run mode", async () => {
    const removalNoteFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ removalNoteFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    await enforceToxicity(record, analysis, makeRules({ dryRun: true }), context);

    expect(removalNoteFn).not.toHaveBeenCalled();
  });

  // ── Story 07: Deduplication via Redis ─────────────────────────────

  it("sets dedup key in Redis after successful removal", async () => {
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ redisSetFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, makeRules(), context);

    expect(action).toBe("removed");
    const [key, value, options] = redisSetFn.mock.calls[0];
    expect(key).toBe("removed:t1_test123");
    expect(value).toBe("1");
    // COR-4: dedup key expires after 7 days
    const ttlMs = (options as { expiration: Date }).expiration.getTime() - Date.now();
    expect(Math.abs(ttlMs - REMOVED_DEDUP_TTL_S * 1000)).toBeLessThan(1000);
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

// ---------------------------------------------------------------------------
// Story 05 – Bot-likelihood flagging
// ---------------------------------------------------------------------------

describe("enforceBot", () => {
  it("reports when bot-likelihood >= botFlagThreshold", async () => {
    const reportFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ reportFn });
    const analysis = makeAnalysis({ botLikelihood: 0.8, reason: "templated text" });

    const action = await enforceBot(makeRecord(), analysis, makeRules(), context);

    expect(action).toBe("bot_flagged");
    expect(reportFn).toHaveBeenCalledWith(expect.anything(), {
      reason: "[botditor] bot-likelihood=0.8 — templated text",
    });
  });

  it("flags at exactly the threshold", async () => {
    const context = createMockContext();
    const analysis = makeAnalysis({ botLikelihood: 0.75 });

    const action = await enforceBot(makeRecord(), analysis, makeRules(), context);
    expect(action).toBe("bot_flagged");
  });

  it("takes no action below the threshold", async () => {
    const reportFn = vi.fn();
    const context = createMockContext({ reportFn });
    const analysis = makeAnalysis({ botLikelihood: 0.74 });

    const action = await enforceBot(makeRecord(), analysis, makeRules(), context);

    expect(action).toBe("none");
    expect(reportFn).not.toHaveBeenCalled();
  });

  it("respects a custom botFlagThreshold", async () => {
    const context = createMockContext();
    const analysis = makeAnalysis({ botLikelihood: 0.5 });

    const action = await enforceBot(
      makeRecord(),
      analysis,
      makeRules({ botFlagThreshold: 0.4 }),
      context
    );
    expect(action).toBe("bot_flagged");
  });

  it("returns dry_run_bot_flag without reporting in dry-run mode", async () => {
    const reportFn = vi.fn();
    const context = createMockContext({ reportFn });
    const analysis = makeAnalysis({ botLikelihood: 0.9 });

    const action = await enforceBot(makeRecord(), analysis, makeRules({ dryRun: true }), context);

    expect(action).toBe("dry_run_bot_flag");
    expect(reportFn).not.toHaveBeenCalled();
  });

  it("never removes the comment", async () => {
    const removeFn = vi.fn();
    const context = createMockContext({ removeFn });
    const analysis = makeAnalysis({ botLikelihood: 1 });

    await enforceBot(makeRecord(), analysis, makeRules(), context);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it("does not double-report a comment already flagged for another reason", async () => {
    const reportFn = vi.fn();
    const redisGetFn = vi.fn().mockResolvedValue('{"score":0.7}'); // flagged:<id> exists
    const context = createMockContext({ reportFn, redisGetFn });
    const analysis = makeAnalysis({ botLikelihood: 0.9 });

    const action = await enforceBot(makeRecord(), analysis, makeRules(), context);

    expect(action).toBe("none");
    expect(reportFn).not.toHaveBeenCalled();
  });

  it("returns none when the report call fails", async () => {
    const reportFn = vi.fn().mockRejectedValue(new Error("rate limited"));
    const context = createMockContext({ reportFn });
    const analysis = makeAnalysis({ botLikelihood: 0.9 });

    const action = await enforceBot(makeRecord(), analysis, makeRules(), context);
    expect(action).toBe("none");
  });
});
