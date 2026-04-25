import { describe, it, expect, vi } from "vitest";
import { handleBanUser } from "../bans.js";
import type { BanUserProps } from "../bans.js";
import type { Devvit } from "@devvit/public-api";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockContext(overrides: {
  username?: string;
  modPermissions?: string[];
  banUserFn?: ReturnType<typeof vi.fn>;
  getCurrentUserFn?: ReturnType<typeof vi.fn>;
  getModPermsFn?: ReturnType<typeof vi.fn>;
  modLogAddFn?: ReturnType<typeof vi.fn>;
  redisSetFn?: ReturnType<typeof vi.fn>;
  redisIncrByFn?: ReturnType<typeof vi.fn>;
} = {}): Devvit.Context {
  const modPermissions = overrides.modPermissions ?? ["all"];
  const getModPermsFn =
    overrides.getModPermsFn ??
    vi.fn().mockResolvedValue(modPermissions);
  const getCurrentUserFn =
    overrides.getCurrentUserFn ??
    vi.fn().mockResolvedValue({
      username: overrides.username ?? "ModUser",
      getModPermissionsForSubreddit: getModPermsFn,
    });
  const banUserFn =
    overrides.banUserFn ?? vi.fn().mockResolvedValue(undefined);
  const modLogAddFn =
    overrides.modLogAddFn ?? vi.fn().mockResolvedValue(undefined);
  const redisSetFn =
    overrides.redisSetFn ?? vi.fn().mockResolvedValue(undefined);
  const redisIncrByFn =
    overrides.redisIncrByFn ?? vi.fn().mockResolvedValue(1);

  return {
    reddit: {
      getCurrentUser: getCurrentUserFn,
      banUser: banUserFn,
    },
    modLog: {
      add: modLogAddFn,
    },
    redis: {
      set: redisSetFn,
      incrBy: redisIncrByFn,
    },
  } as unknown as Devvit.Context;
}

function makeProps(overrides: Partial<BanUserProps> = {}): BanUserProps {
  return {
    username: "BadUser",
    subredditName: "testsub",
    reason: "Toxic behaviour",
    duration: 0,
    note: "",
    commentId: "t1_ban123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleBanUser", () => {
  // ── Happy path ──────────────────────────────────────────────────────

  it("bans user, writes mod log, persists analytics, and returns success", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const modLogAddFn = vi.fn().mockResolvedValue(undefined);
    const redisSetFn = vi.fn().mockResolvedValue(undefined);
    const redisIncrByFn = vi.fn().mockResolvedValue(1);
    const context = createMockContext({
      banUserFn,
      modLogAddFn,
      redisSetFn,
      redisIncrByFn,
    });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("BadUser");
    expect(result.message).toContain("permanently");

    // Verify banUser was called correctly
    expect(banUserFn).toHaveBeenCalledWith({
      subredditName: "testsub",
      username: "BadUser",
      reason: "Toxic behaviour",
      duration: undefined, // permanent
      note: undefined,
    });

    // Verify mod log
    expect(modLogAddFn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "banuser",
        target: "t1_ban123",
        details: "botditor",
      })
    );

    // Verify analytics persisted in Redis
    const setCalls = redisSetFn.mock.calls;
    const banRecordCall = setCalls.find(
      (args: unknown[]) => (args[0] as string).startsWith("ban:")
    );
    expect(banRecordCall).toBeDefined();
    const payload = JSON.parse(banRecordCall![1] as string);
    expect(payload.username).toBe("BadUser");
    expect(payload.moderator).toBe("ModUser");
    expect(payload.subredditName).toBe("testsub");

    // Verify ban counter incremented
    expect(redisIncrByFn).toHaveBeenCalledWith("bans:count:testsub", 1);
  });

  it("uses duration in days for temporary bans", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ banUserFn });
    const props = makeProps({ duration: 7 });

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("7 day(s)");
    expect(banUserFn).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 7 })
    );
  });

  // ── Permission checks ───────────────────────────────────────────────

  it("returns error when mod lacks ban permissions", async () => {
    const banUserFn = vi.fn();
    const context = createMockContext({
      modPermissions: ["posts", "wiki"],
      banUserFn,
    });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("ban permissions");
    expect(banUserFn).not.toHaveBeenCalled();
  });

  it("allows ban when mod has 'access' permission", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({
      modPermissions: ["access"],
      banUserFn,
    });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
    expect(banUserFn).toHaveBeenCalled();
  });

  it("allows ban when mod has 'all' permission", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({
      modPermissions: ["all"],
      banUserFn,
    });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
    expect(banUserFn).toHaveBeenCalled();
  });

  it("returns error when getCurrentUser returns null", async () => {
    const getCurrentUserFn = vi.fn().mockResolvedValue(null);
    const banUserFn = vi.fn();
    const context = createMockContext({ getCurrentUserFn, banUserFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("current user");
    expect(banUserFn).not.toHaveBeenCalled();
  });

  // ── Already banned ──────────────────────────────────────────────────

  it("returns descriptive error when user is already banned", async () => {
    const banUserFn = vi
      .fn()
      .mockRejectedValue(new Error("USER_ALREADY_BANNED"));
    const context = createMockContext({ banUserFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("already banned");
  });

  // ── API failure ─────────────────────────────────────────────────────

  it("returns error when banUser API throws unexpected error", async () => {
    const banUserFn = vi
      .fn()
      .mockRejectedValue(new Error("Network timeout"));
    const context = createMockContext({ banUserFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Network timeout");
  });

  // ── Non-fatal mod log failure ───────────────────────────────────────

  it("still returns success when mod log write fails", async () => {
    const modLogAddFn = vi
      .fn()
      .mockRejectedValue(new Error("ModLog unavailable"));
    const context = createMockContext({ modLogAddFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
  });

  // ── Non-fatal analytics failure ─────────────────────────────────────

  it("still returns success when Redis analytics write fails", async () => {
    const redisSetFn = vi
      .fn()
      .mockRejectedValue(new Error("Redis down"));
    const context = createMockContext({ redisSetFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(true);
  });

  // ── Unexpected top-level error ──────────────────────────────────────

  it("catches unexpected errors and returns failure", async () => {
    const getCurrentUserFn = vi
      .fn()
      .mockRejectedValue(new Error("Unhandled crash"));
    const context = createMockContext({ getCurrentUserFn });
    const props = makeProps();

    const result = await handleBanUser(props, context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("unexpected error");
  });

  // ── Note handling ───────────────────────────────────────────────────

  it("passes note to banUser when provided", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ banUserFn });
    const props = makeProps({ note: "Repeat offender" });

    await handleBanUser(props, context);

    expect(banUserFn).toHaveBeenCalledWith(
      expect.objectContaining({ note: "Repeat offender" })
    );
  });

  it("omits note when empty string", async () => {
    const banUserFn = vi.fn().mockResolvedValue(undefined);
    const context = createMockContext({ banUserFn });
    const props = makeProps({ note: "" });

    await handleBanUser(props, context);

    expect(banUserFn).toHaveBeenCalledWith(
      expect.objectContaining({ note: undefined })
    );
  });
});
