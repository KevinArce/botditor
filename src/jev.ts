/**
 * TypeSafe Jev Analysis Provider
 *
 * Calls the TypeSafe Jev System 1 decision engine to probabilistically score
 * Reddit comments for toxicity, spam, and bot-likelihood in sub-second time.
 *
 * Design decisions:
 *   • Every code path returns a valid AnalysisResult — never throws.
 *   • Fast timeout (JEV_TIMEOUT_MS = 3s) ensures event loop responsiveness.
 *   • On any error (missing key, network, parse, timeout), safe fallback is returned
 *     and logged; no exception escapes.
 *   • Results are cached in Redis for 1 hour to prevent redundant calls.
 *   • Supports flexible decision payload format from TypeSafe Jev (both nested and flat).
 */
import type { TriggerContext } from "@devvit/public-api";
import type { IngestedComment, AnalysisResult, Sentiment } from "./types.js";
import {
  ANALYSIS_FALLBACK,
  REDIS_KEYS,
  SETTINGS,
  ANALYSIS_CACHE_TTL_MS,
  DEFAULT_JEV_API_HOST,
  DEFAULT_JEV_MODEL,
  JEV_TIMEOUT_MS,
} from "./types.js";
import { isEmojiOnly, withTimeout, validateScore, validateSentiment } from "./ai.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Analyze a comment via the TypeSafe Jev API.
 *
 * Always returns a valid `AnalysisResult`. On any error the safe fallback is
 * returned and the issue is logged — no exception escapes.
 */
export async function analyzeCommentWithJev(
  record: IngestedComment,
  context: TriggerContext
): Promise<AnalysisResult> {
  try {
    return await analyzeCommentWithJevInner(record, context);
  } catch (err) {
    console.error(
      `[jev] Unexpected error analysing comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "unexpected jev error" };
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function analyzeCommentWithJevInner(
  record: IngestedComment,
  context: TriggerContext
): Promise<AnalysisResult> {
  const { redis, settings } = context;

  // ── 1. Fast path: emoji-only / empty body ───────────────────────
  if (isEmojiOnly(record.body)) {
    console.log(
      `[jev] Comment ${record.commentId} is emoji-only — using heuristic scores`
    );
    return {
      toxicityScore: 0,
      spamScore: 0.1,
      botLikelihood: 0.2,
      sentiment: "neutral",
      reason: "emoji-only comment",
    };
  }

  // ── 2. Cache check ──────────────────────────────────────────────
  const cacheKey = REDIS_KEYS.analysisCache(record.commentId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[jev] Cache hit for comment ${record.commentId}`);
      return JSON.parse(cached) as AnalysisResult;
    }
  } catch {
    // Cache miss or parse error — proceed with fresh call
  }

  // ── 3. Read settings ────────────────────────────────────────────
  const apiKey = await settings.get<string>(SETTINGS.JEV_API_KEY);
  if (!apiKey) {
    console.warn(
      "[jev] No TypeSafe Jev API key configured — returning safe fallback"
    );
    return { ...ANALYSIS_FALLBACK, reason: "no jev api key configured" };
  }

  const host =
    (await settings.get<string>(SETTINGS.JEV_API_HOST))?.trim() ||
    DEFAULT_JEV_API_HOST;
  const model =
    (await settings.get<string>(SETTINGS.JEV_MODEL))?.trim() ||
    DEFAULT_JEV_MODEL;

  // ── 4. Build request & call API ─────────────────────────────────
  const url = `https://${host}/v1/decide`;
  const requestBody = buildJevRequestBody(record, model);

  const startTime = Date.now();
  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "x-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
      }),
      JEV_TIMEOUT_MS
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[jev] Request timed out or failed after ${duration} ms for comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "timeout or network error" };
  }

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      /* ignore */
    }
    console.error(
      `[jev] API returned status ${response.status} for comment ${record.commentId}`,
      errorBody ? `— body: ${errorBody.slice(0, 500)}` : ""
    );
    return { ...ANALYSIS_FALLBACK, reason: `jev api error ${response.status}` };
  }

  // ── 5. Parse response ───────────────────────────────────────────
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (err) {
    console.error(
      `[jev] Failed to read response body for comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "response read error" };
  }

  const result = parseJevResponse(responseText);

  // ── 6. Cache result ─────────────────────────────────────────────
  if (result.reason !== "parse error") {
    try {
      await redis.set(cacheKey, JSON.stringify(result));
      await redis.expire(cacheKey, Math.floor(ANALYSIS_CACHE_TTL_MS / 1000));
    } catch (err) {
      console.warn(
        `[jev] Failed to cache result for comment ${record.commentId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[jev] Decision complete in ${durationMs}ms for comment ${record.commentId}: ` +
    `toxicity=${result.toxicityScore}, spam=${result.spamScore}, ` +
    `bot=${result.botLikelihood}, sentiment=${result.sentiment}, reason="${result.reason}"`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Request construction & response parsing
// ---------------------------------------------------------------------------

/**
 * Construct the state-based decision request for TypeSafe Jev.
 */
export function buildJevRequestBody(
  record: IngestedComment,
  model: string
): Record<string, unknown> {
  return {
    model,
    target: "reddit_comment",
    state: {
      commentId: record.commentId,
      body: record.body,
      subreddit: record.subredditName,
      author: record.authorName,
    },
    decision_schema: {
      toxicityScore: "probability",
      spamScore: "probability",
      botLikelihood: "probability",
      sentiment: ["positive", "neutral", "negative"],
      reason: "string",
    },
  };
}

/**
 * Parse and validate the typed response from TypeSafe Jev.
 * Supports both direct top-level fields and nested `decision` envelope.
 */
export function parseJevResponse(rawText: string): AnalysisResult {
  try {
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    const data =
      raw && typeof raw.decision === "object" && raw.decision !== null
        ? (raw.decision as Record<string, unknown>)
        : raw;

    if (!data || typeof data !== "object") {
      return { ...ANALYSIS_FALLBACK, reason: "parse error" };
    }

    const toxicityScore = validateScore(data.toxicityScore);
    const spamScore = validateScore(data.spamScore);
    const botLikelihood = validateScore(data.botLikelihood);
    const sentiment = validateSentiment(data.sentiment);
    const reason =
      typeof data.reason === "string" && data.reason.trim().length > 0
        ? data.reason.slice(0, 500)
        : "jev decision";

    if (
      toxicityScore === null ||
      spamScore === null ||
      botLikelihood === null ||
      sentiment === null
    ) {
      return { ...ANALYSIS_FALLBACK, reason: "parse error" };
    }

    return {
      toxicityScore,
      spamScore,
      botLikelihood,
      sentiment,
      reason,
    };
  } catch {
    return { ...ANALYSIS_FALLBACK, reason: "parse error" };
  }
}
