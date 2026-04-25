/**
 * Centralized Moderation Rules – Story 06
 *
 * Reads all moderation-related Devvit settings, validates threshold
 * ordering (remove ≥ flag), and returns a type-safe `ModerationRules`
 * snapshot.  On any error the function falls back to `DEFAULT_RULES`
 * and logs the issue — the app never starts with undefined behaviour.
 *
 * Downstream consumers (`enforceToxicity`, `enforceSpam`, future
 * stories 07-09) receive a pre-validated rules object instead of
 * reading settings ad-hoc.
 */
import type { SettingsClient } from "@devvit/public-api";
import type { ModerationRules, ModerationProfile } from "./types.js";
import { SETTINGS, DEFAULT_RULES } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate all moderation rules from Devvit settings.
 *
 * Returns a validated `ModerationRules` snapshot.  If any setting read
 * fails, the entire call falls back to `DEFAULT_RULES` with a logged
 * error.
 */
export async function loadModerationRules(
  settings: SettingsClient
): Promise<ModerationRules> {
  try {
    return await loadAndValidate(settings);
  } catch (err) {
    console.error(
      "[rules] Failed to load moderation settings — using safe defaults:",
      err instanceof Error ? err.message : err
    );
    return { ...DEFAULT_RULES };
  }
}

/**
 * Log all active thresholds for auditability (acceptance criterion).
 * Call once after loading rules at the start of each trigger invocation.
 */
export function logActiveRules(rules: ModerationRules): void {
  console.log(
    `[rules] Active moderation rules: ` +
      `enabled=${rules.enabled}, ` +
      `dryRun=${rules.dryRun}, ` +
      `profile=${rules.moderationProfile}, ` +
      `toxicity=[flag=${rules.toxicityFlagThreshold}, remove=${rules.toxicityRemoveThreshold}], ` +
      `spam=[flag=${rules.spamFlagThreshold}, remove=${rules.spamRemoveThreshold}, mode=${rules.spamMode}], ` +
      `botFlag=${rules.botFlagThreshold}`
  );
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function loadAndValidate(
  settings: SettingsClient
): Promise<ModerationRules> {
  // Read all settings (each falls back to its default on undefined)
  const enabled =
    (await settings.get<boolean>(SETTINGS.ENABLED)) ?? DEFAULT_RULES.enabled;
  const dryRun =
    (await settings.get<boolean>(SETTINGS.DRY_RUN)) ?? DEFAULT_RULES.dryRun;

  const profileRaw =
    (await settings.get<string>(SETTINGS.MODERATION_PROFILE)) ?? DEFAULT_RULES.moderationProfile;
  const moderationProfile = validateProfile(profileRaw);

  let toxicityRemoveThreshold =
    (await settings.get<number>(SETTINGS.TOXICITY_REMOVE_THRESHOLD)) ??
    DEFAULT_RULES.toxicityRemoveThreshold;
  let toxicityFlagThreshold =
    (await settings.get<number>(SETTINGS.TOXICITY_FLAG_THRESHOLD)) ??
    DEFAULT_RULES.toxicityFlagThreshold;

  let spamRemoveThreshold =
    (await settings.get<number>(SETTINGS.SPAM_REMOVE_THRESHOLD)) ??
    DEFAULT_RULES.spamRemoveThreshold;
  let spamFlagThreshold =
    (await settings.get<number>(SETTINGS.SPAM_FLAG_THRESHOLD)) ??
    DEFAULT_RULES.spamFlagThreshold;

  const spamMode =
    (await settings.get<string>(SETTINGS.SPAM_MODE)) ?? DEFAULT_RULES.spamMode;

  const botFlagThreshold =
    (await settings.get<number>(SETTINGS.BOT_FLAG_THRESHOLD)) ??
    DEFAULT_RULES.botFlagThreshold;

  // ── Validate threshold ordering ──────────────────────────────────
  // Edge case from story spec: if remove < flag, clamp flag down to
  // remove so we never silently remove without also flagging.
  toxicityFlagThreshold = validateThresholdPair(
    "toxicity",
    toxicityRemoveThreshold,
    toxicityFlagThreshold
  );

  spamFlagThreshold = validateThresholdPair(
    "spam",
    spamRemoveThreshold,
    spamFlagThreshold
  );

  return {
    enabled,
    dryRun,
    moderationProfile,
    toxicityRemoveThreshold,
    toxicityFlagThreshold,
    spamRemoveThreshold,
    spamFlagThreshold,
    spamMode,
    botFlagThreshold,
  };
}

// ---------------------------------------------------------------------------
// Validators (exported for testing)
// ---------------------------------------------------------------------------

/**
 * If the remove threshold is lower than the flag threshold, clamp the
 * flag threshold down and log a warning.  Returns the (possibly clamped)
 * flag threshold.
 */
export function validateThresholdPair(
  label: string,
  removeThreshold: number,
  flagThreshold: number
): number {
  if (removeThreshold < flagThreshold) {
    console.warn(
      `[rules] ${label}: remove threshold (${removeThreshold}) is lower than ` +
        `flag threshold (${flagThreshold}). Clamping flag to ${removeThreshold} ` +
        `to prevent silent removals.`
    );
    return removeThreshold;
  }
  return flagThreshold;
}

/**
 * Validate and normalise the moderation profile string.
 */
export function validateProfile(raw: string): ModerationProfile {
  const normalised = raw.trim().toLowerCase();
  if (normalised === "strict" || normalised === "chill") {
    return normalised;
  }
  console.warn(
    `[rules] Unknown moderation profile "${raw}" — falling back to "chill".`
  );
  return "chill";
}
