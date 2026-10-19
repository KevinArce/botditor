/**
 * Centralized Moderation Rules – Story 06
 *
 * Reads all moderation-related Devvit settings, validates threshold
 * ranges (0 < x ≤ 1) and ordering (remove ≥ flag), normalises the
 * free-text enum settings, and returns a type-safe `ModerationRules`
 * snapshot.  On any error the function falls back to `DEFAULT_RULES`
 * and logs the issue — the app never starts with undefined behaviour.
 *
 * Downstream consumers (`enforceToxicity`, `enforceSpam`, future
 * stories 07-09) receive a pre-validated rules object instead of
 * reading settings ad-hoc.
 */
import type { SettingsClient } from "@devvit/public-api";
import type { ModerationRules, ModerationProfile, SpamMode } from "./types.js";
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

  const toxicityRemoveThreshold = validateThreshold(
    "toxicityRemoveThreshold",
    await settings.get<number>(SETTINGS.TOXICITY_REMOVE_THRESHOLD),
    DEFAULT_RULES.toxicityRemoveThreshold
  );
  let toxicityFlagThreshold = validateThreshold(
    "toxicityFlagThreshold",
    await settings.get<number>(SETTINGS.TOXICITY_FLAG_THRESHOLD),
    DEFAULT_RULES.toxicityFlagThreshold
  );

  const spamRemoveThreshold = validateThreshold(
    "spamRemoveThreshold",
    await settings.get<number>(SETTINGS.SPAM_REMOVE_THRESHOLD),
    DEFAULT_RULES.spamRemoveThreshold
  );
  let spamFlagThreshold = validateThreshold(
    "spamFlagThreshold",
    await settings.get<number>(SETTINGS.SPAM_FLAG_THRESHOLD),
    DEFAULT_RULES.spamFlagThreshold
  );

  const spamMode = validateSpamMode(
    (await settings.get<string>(SETTINGS.SPAM_MODE)) ?? DEFAULT_RULES.spamMode
  );

  const botFlagThreshold = validateThreshold(
    "botFlagThreshold",
    await settings.get<number>(SETTINGS.BOT_FLAG_THRESHOLD),
    DEFAULT_RULES.botFlagThreshold
  );

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
 * Range-check a threshold (COR-2). Unset, non-numeric, and ≤ 0 values fall
 * back to the default: a threshold of 0 would act on every comment,
 * including those whose AI call failed and returned zero scores. Values
 * above 1 are kept (scores never exceed 1, so the action is effectively
 * off) but logged, since the settings form now rejects them.
 */
export function validateThreshold(
  label: string,
  value: unknown,
  fallback: number
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    console.warn(
      `[rules] ${label}: invalid threshold ${JSON.stringify(value)} — ` +
        `using default ${fallback}.`
    );
    return fallback;
  }
  if (value > 1) {
    console.warn(
      `[rules] ${label}: threshold ${value} is above 1, so this action never fires.`
    );
  }
  return value;
}

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
 * Validate and normalise the spam mode string. Anything other than
 * "remove" behaves as the safe "flag" mode.
 */
export function validateSpamMode(raw: string): SpamMode {
  const normalised = raw.trim().toLowerCase();
  if (normalised === "flag" || normalised === "remove") {
    return normalised;
  }
  console.warn(`[rules] Unknown spam mode "${raw}" — falling back to "flag".`);
  return "flag";
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
