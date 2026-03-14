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
import type { AnalysisResult, ModerationAction, IngestedComment } from "./types.js";
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
