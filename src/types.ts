/**
 * Shared type definitions for the Botditor app.
 *
 * Architectural note: All types are plain interfaces/enums so they can be
 * serialized to JSON for Redis storage and restored without class hydration.
 */

// ---------------------------------------------------------------------------
// Analysis result (produced by Story 02 – AI Analysis Pipeline)
// ---------------------------------------------------------------------------

/** Sentiment label returned by the AI model. */
export type Sentiment = "positive" | "neutral" | "negative";

/** Structured output from the Gemini analysis pipeline (Story 02). */
export interface AnalysisResult {
  toxicityScore: number; // 0–1
  spamScore: number; // 0–1
  botLikelihood: number; // 0–1
  sentiment: Sentiment;
  reason: string;
}

/** Safe fallback when analysis cannot be performed. */
export const ANALYSIS_FALLBACK: AnalysisResult = {
  toxicityScore: 0,
  spamScore: 0,
  botLikelihood: 0,
  sentiment: "neutral",
  reason: "analysis unavailable",
};

// ---------------------------------------------------------------------------
// Ingested comment record
// ---------------------------------------------------------------------------

/** Processing status of an ingested comment. */
export type CommentStatus =
  | "pending" // Queued for analysis
  | "processing" // Currently being analyzed
  | "analyzed" // Analysis complete
  | "skipped" // Skipped (allowlisted, self-comment, disabled, etc.)
  | "error"; // Processing failed

/** Reason a comment was skipped (not analyzed). */
export type SkipReason =
  | "disabled" // App toggle is off
  | "allowlisted" // Author on moderator allowlist
  | "self_comment" // Comment authored by the app itself
  | "deleted" // Comment was deleted before fetch
  | "missing_body" // Comment had no body text
  | "duplicate"; // Comment already processed

/** Full record stored in Redis for each ingested comment. */
export interface IngestedComment {
  /** Reddit comment ID (e.g. "t1_abc123"). */
  commentId: string;
  /** Reddit post ID the comment belongs to. */
  postId: string;
  /** Subreddit name (without r/ prefix). */
  subredditName: string;
  /** Reddit username of the comment author. */
  authorName: string;
  /** Comment body text (may be truncated for storage). */
  body: string;
  /** ISO-8601 timestamp when the comment was created on Reddit. */
  createdAt: string;
  /** ISO-8601 timestamp when we ingested the comment. */
  ingestedAt: string;
  /** Current processing status. */
  status: CommentStatus;
  /** If status is "skipped", why. */
  skipReason?: SkipReason;
  /** Analysis result (populated after Story 02 pipeline completes). */
  analysis?: AnalysisResult;
  /** Error message if status is "error". */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Settings keys — single source of truth for setting name strings
// ---------------------------------------------------------------------------

export const SETTINGS = {
  /** Per-installation on/off toggle. */
  ENABLED: "botditorEnabled",
  /** Gemini API key (global secret, Story 02). */
  GEMINI_API_KEY: "geminiApiKey",
  /** Gemini model name (global, Story 02). */
  GEMINI_MODEL: "geminiModel",
  /** Comma-separated allowlisted usernames (bulk import). */
  ALLOWLIST_USERNAMES: "allowlistUsernames",
  /** Comma-separated allowlisted domains. */
  ALLOWLIST_DOMAINS: "allowlistDomains",
} as const;

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

export const REDIS_KEYS = {
  /** Key for a single ingested comment record. */
  comment: (commentId: string) => `comment:${commentId}`,
  /** Key for the per-user allowlist flag. */
  allowlistUser: (username: string) =>
    `allowlist:user:${username.toLowerCase()}`,
  /** Sorted set tracking all ingested comment IDs by timestamp. */
  commentIndex: (subredditName: string) =>
    `comments:index:${subredditName.toLowerCase()}`,
  /** Counter of total comments ingested per subreddit. */
  commentCount: (subredditName: string) =>
    `comments:count:${subredditName.toLowerCase()}`,
  /** Cached AI analysis result for a comment (Story 02). */
  analysisCache: (commentId: string) => `analysis:cache:${commentId}`,
} as const;

/** Maximum body length stored in Redis to keep record sizes reasonable. */
export const MAX_BODY_LENGTH = 4000;

/** Maximum body length sent to the Gemini prompt (Story 02). */
export const MAX_PROMPT_BODY_LENGTH = 8000;

/** Cache TTL for analysis results — 1 hour in milliseconds (Story 02). */
export const ANALYSIS_CACHE_TTL_MS = 3_600_000;
