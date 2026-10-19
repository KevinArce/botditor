/**
 * Comment storage service – persists IngestedComment records in Redis.
 *
 * Each comment is stored as a JSON blob keyed by `comment:<commentId>`.
 * A per-subreddit sorted set (`comments:index:<subreddit>`) keeps an
 * ordered index by ingestion timestamp so comments can be listed/paged.
 *
 * Duplicate detection: the record is written with `SET NX`, so when two
 * deliveries of the same event race, exactly one wins and the other gets
 * `"duplicate"` (COR-5).
 *
 * Retention (COR-4): records expire `COMMENT_TTL_S` (30 days) after
 * ingestion, and index entries older than that are trimmed on each save,
 * keeping storage bounded against Devvit's 5 GB per-installation quota.
 */
import type { RedisClient } from "@devvit/public-api";
import type { IngestedComment } from "./types.js";
import { REDIS_KEYS, COMMENT_TTL_S } from "./types.js";

export type SaveResult = "saved" | "duplicate";

/**
 * Persist a new ingested comment. Returns `"duplicate"` if the comment ID
 * already exists in Redis (idempotent).
 */
export async function saveComment(
  comment: IngestedComment,
  redis: RedisClient
): Promise<SaveResult> {
  const key = REDIS_KEYS.comment(comment.commentId);

  // Atomic duplicate detection — SET NX returns "" when the key exists
  const written = await redis.set(key, JSON.stringify(comment), {
    nx: true,
    expiration: expiresAt(comment),
  });
  if (!written) {
    console.log(
      `[storage] Duplicate comment ${comment.commentId} — skipping write`
    );
    return "duplicate";
  }

  // Add to the per-subreddit sorted set (score = ingestion epoch ms)
  const indexKey = REDIS_KEYS.commentIndex(comment.subredditName);
  const score = new Date(comment.ingestedAt).getTime();
  await redis.zAdd(indexKey, { member: comment.commentId, score });

  // Trim index entries whose records have expired. Non-fatal: the record
  // is already saved, and the next save trims again.
  try {
    await redis.zRemRangeByScore(indexKey, 0, Date.now() - COMMENT_TTL_S * 1000);
  } catch (err) {
    console.warn(
      `[storage] Failed to trim comment index for r/${comment.subredditName}:`,
      err instanceof Error ? err.message : err
    );
  }

  // Bump subreddit counter
  const countKey = REDIS_KEYS.commentCount(comment.subredditName);
  await redis.incrBy(countKey, 1);

  return "saved";
}

/**
 * Retrieve a stored comment by its Reddit ID.
 */
export async function getComment(
  commentId: string,
  redis: RedisClient
): Promise<IngestedComment | null> {
  const raw = await redis.get(REDIS_KEYS.comment(commentId));
  if (!raw) return null;
  return JSON.parse(raw) as IngestedComment;
}

/**
 * Update the status (and optionally analysis or error) of an existing comment.
 */
export async function updateCommentStatus(
  commentId: string,
  updates: Partial<Pick<IngestedComment, "status" | "analysis" | "errorMessage" | "skipReason" | "moderationAction">>,
  redis: RedisClient
): Promise<boolean> {
  const key = REDIS_KEYS.comment(commentId);
  const raw = await redis.get(key);
  if (!raw) return false;

  const record = JSON.parse(raw) as IngestedComment;
  Object.assign(record, updates);
  // A plain SET clears the TTL, so re-apply the original expiry
  await redis.set(key, JSON.stringify(record), { expiration: expiresAt(record) });
  return true;
}

/** When a record expires: `COMMENT_TTL_S` after it was ingested. */
function expiresAt(comment: IngestedComment): Date {
  const ingested = new Date(comment.ingestedAt).getTime();
  const base = Number.isFinite(ingested) ? ingested : Date.now();
  return new Date(base + COMMENT_TTL_S * 1000);
}

/**
 * List comment IDs for a subreddit ordered by ingestion time (newest first).
 *
 * @param limit  Maximum number of IDs to return (default 50).
 * @param offset Zero-based offset for pagination.
 */
export async function listCommentIds(
  subredditName: string,
  redis: RedisClient,
  limit = 50,
  offset = 0
): Promise<string[]> {
  const indexKey = REDIS_KEYS.commentIndex(subredditName);
  const results = await redis.zRange(indexKey, offset, offset + limit - 1, {
    reverse: true,
    by: "rank",
  });
  return results.map((r) => r.member);
}

/**
 * Get the total count of ingested comments for a subreddit.
 */
export async function getCommentCount(
  subredditName: string,
  redis: RedisClient
): Promise<number> {
  const raw = await redis.get(REDIS_KEYS.commentCount(subredditName));
  return raw ? parseInt(raw, 10) : 0;
}
