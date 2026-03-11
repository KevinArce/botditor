/**
 * Comment storage service – persists IngestedComment records in Redis.
 *
 * Each comment is stored as a JSON blob keyed by `comment:<commentId>`.
 * A per-subreddit sorted set (`comments:index:<subreddit>`) keeps an
 * ordered index by ingestion timestamp so comments can be listed/paged.
 *
 * Duplicate detection: if a key already exists for the comment ID the
 * write is skipped and the function returns `"duplicate"`.
 */
import type { RedisClient } from "@devvit/public-api";
import type { IngestedComment, CommentStatus } from "./types.js";
import { REDIS_KEYS } from "./types.js";

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

  // Duplicate detection – cheap existence check before writing
  const exists = await redis.get(key);
  if (exists) {
    console.log(
      `[storage] Duplicate comment ${comment.commentId} — skipping write`
    );
    return "duplicate";
  }

  const payload = JSON.stringify(comment);
  await redis.set(key, payload);

  // Add to the per-subreddit sorted set (score = ingestion epoch ms)
  const indexKey = REDIS_KEYS.commentIndex(comment.subredditName);
  const score = new Date(comment.ingestedAt).getTime();
  await redis.zAdd(indexKey, { member: comment.commentId, score });

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
  updates: Partial<Pick<IngestedComment, "status" | "analysis" | "errorMessage" | "skipReason">>,
  redis: RedisClient
): Promise<boolean> {
  const key = REDIS_KEYS.comment(commentId);
  const raw = await redis.get(key);
  if (!raw) return false;

  const record = JSON.parse(raw) as IngestedComment;
  Object.assign(record, updates);
  await redis.set(key, JSON.stringify(record));
  return true;
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
