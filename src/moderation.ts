/**
 * Toxicity Enforcement – Story 03
 *
 * After the AI analysis pipeline scores a comment, this module compares the
 * toxicityScore against configurable thresholds and takes action:
 *
 *   • ≥ removeThreshold → auto-remove + mod log entry
 *   • ≥ flagThreshold   → report for manual review
 *   • below both        → no action (scores stored for analytics)
 *
 * A dry-run mode lets moderators observe what would happen without executing
 * any real actions. On any error the function returns "none" — fail safe.
 */
import type { TriggerContext } from "@devvit/public-api";
import type { AnalysisResult, ModerationAction, IngestedComment, SpamResult } from "./types.js";
import { SETTINGS } from "./types.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate the toxicity score and take the appropriate moderation action.
 *
 * Always returns a valid `ModerationAction`. On any error returns `"none"` and
 * logs the issue — no exception escapes.
 */
export async function enforceToxicity(
  record: IngestedComment,
  analysis: AnalysisResult,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    return await enforceToxicityInner(record, analysis, context);
  } catch (err) {
    console.error(
      `[moderation] Unexpected error enforcing toxicity for ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return "none";
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function enforceToxicityInner(
  record: IngestedComment,
  analysis: AnalysisResult,
  context: TriggerContext
): Promise<ModerationAction> {
  const { settings } = context;

  // ── 1. Read thresholds and dry-run flag ──────────────────────────
  const removeThreshold =
    (await settings.get<number>(SETTINGS.TOXICITY_REMOVE_THRESHOLD)) ?? 0.85;
  const flagThreshold =
    (await settings.get<number>(SETTINGS.TOXICITY_FLAG_THRESHOLD)) ?? 0.60;
  const dryRun =
    (await settings.get<boolean>(SETTINGS.DRY_RUN)) ?? false;

  const { toxicityScore, reason } = analysis;

  // ── 2. Evaluate thresholds ──────────────────────────────────────
  if (toxicityScore >= removeThreshold) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would remove comment ${record.commentId} ` +
        `(toxicity=${toxicityScore}, threshold=${removeThreshold}, reason="${reason}")`
      );
      return "dry_run_remove";
    }

    // Auto-remove
    return await removeComment(record, reason, context);
  }

  if (toxicityScore >= flagThreshold) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would flag comment ${record.commentId} ` +
        `(toxicity=${toxicityScore}, threshold=${flagThreshold}, reason="${reason}")`
      );
      return "dry_run_flag";
    }

    // Flag for manual review
    return await flagComment(record, reason, context);
  }

  // Below both thresholds — no action
  console.log(
    `[moderation] No action for comment ${record.commentId} ` +
    `(toxicity=${toxicityScore}, removeAt=${removeThreshold}, flagAt=${flagThreshold})`
  );
  return "none";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Remove a comment and log the action to the mod log.
 */
async function removeComment(
  record: IngestedComment,
  reason: string,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    const comment = await context.reddit.getCommentById(record.commentId);
    await comment.remove();
    console.log(
      `[moderation] Removed comment ${record.commentId} by u/${record.authorName} — "${reason}"`
    );
  } catch (err) {
    // Comment may have been deleted by the author or already removed
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("not found") || msg.includes("NOT_FOUND")) {
      console.log(
        `[moderation] Comment ${record.commentId} already gone (404) — skipping removal`
      );
    } else {
      console.error(
        `[moderation] Failed to remove comment ${record.commentId}:`,
        msg
      );
    }
    return "none";
  }

  return "removed";
}

/**
 * Report a comment for manual moderator review.
 */
async function flagComment(
  record: IngestedComment,
  reason: string,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    const comment = await context.reddit.getCommentById(record.commentId);
    await context.reddit.report(comment, { reason: `Botditor: ${reason}` });
    console.log(
      `[moderation] Flagged comment ${record.commentId} by u/${record.authorName} — "${reason}"`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("not found") || msg.includes("NOT_FOUND")) {
      console.log(
        `[moderation] Comment ${record.commentId} already gone (404) — skipping flag`
      );
    } else {
      console.error(
        `[moderation] Failed to flag comment ${record.commentId}:`,
        msg
      );
    }
    return "none";
  }

  return "flagged";
}

// ---------------------------------------------------------------------------
// Spam enforcement – Story 04
// ---------------------------------------------------------------------------

/**
 * Evaluate the spam score and take the appropriate moderation action.
 *
 * Respects the `spamMode` setting:
 *   • "flag" (default): always report, never remove.
 *   • "remove": remove when score ≥ removeThreshold, flag when ≥ flagThreshold.
 *
 * Blocked-domain hits (`blockedDomain = true`) are always removed regardless
 * of mode — this is the instant-removal escape hatch from the story spec.
 *
 * Always returns a valid `ModerationAction`. On any error returns `"none"`.
 */
export async function enforceSpam(
  record: IngestedComment,
  spamResult: SpamResult,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    return await enforceSpamInner(record, spamResult, context);
  } catch (err) {
    console.error(
      `[moderation] Unexpected error enforcing spam for ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return "none";
  }
}

async function enforceSpamInner(
  record: IngestedComment,
  spamResult: SpamResult,
  context: TriggerContext
): Promise<ModerationAction> {
  const { settings } = context;

  const removeThreshold =
    (await settings.get<number>(SETTINGS.SPAM_REMOVE_THRESHOLD)) ?? 0.80;
  const flagThreshold =
    (await settings.get<number>(SETTINGS.SPAM_FLAG_THRESHOLD)) ?? 0.50;
  const spamMode =
    (await settings.get<string>(SETTINGS.SPAM_MODE)) ?? "flag";
  const dryRun =
    (await settings.get<boolean>(SETTINGS.DRY_RUN)) ?? false;

  const { score, reasons, blockedDomain } = spamResult;
  const reasonStr = reasons.join("; ") || "spam heuristics";

  // ── Blocked domain → always remove ────────────────────────────────
  if (blockedDomain) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would spam-remove comment ${record.commentId} ` +
        `(blocked domain, score=${score}, reason="${reasonStr}")`
      );
      return "dry_run_spam_remove";
    }
    const result = await removeComment(record, `Spam: ${reasonStr}`, context);
    return result === "removed" ? "spam_removed" : "none";
  }

  // ── Remove mode ───────────────────────────────────────────────────
  if (spamMode === "remove" && score >= removeThreshold) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would spam-remove comment ${record.commentId} ` +
        `(score=${score}, threshold=${removeThreshold}, reason="${reasonStr}")`
      );
      return "dry_run_spam_remove";
    }
    const result = await removeComment(record, `Spam: ${reasonStr}`, context);
    return result === "removed" ? "spam_removed" : "none";
  }

  // ── Flag (flag-mode default, or remove-mode below remove threshold) ─
  if (score >= flagThreshold) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would spam-flag comment ${record.commentId} ` +
        `(score=${score}, threshold=${flagThreshold}, reason="${reasonStr}")`
      );
      return "dry_run_spam_flag";
    }
    const result = await flagComment(record, `Spam: ${reasonStr}`, context);
    return result === "flagged" ? "spam_flagged" : "none";
  }

  // Below both thresholds — no action
  console.log(
    `[moderation] No spam action for comment ${record.commentId} ` +
    `(score=${score}, flagAt=${flagThreshold}, removeAt=${removeThreshold})`
  );
  return "none";
}
