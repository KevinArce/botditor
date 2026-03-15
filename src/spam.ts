/**
 * Spam Detection – Story 04
 *
 * Rule-based heuristics that compute a spam score (0–1) for a comment.
 * Designed to run fast with zero API cost, before the AI pipeline.
 *
 * Heuristics:
 *   1. URL count:        >3 URLs         → +0.4
 *   2. Blocked domains:  domain match    → score = 1.0 (instant)
 *   3. Repeated body:    same body hash
 *                        by same author
 *                        within 10 min   → +0.5
 *   4. New account:      age <3 days
 *                        AND karma <10   → +0.3
 *
 * The composite score is clamped to 0–1. Each fired heuristic appends a
 * human-readable reason string to the result.
 *
 * Fail-safe: any heuristic that depends on external data (Redis, Reddit API)
 * is wrapped in a try/catch so a failure simply skips that check.
 */
import type { TriggerContext } from "@devvit/public-api";
import type { SpamResult } from "./types.js";
import { SETTINGS, REDIS_KEYS } from "./types.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compute a rule-based spam score for a comment.
 *
 * Always returns a valid `SpamResult` — never throws.
 */
export async function computeSpamScore(
  body: string,
  authorName: string,
  context: TriggerContext
): Promise<SpamResult> {
  try {
    return await computeSpamScoreInner(body, authorName, context);
  } catch (err) {
    console.error(
      `[spam] Unexpected error computing spam score for u/${authorName}:`,
      err instanceof Error ? err.message : err
    );
    return { score: 0, reasons: [], blockedDomain: false };
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

/** 10 minutes in seconds, used as TTL for duplicate-body keys. */
const DUPLICATE_WINDOW_SECONDS = 600;

/** Simple URL regex – matches http(s):// URLs. */
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

async function computeSpamScoreInner(
  body: string,
  authorName: string,
  context: TriggerContext
): Promise<SpamResult> {
  const { redis, settings } = context;

  let score = 0;
  const reasons: string[] = [];
  let blockedDomain = false;

  // ── Read settings ─────────────────────────────────────────────────
  const blockedDomainsRaw =
    (await settings.get<string>(SETTINGS.SPAM_BLOCKED_DOMAINS)) ?? "";
  const blockedDomains = parseDomainList(blockedDomainsRaw);

  const allowedDomainsRaw =
    (await settings.get<string>(SETTINGS.ALLOWLIST_DOMAINS)) ?? "";
  const allowedDomains = parseDomainList(allowedDomainsRaw);

  // ── 1. URL count & blocked domains ────────────────────────────────
  const urls = extractUrls(body);
  const nonAllowlistedUrls = urls.filter(
    (url) => !matchesDomainList(url, allowedDomains)
  );

  // Check blocked domains first (instant removal)
  for (const url of urls) {
    if (matchesDomainList(url, blockedDomains)) {
      console.log(`[spam] Blocked domain detected in URL: ${url}`);
      return { score: 1.0, reasons: [`blocked domain: ${url}`], blockedDomain: true };
    }
  }

  // URL count heuristic
  if (nonAllowlistedUrls.length > 3) {
    score += 0.4;
    reasons.push(`${nonAllowlistedUrls.length} URLs detected (threshold: 3)`);
  }

  // ── 2. Repeated body (same author, last 10 min) ───────────────────
  try {
    const bodyHash = simpleHash(body.trim().toLowerCase());
    const recentKey = REDIS_KEYS.recentBody(authorName, bodyHash);
    const existing = await redis.get(recentKey);

    if (existing) {
      score += 0.5;
      reasons.push("repeated identical comment body within 10 minutes");
    }

    // Always set/refresh the key so current comment is tracked
    await redis.set(recentKey, "1");
    await redis.expire(recentKey, DUPLICATE_WINDOW_SECONDS);
  } catch (err) {
    // Non-fatal: skip duplicate-body check on Redis error
    console.warn(
      `[spam] Redis error during duplicate-body check for u/${authorName}:`,
      err instanceof Error ? err.message : err
    );
  }

  // ── 3. Account age & karma ────────────────────────────────────────
  try {
    const user = await context.reddit.getUserByUsername(authorName);
    if (user) {
      const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
      const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
      const karma = (user.commentKarma ?? 0) + (user.linkKarma ?? 0);

      if (accountAgeDays < 3 && karma < 10) {
        score += 0.3;
        reasons.push(
          `new account (${accountAgeDays.toFixed(1)} days, ${karma} karma)`
        );
      }
    }
  } catch (err) {
    // Non-fatal: skip account age check if API is unavailable
    console.warn(
      `[spam] Could not fetch user info for u/${authorName}:`,
      err instanceof Error ? err.message : err
    );
  }

  // ── Clamp and return ──────────────────────────────────────────────
  const clampedScore = Math.min(1, Math.max(0, score));

  if (reasons.length > 0) {
    console.log(
      `[spam] u/${authorName} spam score=${clampedScore.toFixed(2)}: ${reasons.join("; ")}`
    );
  }

  return { score: clampedScore, reasons, blockedDomain };
}

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract all URLs from a text string.
 */
export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? [];
}

/**
 * Parse a comma-separated domain list into a normalized array.
 */
export function parseDomainList(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check if a URL matches any domain in a list.
 * Matches the domain itself *and* subdomains (e.g. m.bit.ly matches bit.ly).
 */
export function matchesDomainList(url: string, domains: string[]): boolean {
  if (domains.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

/**
 * Simple non-cryptographic hash for a string — used only for Redis key
 * generation, not security. DJB2 algorithm.
 */
export function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}
