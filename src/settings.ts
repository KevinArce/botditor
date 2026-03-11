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
