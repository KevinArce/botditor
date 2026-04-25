/**
 * Warning Messages – Story 09
 *
 * After the moderation pipeline flags (but does not auto-remove) a comment,
 * this module sends a warning private message to the comment's author.
 *
 * Design:
 *   • Templates are configurable per moderation profile (strict / chill)
 *     and support {{username}}, {{issue}}, and {{rulesLink}} placeholders.
 *   • A 48-hour per-user cooldown is tracked in Redis to avoid spamming
 *     the same user with repeated warnings.
 *   • The function respects dry-run mode — logs but does not send.
 *   • All errors are caught and logged; the function never throws.
 *
 * Dependencies: Story 08 (flag triggers warning), Story 06/15 (profile
 * determines template).
 */
import type { TriggerContext } from "@devvit/public-api";
import type { IngestedComment, ModerationRules, ModerationAction } from "./types.js";
import { REDIS_KEYS, SETTINGS, WARNING_COOLDOWN_TTL_S } from "./types.js";

// ---------------------------------------------------------------------------
// Default templates (must match the defaults registered in settings.ts)
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATE_STRICT =
  "Hello u/{{username}},\n\n" +
  "Your recent comment has been flagged by our moderation system for the following issue: **{{issue}}**.\n\n" +
  "This is a formal notice that continued violations may result in further action. " +
  "Please review our subreddit rules: {{rulesLink}}\n\n" +
  "— The Moderation Team";

const DEFAULT_TEMPLATE_CHILL =
  "Hey u/{{username}} 👋\n\n" +
  "Just a heads-up — your comment was flagged for: **{{issue}}**.\n\n" +
  "No worries, just keep our community guidelines in mind going forward! " +
  "You can check them out here: {{rulesLink}}\n\n" +
  "Thanks for being part of the community! ✌️";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a warning PM to the comment author after their comment is flagged.
 *
 * Always returns a valid `ModerationAction`. On any error returns `"none"`
 * and logs the issue — no exception escapes.
 */
export async function sendWarning(
  record: IngestedComment,
  issue: string,
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    return await sendWarningInner(record, issue, rules, context);
  } catch (err) {
    console.error(
      `[warnings] Unexpected error sending warning for ${record.commentId} (u/${record.authorName}):`,
      err instanceof Error ? err.message : err
    );
    return "none";
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function sendWarningInner(
  record: IngestedComment,
  issue: string,
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  const { authorName, subredditName } = record;

  // ── Dry-run guard ──────────────────────────────────────────────────
  if (rules.dryRun) {
    console.log(
      `[warnings] DRY RUN: Would send warning PM to u/${authorName} ` +
      `(issue="${issue}", profile=${rules.moderationProfile})`
    );
    return "dry_run_warn";
  }

  // ── Cooldown check (48h per user) ─────────────────────────────────
  try {
    const cooldownKey = REDIS_KEYS.warnedUser(authorName);
    const existing = await context.redis.get(cooldownKey);
    if (existing) {
      console.log(
        `[warnings] u/${authorName} already warned within 48h (cooldown active) — skipping`
      );
      return "none";
    }
  } catch (err) {
    // Redis read failure should not block warning — continue
    console.error(
      `[warnings] Cooldown check failed for u/${authorName} — proceeding:`,
      err instanceof Error ? err.message : err
    );
  }

  // ── Resolve actual username ─────────────────────────────────────────
  // The CommentSubmit event may supply an internal user ID (t2_xxx)
  // rather than the display username.  Fetch the comment to get the
  // real username that the PM API requires.
  let recipientUsername = authorName;
  try {
    const comment = await context.reddit.getCommentById(record.commentId);
    if (comment.authorName) {
      recipientUsername = comment.authorName;
    }
  } catch (err) {
    // If we can't resolve the username, continue with what we have
    console.warn(
      `[warnings] Could not resolve username for ${record.commentId} — using "${authorName}":`,
      err instanceof Error ? err.message : err
    );
  }

  // ── Select template ───────────────────────────────────────────────
  const template = await resolveTemplate(rules, context);
  const rulesLink = `https://www.reddit.com/r/${subredditName}/about/rules`;
  const body = interpolateTemplate(template, {
    username: recipientUsername,
    issue,
    rulesLink,
  });

  const subject = `[botditor] Warning — r/${subredditName}`;

  // ── Send PM ───────────────────────────────────────────────────────
  try {
    await context.reddit.sendPrivateMessage({
      to: recipientUsername,
      subject,
      text: body,
    });
    console.log(
      `[warnings] Sent warning PM to u/${recipientUsername} (issue="${issue}", profile=${rules.moderationProfile})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[warnings] Failed to send PM to u/${recipientUsername}:`,
      msg
    );
    return "none";
  }

  // ── Persist cooldown + warning record (48h TTL) ───────────────────
  try {
    const cooldownKey = REDIS_KEYS.warnedUser(authorName);
    const payload = JSON.stringify({
      commentId: record.commentId,
      issue,
      profile: rules.moderationProfile,
      timestamp: new Date().toISOString(),
    });
    await context.redis.set(cooldownKey, payload);
    await context.redis.expire(cooldownKey, WARNING_COOLDOWN_TTL_S);
  } catch (err) {
    // Non-fatal: PM was sent, cooldown write failure is logged only
    console.error(
      `[warnings] Failed to set cooldown key for u/${authorName}:`,
      err instanceof Error ? err.message : err
    );
  }

  return "warned";
}

// ---------------------------------------------------------------------------
// Template resolution & interpolation
// ---------------------------------------------------------------------------

/**
 * Load the warning template from settings based on the active moderation
 * profile. Falls back to the built-in default if the setting is empty.
 */
async function resolveTemplate(
  rules: ModerationRules,
  context: TriggerContext
): Promise<string> {
  const settingKey =
    rules.moderationProfile === "strict"
      ? SETTINGS.WARNING_TEMPLATE_STRICT
      : SETTINGS.WARNING_TEMPLATE_CHILL;

  const defaultTemplate =
    rules.moderationProfile === "strict"
      ? DEFAULT_TEMPLATE_STRICT
      : DEFAULT_TEMPLATE_CHILL;

  try {
    const custom = await context.settings.get<string>(settingKey);
    if (custom && custom.trim().length > 0) {
      return custom;
    }
  } catch {
    // Settings read failure — fall back to built-in default
  }

  return defaultTemplate;
}

/**
 * Replace `{{key}}` placeholders in a template string with the provided
 * values. Unknown placeholders are left as-is (graceful).
 */
export function interpolateTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in values ? values[key] : match;
  });
}
