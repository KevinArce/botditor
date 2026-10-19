/**
 * App-wide settings definition for Botditor.
 *
 * Registers all Devvit settings that moderators / developers configure.
 * Imported once in main.ts so settings are registered at app boot.
 */
import { Devvit, SettingScope } from "@devvit/public-api";
import {
  SETTINGS,
  DEFAULT_GEMINI_MODEL,
} from "./types.js";

// ---------------------------------------------------------------------------
// Validators (COR-2) — run when a moderator saves the settings form.
// `rules.ts` re-checks at runtime for values saved before these existed.
// ---------------------------------------------------------------------------

/** Reject thresholds outside (0, 1]; 0 would act on every comment. */
export function validateThresholdSetting({
  value,
}: {
  value: number | undefined;
}): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return "Enter a number greater than 0 and at most 1 (e.g. 0.75).";
  }
  return undefined;
}

/** Build a validator that accepts one of `options` (case-insensitive). */
export function oneOf(options: readonly string[]) {
  return ({ value }: { value: string | undefined }): string | undefined => {
    if (value === undefined || value.trim() === "") return undefined;
    return options.includes(value.trim().toLowerCase())
      ? undefined
      : `Must be one of: ${options.join(", ")}.`;
  };
}

Devvit.addSettings([
  // ── Per-installation (subreddit) settings ─────────────────────────
  {
    type: "boolean",
    name: SETTINGS.ENABLED,
    label: "Enable Botditor",
    helpText:
      "When disabled, comments are still received but no analysis or moderation actions are taken.",
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    type: "string",
    name: SETTINGS.ALLOWLIST_USERNAMES,
    label: "Allowlisted usernames (comma-separated)",
    helpText:
      "Comments from these users will always be skipped. Case-insensitive.",
    defaultValue: "",
    scope: SettingScope.Installation,
  },
  {
    type: "string",
    name: SETTINGS.ALLOWLIST_DOMAINS,
    label: "Allowlisted domains (comma-separated)",
    helpText:
      "URLs matching these domains will not trigger spam heuristics. Example: reddit.com,wikipedia.org",
    defaultValue: "",
    scope: SettingScope.Installation,
  },
  {
    type: "number",
    name: SETTINGS.TOXICITY_REMOVE_THRESHOLD,
    label: "Toxicity auto-remove threshold",
    helpText:
      "Comments with a toxicity score at or above this value (0–1) are automatically removed. 1.0 removes only maximum-score comments.",
    defaultValue: 0.85,
    onValidate: validateThresholdSetting,
    scope: SettingScope.Installation,
  },
  {
    type: "number",
    name: SETTINGS.TOXICITY_FLAG_THRESHOLD,
    label: "Toxicity flag-for-review threshold",
    helpText:
      "Comments with a toxicity score at or above this value (0–1, but below the remove threshold) are reported for manual review.",
    defaultValue: 0.60,
    onValidate: validateThresholdSetting,
    scope: SettingScope.Installation,
  },
  {
    type: "boolean",
    name: SETTINGS.DRY_RUN,
    label: "Dry-run mode",
    helpText:
      "When enabled, moderation actions are logged but not executed. Useful for tuning thresholds.",
    defaultValue: false,
    scope: SettingScope.Installation,
  },

  // ── Spam detection settings (Story 04) ────────────────────────────
  {
    type: "number",
    name: SETTINGS.SPAM_REMOVE_THRESHOLD,
    label: "Spam auto-remove threshold",
    helpText:
      "Comments with a spam score (0–1) at or above this value are removed, only when spam mode is 'remove'.",
    defaultValue: 0.80,
    onValidate: validateThresholdSetting,
    scope: SettingScope.Installation,
  },
  {
    type: "number",
    name: SETTINGS.SPAM_FLAG_THRESHOLD,
    label: "Spam flag-for-review threshold",
    helpText:
      "Comments with a spam score (0–1) at or above this value are reported for manual review.",
    defaultValue: 0.50,
    onValidate: validateThresholdSetting,
    scope: SettingScope.Installation,
  },
  {
    type: "string",
    name: SETTINGS.SPAM_MODE,
    label: "Spam enforcement mode",
    helpText:
      "Set to 'flag' (default) to only report spam, or 'remove' to auto-remove spam that exceeds the remove threshold.",
    defaultValue: "flag",
    onValidate: oneOf(["flag", "remove"]),
    scope: SettingScope.Installation,
  },
  {
    type: "string",
    name: SETTINGS.SPAM_BLOCKED_DOMAINS,
    label: "Blocked domains (comma-separated)",
    helpText:
      "URLs matching these domains trigger instant spam removal (score = 1.0). Example: bit.ly,tinyurl.com",
    defaultValue: "",
    scope: SettingScope.Installation,
  },

  // ── Auto-moderation rules (Story 06) ───────────────────────────────
  {
    type: "number",
    name: SETTINGS.BOT_FLAG_THRESHOLD,
    label: "Bot-likelihood flag threshold",
    helpText:
      "Comments with an AI bot-likelihood score (0–1) at or above this value are reported for manual review. Never removes or bans.",
    defaultValue: 0.75,
    onValidate: validateThresholdSetting,
    scope: SettingScope.Installation,
  },
  {
    type: "string",
    name: SETTINGS.MODERATION_PROFILE,
    label: "Moderation profile",
    helpText:
      "'chill' (default) or 'strict'. Selects the tone of the warning PM template below; it does not change any threshold.",
    defaultValue: "chill",
    onValidate: oneOf(["chill", "strict"]),
    scope: SettingScope.Installation,
  },

  // ── Warning message templates (Story 09) ────────────────────────────
  {
    type: "paragraph",
    name: SETTINGS.WARNING_TEMPLATE_STRICT,
    label: "Warning template (strict profile)",
    helpText:
      "PM body sent to users when their comment is flagged under the strict profile. " +
      "Supports placeholders: {{username}}, {{issue}}, {{rulesLink}}.",
    defaultValue:
      "Hello u/{{username}},\n\n" +
      "Your recent comment has been flagged by our moderation system for the following issue: **{{issue}}**.\n\n" +
      "This is a formal notice that continued violations may result in further action. " +
      "Please review our subreddit rules: {{rulesLink}}\n\n" +
      "— The Moderation Team",
    scope: SettingScope.Installation,
  },
  {
    type: "paragraph",
    name: SETTINGS.WARNING_TEMPLATE_CHILL,
    label: "Warning template (chill profile)",
    helpText:
      "PM body sent to users when their comment is flagged under the chill profile. " +
      "Supports placeholders: {{username}}, {{issue}}, {{rulesLink}}.",
    defaultValue:
      "Hey u/{{username}} 👋\n\n" +
      "Just a heads-up — your comment was flagged for: **{{issue}}**.\n\n" +
      "No worries, just keep our community guidelines in mind going forward! " +
      "You can check them out here: {{rulesLink}}\n\n" +
      "Thanks for being part of the community! ✌️",
    scope: SettingScope.Installation,
  },

  // ── Global (developer) settings ───────────────────────────────────
  {
    type: "string",
    name: SETTINGS.GEMINI_API_KEY,
    label: "Gemini API Key",
    isSecret: true,
    scope: SettingScope.App,
  },
  {
    type: "string",
    name: SETTINGS.GEMINI_MODEL,
    label: "Gemini Model",
    helpText:
      "Gemini model ID. A retired or unknown model makes every analysis fall back to zero scores (no moderation).",
    defaultValue: DEFAULT_GEMINI_MODEL,
    scope: SettingScope.App,
  },
]);
