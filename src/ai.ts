/**
 * AI Analysis Pipeline – Story 02
 *
 * Calls the Gemini API to score comments for toxicity, spam, and bot-likelihood.
 *
 * Design decisions:
 *   • Every code path returns a valid AnalysisResult — never throws.
 *   • On any error (missing key, network, parse, timeout) the ANALYSIS_FALLBACK
 *     is returned and a concise message is logged. This means downstream
 *     consumers never see an undefined analysis and no moderation action is
 *     triggered by fallback scores (all zeros).
 *   • Results are cached in Redis by comment ID for 1 hour to avoid redundant
 *     API calls on event re-deliveries.
 */
import type { TriggerContext } from "@devvit/public-api";
import type { IngestedComment, AnalysisResult, Sentiment } from "./types.js";
import {
  ANALYSIS_FALLBACK,
  REDIS_KEYS,
  SETTINGS,
  MAX_PROMPT_BODY_LENGTH,
  ANALYSIS_CACHE_TTL_MS,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Analyze a comment via the Gemini API.
 *
 * Always returns a valid `AnalysisResult`. On any error the safe fallback is
 * returned and the issue is logged — no exception escapes.
 */
export async function analyzeComment(
  record: IngestedComment,
  context: TriggerContext
): Promise<AnalysisResult> {
  try {
    return await analyzeCommentInner(record, context);
  } catch (err) {
    console.error(
      `[ai] Unexpected error analysing comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "unexpected error" };
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function analyzeCommentInner(
  record: IngestedComment,
  context: TriggerContext
): Promise<AnalysisResult> {
  const { redis, settings } = context;

  // ── 1. Edge case: emoji-only / effectively-empty body ───────────
  if (isEmojiOnly(record.body)) {
    console.log(
      `[ai] Comment ${record.commentId} is emoji-only — using heuristic scores`
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
      console.log(`[ai] Cache hit for comment ${record.commentId}`);
      return JSON.parse(cached) as AnalysisResult;
    }
  } catch {
    // Cache miss or parse error — continue with fresh API call
  }

  // ── 3. Read settings ────────────────────────────────────────────
  const apiKey = await settings.get<string>(SETTINGS.GEMINI_API_KEY);
  if (!apiKey) {
    console.warn(
      "[ai] No Gemini API key configured — returning safe fallback"
    );
    return { ...ANALYSIS_FALLBACK, reason: "no api key configured" };
  }

  const model =
    (await settings.get<string>(SETTINGS.GEMINI_MODEL)) || "gemini-2.5-flash";

  // ── 4. Build prompt & call API ──────────────────────────────────
  const prompt = buildPrompt(record.body);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`[ai:debug] Model: ${model}`);
  console.log(`[ai:debug] Prompt:\n${prompt}`);

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  let response: Response;
  try {
    // Devvit makes the global fetch available when `http: true` is configured.
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    console.error(
      `[ai] Fetch failed for comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "fetch error" };
  }

  if (!response.ok) {
    let errorBody = "";
    try { errorBody = await response.text(); } catch { /* ignore */ }
    console.error(
      `[ai] Gemini API returned ${response.status} for comment ${record.commentId}`,
      errorBody ? `— body: ${errorBody.slice(0, 500)}` : ""
    );
    return { ...ANALYSIS_FALLBACK, reason: `api error ${response.status}` };
  }

  // ── 5. Parse response ───────────────────────────────────────────
  let responseBody: string;
  try {
    responseBody = await response.text();
  } catch (err) {
    console.error(
      `[ai] Failed to read response body for comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "response read error" };
  }

  const rawText = extractGeneratedText(responseBody);
  console.log(`[ai:debug] Raw response body: ${responseBody.slice(0, 1000)}`);
  console.log(`[ai:debug] Extracted text: ${rawText?.slice(0, 500) ?? "(null)"}`);
  if (!rawText) {
    console.error(
      `[ai] No text content in Gemini response for comment ${record.commentId}`
    );
    return { ...ANALYSIS_FALLBACK, reason: "empty response" };
  }

  const result = parseAnalysisResponse(rawText);

  // ── 6. Cache result ─────────────────────────────────────────────
  try {
    await redis.set(cacheKey, JSON.stringify(result));
    // Set expiration — Devvit Redis supports `expire` for TTL
    await redis.expire(cacheKey, Math.floor(ANALYSIS_CACHE_TTL_MS / 1000));
  } catch (err) {
    // Non-fatal: we got the result, caching just failed
    console.warn(
      `[ai] Failed to cache result for comment ${record.commentId}:`,
      err instanceof Error ? err.message : err
    );
  }

  console.log(
    `[ai] Analysis complete for comment ${record.commentId}: ` +
    `toxicity=${result.toxicityScore}, spam=${result.spamScore}, ` +
    `bot=${result.botLikelihood}, sentiment=${result.sentiment}, ` +
    `reason="${result.reason}"`
  );
  return result;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the Gemini prompt for a comment body.
 * Truncates to MAX_PROMPT_BODY_LENGTH characters per the story spec.
 */
export function buildPrompt(body: string): string {
  let truncatedBody = body;
  if (body.length > MAX_PROMPT_BODY_LENGTH) {
    truncatedBody = body.slice(0, MAX_PROMPT_BODY_LENGTH) + " [truncated]";
  }

  return `You are a Reddit moderation assistant. Analyze the following comment and respond ONLY with valid JSON.

Comment: "${truncatedBody}"

Return JSON with these exact fields:
{
  "toxicityScore": <float 0-1>,
  "spamScore": <float 0-1>,
  "botLikelihood": <float 0-1>,
  "sentiment": "positive" | "neutral" | "negative",
  "reason": "<one sentence explanation>"
}`;
}

// ---------------------------------------------------------------------------
// Response parsing & validation
// ---------------------------------------------------------------------------

/**
 * Extract the generated text from a Gemini REST API response body.
 * Returns null if the structure is unexpected.
 */
export function extractGeneratedText(responseBody: string): string | null {
  try {
    const json = JSON.parse(responseBody);
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Parse and validate a raw JSON string from Gemini into an AnalysisResult.
 * Returns the safe fallback with reason "parse error" if the response is
 * malformed or missing required fields.
 */
export function parseAnalysisResponse(raw: string): AnalysisResult {
  try {
    // The model may wrap its JSON in markdown code fences — strip them
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    const toxicityScore = validateScore(parsed.toxicityScore);
    const spamScore = validateScore(parsed.spamScore);
    const botLikelihood = validateScore(parsed.botLikelihood);
    const sentiment = validateSentiment(parsed.sentiment);
    const reason =
      typeof parsed.reason === "string" && parsed.reason.length > 0
        ? parsed.reason.slice(0, 500)
        : "no reason provided";

    if (
      toxicityScore === null ||
      spamScore === null ||
      botLikelihood === null ||
      sentiment === null
    ) {
      return { ...ANALYSIS_FALLBACK, reason: "parse error" };
    }

    return { toxicityScore, spamScore, botLikelihood, sentiment, reason };
  } catch {
    return { ...ANALYSIS_FALLBACK, reason: "parse error" };
  }
}

/**
 * Validate a score is a number in 0–1 range. Returns null on failure.
 */
function validateScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

/**
 * Validate a sentiment string. Returns null on failure.
 */
function validateSentiment(value: unknown): Sentiment | null {
  if (value === "positive" || value === "neutral" || value === "negative") {
    return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect comments that are emoji-only (no alphanumeric text).
 * Includes whitespace-only and effectively-empty strings.
 */
export function isEmojiOnly(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  // Remove all emoji, whitespace, and common punctuation — if nothing remains,
  // the comment is "emoji-only".
  const stripped = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\u200d\ufe0f]/gu, "");
  return stripped.length === 0;
}
