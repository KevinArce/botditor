/**
 * Allowlist service – checks and manages the per-user allowlist stored in Redis.
 *
 * The allowlist has two sources:
 *   1. Redis keys (`allowlist:user:<username>`) managed via menu actions.
 *   2. A comma-separated settings field for bulk import.
 *
 * Both are merged at read-time. The bot's own username is always implicitly
 * allowlisted to prevent self-analysis loops (Story 01 edge case).
 */
import type { RedisClient, SettingsClient } from "@devvit/public-api";
import { REDIS_KEYS, SETTINGS } from "./types.js";

export interface AllowlistDeps {
  redis: RedisClient;
  settings: SettingsClient;
  appUsername?: string;
}

/**
 * Returns `true` if `username` is on the allowlist (any source), meaning the
 * comment should be **skipped**.
 *
 * Checks in order (short-circuit):
 *   1. Is it the app's own username?
 *   2. Does a Redis key exist for this user?
 *   3. Is the user in the settings-based bulk list?
 *
 * If any check throws, we **fail open** (return `false`) per Story 23 edge
 * case guidance, so moderation is never silently bypassed on a kvStore outage.
 */
export async function isUserAllowlisted(
  username: string,
  deps: AllowlistDeps
): Promise<boolean> {
  const normalized = username.toLowerCase();

  // 1. Implicit self-allowlist
  if (deps.appUsername && normalized === deps.appUsername.toLowerCase()) {
    return true;
  }

  try {
    // 2. Per-user Redis flag
    const redisKey = REDIS_KEYS.allowlistUser(normalized);
    const redisValue = await deps.redis.get(redisKey);
    if (redisValue) {
      return true;
    }

    // 3. Bulk import via settings
    const raw = (await deps.settings.get<string>(SETTINGS.ALLOWLIST_USERNAMES)) ?? "";
    if (raw.trim().length > 0) {
      const usernames = raw
        .split(",")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
      if (usernames.includes(normalized)) {
        return true;
      }
    }

    return false;
  } catch (err) {
    // Fail open: proceed with analysis if allowlist read fails
    console.error(
      `[allowlist] Failed to check allowlist for "${username}", failing open:`,
      err
    );
    return false;
  }
}

/**
 * Add a username to the Redis-backed allowlist.
 */
export async function addUserToAllowlist(
  username: string,
  redis: RedisClient
): Promise<void> {
  const key = REDIS_KEYS.allowlistUser(username);
  await redis.set(key, "1");
  console.log(`[allowlist] Added "${username.toLowerCase()}" to allowlist`);
}

/**
 * Remove a username from the Redis-backed allowlist.
 */
export async function removeUserFromAllowlist(
  username: string,
  redis: RedisClient
): Promise<void> {
  const key = REDIS_KEYS.allowlistUser(username);
  await redis.del(key);
  console.log(
    `[allowlist] Removed "${username.toLowerCase()}" from allowlist`
  );
}
