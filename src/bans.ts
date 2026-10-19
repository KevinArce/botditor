/**
 * User Bans – Story 10
 *
 * Handles the "Ban User" menu action available on comments (moderator-only).
 * The flow mirrors the permission-check pattern in `nuke.ts`:
 *   1. Validate the acting moderator has `all` or `access` permissions.
 *   2. Execute the ban via `context.reddit.banUser()`. The ban runs as the
 *      app account, so the acting moderator is recorded in the mod-facing
 *      `note` (shown in the mod log) — this replaced the `context.modLog`
 *      client that Devvit removed (OPS-3).
 *   3. Persist a ban record in Redis for Story 14 analytics.
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
  /** Ban reason — mod-facing, shown in the Banned Users list. */
  reason: string;
  /** Optional message to the banned user ("Note from the moderators"). */
  message?: string;
  /** Ban duration in days. 0 = permanent, otherwise 1–999. */
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
 * Execute a user ban with permission checking, an audit note, and analytics.
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
  const { username, subredditName, reason, message, duration, note, commentId } = props;

  // Reddit accepts 0 (permanent) or 1–999 days
  if (!Number.isInteger(duration) || duration < 0 || duration > MAX_BAN_DAYS) {
    return {
      success: false,
      message: `Duration must be 0 (permanent) or 1–${MAX_BAN_DAYS} days.`,
    };
  }

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
    const modNote = note
      ? `Banned by u/${user.username} via botditor: ${note}`
      : `Banned by u/${user.username} via botditor`;
    await context.reddit.banUser({
      subredditName,
      username,
      reason: reason ? truncate(reason, BAN_REASON_MAX_LEN) : undefined,
      message: message || undefined,
      duration: duration > 0 ? duration : undefined, // undefined = permanent
      note: truncate(modNote, BAN_NOTE_MAX_LEN),
      context: commentId || undefined,
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

  // ── 3. Analytics persistence (kvStore for Story 14) ─────────────────
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

/** Reddit's ban duration limit, in days. */
const MAX_BAN_DAYS = 999;

/** Reddit's `/api/friend` limits: `ban_reason` 100 chars, `note` 300. */
const BAN_REASON_MAX_LEN = 100;
const BAN_NOTE_MAX_LEN = 300;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
