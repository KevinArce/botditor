import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import {
  isUserAllowlisted,
  addUserToAllowlist,
  removeUserFromAllowlist,
  type AllowlistDeps,
} from "../allowlist.js";
import { REDIS_KEYS, SETTINGS } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRedis(): RedisClient {
  const store = new Map<string, string>();

  return {
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
  } as unknown as RedisClient;
}

function createMockSettings(
  values: Record<string, string | number | boolean | undefined> = {}
): SettingsClient {
  return {
    get: vi.fn(async <T>(key: string) => values[key] as T),
    getAll: vi.fn(async () => values),
  } as unknown as SettingsClient;
}

function createDeps(
  overrides: Partial<AllowlistDeps> = {}
): AllowlistDeps {
  return {
    redis: createMockRedis(),
    settings: createMockSettings(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("allowlist", () => {
  // ── isUserAllowlisted ─────────────────────────────────────────────

  describe("isUserAllowlisted", () => {
    it("returns false for an unknown user", async () => {
      const deps = createDeps();
      const result = await isUserAllowlisted("stranger", deps);
      expect(result).toBe(false);
    });

    it("implicitly allowlists the app's own username", async () => {
      const deps = createDeps({ appUsername: "BotditorApp" });
      const result = await isUserAllowlisted("BotditorApp", deps);
      expect(result).toBe(true);
    });

    it("self-allowlist is case-insensitive", async () => {
      const deps = createDeps({ appUsername: "BotditorApp" });
      const result = await isUserAllowlisted("botditorapp", deps);
      expect(result).toBe(true);
    });

    it("detects user added via Redis per-user flag", async () => {
      const redis = createMockRedis();

      // Simulate adding user to allowlist
      await addUserToAllowlist("TrustedUser", redis);

      const deps = createDeps({ redis });
      const result = await isUserAllowlisted("trusteduser", deps);
      expect(result).toBe(true);
    });

    it("returns false after removing from Redis allowlist", async () => {
      const redis = createMockRedis();

      await addUserToAllowlist("TempUser", redis);
      await removeUserFromAllowlist("TempUser", redis);

      const deps = createDeps({ redis });
      const result = await isUserAllowlisted("tempuser", deps);
      expect(result).toBe(false);
    });

    it("detects user from settings-based bulk allowlist", async () => {
      const settings = createMockSettings({
        [SETTINGS.ALLOWLIST_USERNAMES]: "alice, Bob, Charlie",
      });

      const deps = createDeps({ settings });
      const result = await isUserAllowlisted("bob", deps);
      expect(result).toBe(true);
    });

    it("settings-based check is case-insensitive", async () => {
      const settings = createMockSettings({
        [SETTINGS.ALLOWLIST_USERNAMES]: "Alice",
      });

      const deps = createDeps({ settings });
      const result = await isUserAllowlisted("ALICE", deps);
      expect(result).toBe(true);
    });

    it("returns false when settings allowlist is empty", async () => {
      const settings = createMockSettings({
        [SETTINGS.ALLOWLIST_USERNAMES]: "",
      });

      const deps = createDeps({ settings });
      const result = await isUserAllowlisted("ghost", deps);
      expect(result).toBe(false);
    });

    it("fails open (returns false) when Redis throws", async () => {
      const redis = {
        get: vi.fn().mockRejectedValue(new Error("Redis connection lost")),
      } as unknown as RedisClient;

      const settings = createMockSettings();
      const deps: AllowlistDeps = { redis, settings };

      const result = await isUserAllowlisted("anyone", deps);
      expect(result).toBe(false);
    });
  });

  // ── addUserToAllowlist ────────────────────────────────────────────

  describe("addUserToAllowlist", () => {
    it("sets the correct Redis key", async () => {
      const redis = createMockRedis();
      await addUserToAllowlist("NewUser", redis);

      const key = REDIS_KEYS.allowlistUser("newuser");
      expect(redis.set).toHaveBeenCalledWith(key, "1");
    });
  });

  // ── removeUserFromAllowlist ───────────────────────────────────────

  describe("removeUserFromAllowlist", () => {
    it("deletes the correct Redis key", async () => {
      const redis = createMockRedis();
      await removeUserFromAllowlist("OldUser", redis);

      const key = REDIS_KEYS.allowlistUser("olduser");
      expect(redis.del).toHaveBeenCalledWith(key);
    });
  });
});
