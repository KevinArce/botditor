/**
 * Moderation Enforcement – Stories 03 / 04 / 06
 *
 * After the AI analysis pipeline scores a comment, this module compares
 * scores against the pre-validated `ModerationRules` snapshot and takes
 * the appropriate action.
 *
 * Story 06 refactor: thresholds and dry-run flag are now received via a
 * `ModerationRules` object loaded centrally by `rules.ts`, instead of
 * being read inline from settings. This eliminates duplicate reads and
 * guarantees both enforceToxicity and enforceSpam see the same config.
 *
 * Fail-safe: on any error the function returns "none" — no exception
 * escapes.
 */
import type { TriggerContext } from "@devvit/public-api";
import type {
  AnalysisResult,
  ModerationAction,
  IngestedComment,
  SpamResult,
  ModerationRules,
} from "./types.js";

// ---------------------------------------------------------------------------
// Toxicity enforcement (Story 03)
// ---------------------------------------------------------------------------

/**
 * Evaluate the toxicity score and take the appropriate moderation action.
 *
 * Always returns a valid `ModerationAction`. On any error returns `"none"`
 * and logs the issue — no exception escapes.
 */
export async function enforceToxicity(
  record: IngestedComment,
  analysis: AnalysisResult,
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    return await enforceToxicityInner(record, analysis, rules, context);
  } catch (err) {
    console.error(
      `[moderation] Unexpected error enforcing toxicity for ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return "none";
  }
}

// ---------------------------------------------------------------------------

async function enforceToxicityInner(
  record: IngestedComment,
  analysis: AnalysisResult,
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  const { toxicityRemoveThreshold: removeThreshold, toxicityFlagThreshold: flagThreshold, dryRun } = rules;
  const { toxicityScore, reason } = analysis;

  // ── Evaluate thresholds ──────────────────────────────────────────
  if (toxicityScore >= removeThreshold) {
    if (dryRun) {
      console.log(
        `[moderation] DRY RUN: Would remove comment ${record.commentId} ` +
        `(toxicity=${toxicityScore}, threshold=${removeThreshold}, reason="${reason}")`
      );
      return "dry_run_remove";
    }
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
// Spam enforcement (Story 04)
// ---------------------------------------------------------------------------

/**
 * Evaluate the spam score and take the appropriate moderation action.
 *
 * Respects the `spamMode` setting:
 *   • "flag" (default): always report, never remove.
 *   • "remove": remove when score ≥ removeThreshold, flag when ≥ flagThreshold.
 *
 * Blocked-domain hits (`blockedDomain = true`) are always removed
 * regardless of mode (instant-removal escape hatch).
 *
 * Always returns a valid `ModerationAction`. On any error returns `"none"`.
 */
export async function enforceSpam(
  record: IngestedComment,
  spamResult: SpamResult,
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  try {
    return await enforceSpamInner(record, spamResult, rules, context);
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
  rules: ModerationRules,
  context: TriggerContext
): Promise<ModerationAction> {
  const {
    spamRemoveThreshold: removeThreshold,
    spamFlagThreshold: flagThreshold,
    spamMode,
    dryRun,
  } = rules;

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

// ---------------------------------------------------------------------------
// Actions (internal helpers)
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
