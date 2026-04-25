/**
 * User Bans – Story 10
 *
 * Handles the "Ban User" menu action available on comments (moderator-only).
 * The flow mirrors the permission-check pattern in `nuke.ts`:
 *   1. Validate the acting moderator has `all` or `access` permissions.
 *   2. Execute the ban via `context.reddit.banUser()`.
 *   3. Record the action in the mod log (`context.modLog.add()`).
 *   4. Persist a ban record in Redis for Story 14 analytics.
 *
 * All errors are caught and returned as `{ success: false, message }` — no
 * exception escapes.
 */
import { Devvit } from "@devvit/public-api";
import { REDIS_KEYS } from "./types.js";

export type BanUserProps = {
  /** Reddit username to ban (without u/ prefix). */
  username: string;
  /** Subreddit name (without r/ prefix). */
  subredditName: string;
  /** Human-readable ban reason shown to the user. */
  reason: string;
  /** Ban duration in days. 0 = permanent. */
  duration: number;
  /** Optional moderator note (internal, not shown to user). */
  note: string;
  /** Comment ID that triggered the ban action (for audit trail). */
  commentId: string;
};

export type BanResult = {
  success: boolean;
  message: string;
};

/**
 * Execute a user ban with full permission checking, mod log, and analytics.
 *
 * Always returns a `BanResult` — never throws.
 */
export async function handleBanUser(
  props: BanUserProps,
  context: Devvit.Context
): Promise<BanResult> {
  try {
    return await handleBanUserInner(props, context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[bans] Unexpected error banning u/${props.username}:`,
      msg
    );
    return { success: false, message: "Ban failed — unexpected error." };
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function handleBanUserInner(
  props: BanUserProps,
  context: Devvit.Context
): Promise<BanResult> {
  const { username, subredditName, reason, duration, note, commentId } = props;

  // ── 1. Permission check ─────────────────────────────────────────────
  const user = await context.reddit.getCurrentUser();
  if (!user) {
    return { success: false, message: "Could not determine current user." };
  }

  const modPermissions = await user.getModPermissionsForSubreddit(subredditName);
  const canBan =
    modPermissions.includes("all") || modPermissions.includes("access");

  console.log(
    `[bans] Permission check: r/${subredditName} u/${user.username} ` +
    `permissions:[${modPermissions}] canBan=${canBan}`
  );

  if (!canBan) {
    console.info(
      `[bans] u/${user.username} lacks ban permissions in r/${subredditName}.`
    );
    return {
      success: false,
      message: "You do not have ban permissions in this subreddit.",
    };
  }

  // ── 2. Execute ban ──────────────────────────────────────────────────
  try {
    const truncatedReason = reason ? truncateModLog(reason) : undefined;
    await context.reddit.banUser({
      subredditName,
      username,
      reason: truncatedReason,
      duration: duration > 0 ? duration : undefined, // undefined = permanent
      note: note || undefined,
    });
    console.log(
      `[bans] Banned u/${username} from r/${subredditName} ` +
      `(duration=${duration === 0 ? "permanent" : `${duration}d`}, ` +
      `reason="${reason}", by u/${user.username})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Handle "already banned" gracefully
    if (
      msg.includes("already banned") ||
      msg.includes("ALREADY_BANNED") ||
      msg.includes("USER_ALREADY_BANNED") ||
      msg.includes("BAN_USER_ALREADY_BANNED")
    ) {
      console.log(`[bans] u/${username} is already banned from r/${subredditName}.`);
      return {
        success: false,
        message: `u/${username} is already banned from r/${subredditName}.`,
      };
    }

    // Handle "target is a moderator" gracefully
    if (
      msg.includes("CANT_RESTRICT_MODERATOR") ||
      msg.includes("that user is a moderator")
    ) {
      console.log(`[bans] u/${username} is a moderator of r/${subredditName} — cannot ban.`);
      return {
        success: false,
        message: `u/${username} is a moderator and cannot be banned.`,
      };
    }

    console.error(`[bans] Failed to ban u/${username}:`, msg);
    return { success: false, message: `Ban failed: ${msg}` };
  }

  // ── 3. Mod log ──────────────────────────────────────────────────────
  try {
    const ctx = context as unknown as { modLog: { add: (entry: Record<string, string>) => Promise<void> } };
    await ctx.modLog.add({
      action: "banuser",
      target: commentId,
      details: "botditor",
      description: truncateModLog(
        `u/${user.username} banned u/${username} ` +
        `(${duration === 0 ? "permanent" : `${duration}d`}) — ${reason}`
      ),
    });
  } catch (err) {
    // Non-fatal: ban succeeded, log failure is recorded only
    console.error(
      `[bans] Failed to write mod log for ban of u/${username}:`,
      err instanceof Error ? err.message : err
    );
  }

  // ── 4. Analytics persistence (kvStore for Story 14) ─────────────────
  try {
    const now = Date.now();
    const recordKey = REDIS_KEYS.banRecord(username, now);
    const payload = JSON.stringify({
      username,
      subredditName,
      reason,
      duration,
      moderator: user.username,
      commentId,
      timestamp: new Date(now).toISOString(),
    });
    await context.redis.set(recordKey, payload);

    // Bump subreddit ban counter
    const countKey = REDIS_KEYS.banCount(subredditName);
    await context.redis.incrBy(countKey, 1);
  } catch (err) {
    // Non-fatal: ban succeeded
    console.error(
      `[bans] Failed to persist analytics for ban of u/${username}:`,
      err instanceof Error ? err.message : err
    );
  }

  const durationLabel = duration === 0 ? "permanently" : `for ${duration} day(s)`;
  return {
    success: true,
    message: `u/${username} has been banned from r/${subredditName} ${durationLabel}.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reddit mod-log description has a 100-char limit. */
function truncateModLog(text: string, maxLen = 100): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
