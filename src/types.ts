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
// Spam result (produced by Story 04 – Spam Detection)
// ---------------------------------------------------------------------------

/** Output from the rule-based spam heuristics (Story 04). */
export interface SpamResult {
  /** Composite spam score 0–1, clamped. */
  score: number;
  /** Human-readable reasons for each heuristic that fired. */
  reasons: string[];
  /** True when a URL matched the blocked-domain list (instant removal). */
  blockedDomain: boolean;
}

// ---------------------------------------------------------------------------
// Moderation actions (produced by Story 03/04)
// ---------------------------------------------------------------------------

/** Action taken (or that would be taken in dry-run) on a comment. */
export type ModerationAction =
  | "removed"              // Auto-removed due to high toxicity
  | "flagged"              // Reported for manual review
  | "none"                 // Below thresholds or error — no action
  | "dry_run_remove"       // Would remove, but dry-run is on
  | "dry_run_flag"         // Would flag, but dry-run is on
  | "spam_removed"         // Auto-removed due to spam (Story 04)
  | "spam_flagged"         // Reported for spam review (Story 04)
  | "dry_run_spam_remove"  // Would spam-remove, but dry-run is on
  | "dry_run_spam_flag";   // Would spam-flag, but dry-run is on

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
  /** Moderation action taken after analysis (Story 03). */
  moderationAction?: ModerationAction;
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
  /** Toxicity score above which comments are auto-removed (Story 03). */
  TOXICITY_REMOVE_THRESHOLD: "toxicityRemoveThreshold",
  /** Toxicity score above which comments are flagged for review (Story 03). */
  TOXICITY_FLAG_THRESHOLD: "toxicityFlagThreshold",
  /** When true, log moderation actions without executing them (Story 03/07). */
  DRY_RUN: "dryRunMode",
  /** Spam score above which comments are auto-removed (Story 04). */
  SPAM_REMOVE_THRESHOLD: "spamRemoveThreshold",
  /** Spam score above which comments are flagged for review (Story 04). */
  SPAM_FLAG_THRESHOLD: "spamFlagThreshold",
  /** Spam enforcement mode: "flag" (default) or "remove" (Story 04). */
  SPAM_MODE: "spamMode",
  /** Comma-separated blocked domains — instant removal (Story 04). */
  SPAM_BLOCKED_DOMAINS: "spamBlockedDomains",
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
  /** Tracks a recent comment body hash for duplicate-body detection (Story 04). */
  recentBody: (authorName: string, hash: string) =>
    `spam:recentbody:${authorName.toLowerCase()}:${hash}`,
} as const;

/** Maximum body length stored in Redis to keep record sizes reasonable. */
export const MAX_BODY_LENGTH = 4000;

/** Maximum body length sent to the Gemini prompt (Story 02). */
export const MAX_PROMPT_BODY_LENGTH = 8000;

/** Cache TTL for analysis results — 1 hour in milliseconds (Story 02). */
export const ANALYSIS_CACHE_TTL_MS = 3_600_000;
