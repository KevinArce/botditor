/**
 * App-wide settings definition for Botditor.
 *
 * Registers all Devvit settings that moderators / developers configure.
 * Imported once in main.ts so settings are registered at app boot.
 */
import { Devvit, SettingScope } from "@devvit/public-api";
import { SETTINGS } from "./types.js";

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
      "Comments with a toxicity score at or above this value are automatically removed. Set to 1.0 to disable auto-removal.",
    defaultValue: 0.85,
    scope: SettingScope.Installation,
  },
  {
    type: "number",
    name: SETTINGS.TOXICITY_FLAG_THRESHOLD,
    label: "Toxicity flag-for-review threshold",
    helpText:
      "Comments with a toxicity score at or above this value (but below the remove threshold) are reported for manual review.",
    defaultValue: 0.60,
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
    defaultValue: "gemini-1.5-flash",
    scope: SettingScope.App,
  },
]);
