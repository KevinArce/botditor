import { describe, it, expect, vi } from "vitest";
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";
import { enforceToxicity } from "../moderation.js";
import { SETTINGS } from "../types.js";
import type { AnalysisResult, IngestedComment } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

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
  removeThrows?: boolean;
  removeFn?: ReturnType<typeof vi.fn>;
  reportFn?: ReturnType<typeof vi.fn>;
} = {}): TriggerContext {
  const settings = overrides.settings ?? createMockSettings({
    [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.85,
    [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.60,
    [SETTINGS.DRY_RUN]: false,
  });

  const removeFn = overrides.removeFn ?? (overrides.removeThrows
    ? vi.fn().mockRejectedValue(new Error("404 not found"))
    : vi.fn().mockResolvedValue(undefined));

  const reportFn = overrides.reportFn ?? vi.fn().mockResolvedValue(undefined);

  const mockComment = {
    remove: removeFn,
    id: "t1_test123",
  };

  return {
    settings,
    reddit: {
      getCommentById: vi.fn().mockResolvedValue(mockComment),
      report: reportFn,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enforceToxicity", () => {
  // ── Remove action ─────────────────────────────────────────────────

  it("removes comment when toxicity >= remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.90 });

    const action = await enforceToxicity(record, analysis, context);

    expect(action).toBe("removed");
    const comment = await (context.reddit.getCommentById as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(comment.remove).toHaveBeenCalled();
  });

  it("removes at exactly the remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.85 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("removed");
  });

  // ── Flag action ───────────────────────────────────────────────────

  it("flags comment when toxicity >= flag threshold but < remove threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, context);

    expect(action).toBe("flagged");
    expect(context.reddit.report).toHaveBeenCalled();
  });

  it("flags at exactly the flag threshold", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.60 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("flagged");
  });

  // ── No action ─────────────────────────────────────────────────────

  it("takes no action when toxicity is below both thresholds", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.30 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("none");
  });

  it("takes no action for zero scores (safe fallback)", async () => {
    const context = createMockContext();
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("none");
  });

  // ── Dry-run mode ──────────────────────────────────────────────────

  it("returns dry_run_remove in dry-run mode when above remove threshold", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.85,
        [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.60,
        [SETTINGS.DRY_RUN]: true,
      }),
    });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("dry_run_remove");
    // Should NOT have called remove
    expect(context.reddit.getCommentById).not.toHaveBeenCalled();
  });

  it("returns dry_run_flag in dry-run mode when above flag threshold", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.85,
        [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.60,
        [SETTINGS.DRY_RUN]: true,
      }),
    });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("dry_run_flag");
    expect(context.reddit.report).not.toHaveBeenCalled();
  });

  // ── Error handling ────────────────────────────────────────────────

  it("returns none when comment remove throws (already deleted)", async () => {
    const context = createMockContext({ removeThrows: true });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.95 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("none");
  });

  it("returns none when report throws", async () => {
    const reportFn = vi.fn().mockRejectedValue(new Error("Report failed"));
    const context = createMockContext({ reportFn });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.70 });

    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("none");
  });

  // ── Custom thresholds ─────────────────────────────────────────────

  it("respects custom thresholds from settings", async () => {
    const context = createMockContext({
      settings: createMockSettings({
        [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.50,
        [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.20,
        [SETTINGS.DRY_RUN]: false,
      }),
    });
    const record = makeRecord();

    // Score of 0.55 should trigger remove with threshold 0.50
    const action1 = await enforceToxicity(record, makeAnalysis({ toxicityScore: 0.55 }), context);
    expect(action1).toBe("removed");
  });

  it("uses defaults when settings are not configured", async () => {
    const context = createMockContext({
      settings: createMockSettings({}), // no settings set
    });
    const record = makeRecord();
    const analysis = makeAnalysis({ toxicityScore: 0.30 });

    // Should fall through to "none" with default thresholds (0.85/0.60)
    const action = await enforceToxicity(record, analysis, context);
    expect(action).toBe("none");
  });
});
