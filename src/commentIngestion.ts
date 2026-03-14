/**
 * Comment Ingestion Handler – Story 01
 *
 * Receives CommentSubmit events, validates the payload, checks guards
 * (enabled toggle, allowlist, self-comment, deletion), persists the record,
 * and dispatches to the AI analysis pipeline (Story 02).
 *
 * Design decisions:
 *   • Each comment is processed independently – one slow/failed AI call never
 *     blocks another comment (acceptance criterion: high velocity resilience).
 *   • Processing failures are caught, logged, and the comment is marked
 *     "error" in storage – they never throw out of the handler.
 *   • Duplicate comments (re-delivered events) are detected via Redis and
 *     silently skipped (idempotent).
 */
import type { CommentSubmit } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";
import { isUserAllowlisted } from "./allowlist.js";
import { saveComment, updateCommentStatus } from "./commentStorage.js";
import { analyzeComment } from "./ai.js";
import { enforceToxicity } from "./moderation.js";
import type { IngestedComment, SkipReason } from "./types.js";
import { SETTINGS, MAX_BODY_LENGTH } from "./types.js";
import type { RedisClient } from "@devvit/public-api";

// ---------------------------------------------------------------------------
// Public handler wired to Devvit.addTrigger in main.ts
// ---------------------------------------------------------------------------

export async function handleCommentSubmit(
  event: CommentSubmit,
  context: TriggerContext
): Promise<void> {
  const { redis, settings } = context;

  // ── 1. Check enabled toggle ──────────────────────────────────────
  const enabled = await settings.get<boolean>(SETTINGS.ENABLED);
  if (enabled === false) {
    console.log("[ingestion] Botditor is disabled for this subreddit — no-op");
    return;
  }

  // ── 2. Extract event payload ─────────────────────────────────────
  const comment = event.comment;
  const subreddit = event.subreddit;

  if (!comment || !comment.id) {
    console.warn("[ingestion] CommentSubmit event missing comment — skipping");
    return;
  }

  const commentId = comment.id;
  const authorName = comment.author ?? "";
  const body = comment.body ?? "";
  const postId = comment.postId ?? "";
  const subredditName = subreddit?.name ?? "";
  const createdAt = comment.createdAt
    ? new Date(comment.createdAt).toISOString()
    : new Date().toISOString();

  console.log(
    `[ingestion] Processing comment ${commentId} by u/${authorName} in r/${subredditName}`
  );

  // ── 3. Guard: deleted / missing body ─────────────────────────────
  if (!body || body.trim().length === 0) {
    console.log(
      `[ingestion] Comment ${commentId} has no body (possibly deleted) — skipping`
    );
    await persistSkipped(
      commentId,
      postId,
      subredditName,
      authorName,
      body,
      createdAt,
      body ? "missing_body" : "deleted",
      redis
    );
    return;
  }

  // ── 4. Guard: self-comment (bot's own username) ──────────────────
  let appUsername: string | undefined;
  try {
    const appUser = await context.reddit.getAppUser();
    appUsername = appUser?.username;
  } catch {
    // If we can't determine the app user, continue — allowlist check
    // will not match and analysis proceeds normally.
  }

  if (appUsername && authorName.toLowerCase() === appUsername.toLowerCase()) {
    console.log(
      `[ingestion] Comment ${commentId} is from the app itself — skipping`
    );
    await persistSkipped(
      commentId,
      postId,
      subredditName,
      authorName,
      body,
      createdAt,
      "self_comment",
      redis
    );
    return;
  }

  // ── 5. Guard: allowlist ──────────────────────────────────────────
  const allowlisted = await isUserAllowlisted(authorName, {
    redis,
    settings,
    appUsername,
  });

  if (allowlisted) {
    console.log(
      `[ingestion] u/${authorName} is allowlisted — skipping comment ${commentId}`
    );
    await persistSkipped(
      commentId,
      postId,
      subredditName,
      authorName,
      body,
      createdAt,
      "allowlisted",
      redis
    );
    return;
  }

  // ── 6. Build ingested comment record ─────────────────────────────
  const record: IngestedComment = {
    commentId,
    postId,
    subredditName,
    authorName,
    body: sanitizeBody(body),
    createdAt,
    ingestedAt: new Date().toISOString(),
    status: "pending",
  };

  // ── 7. Persist (with duplicate detection) ────────────────────────
  const saveResult = await saveComment(record, redis);
  if (saveResult === "duplicate") {
    console.log(`[ingestion] Duplicate comment ${commentId} — no-op`);
    return;
  }

  // ── 8. Dispatch to AI analysis pipeline (Story 02) ───────────────
  try {
    await updateCommentStatus(commentId, { status: "processing" }, redis);
    const analysis = await analyzeComment(record, context);
    await updateCommentStatus(
      commentId,
      { status: "analyzed", analysis },
      redis
    );

    // ── 9. Enforce toxicity thresholds (Story 03) ──────────────────
    const action = await enforceToxicity(record, analysis, context);
    await updateCommentStatus(
      commentId,
      { moderationAction: action },
      redis
    );

    console.log(
      `[ingestion] Comment ${commentId} analyzed (toxicity=${analysis.toxicityScore}) → action=${action}`
    );
  } catch (err) {
    console.error(
      `[ingestion] Failed to dispatch analysis for comment ${commentId}:`,
      err
    );
    await updateCommentStatus(
      commentId,
      {
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      redis
    ).catch((e) =>
      console.error("[ingestion] Also failed to update status:", e)
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize comment body before storage: trim and cap length.
 */
function sanitizeBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > MAX_BODY_LENGTH
    ? trimmed.slice(0, MAX_BODY_LENGTH)
    : trimmed;
}

/**
 * Persist a comment record with status = "skipped" and the given reason.
 * Failures are logged but never thrown — we don't want a storage hiccup to
 * prevent the trigger from completing.
 */
async function persistSkipped(
  commentId: string,
  postId: string,
  subredditName: string,
  authorName: string,
  body: string,
  createdAt: string,
  reason: SkipReason,
  redis: RedisClient
): Promise<void> {
  try {
    const record: IngestedComment = {
      commentId,
      postId,
      subredditName,
      authorName,
      body: sanitizeBody(body || ""),
      createdAt,
      ingestedAt: new Date().toISOString(),
      status: "skipped",
      skipReason: reason,
    };
    await saveComment(record, redis);
  } catch (err) {
    console.error(
      `[ingestion] Failed to persist skipped record for ${commentId}:`,
      err
    );
  }
}
