# Story 06: Auto-Moderation Rules

Status: ✅ Implemented

Feature area: Core Moderation

Story:
As a moderator, I want configurable threshold rules that determine automated actions so that moderation behavior aligns with my subreddit's specific policies without requiring a redeploy.

Acceptance criteria:
- All thresholds are stored in Devvit App Settings and editable via the Devvit settings UI:
  - `toxicityRemoveThreshold` (float, 0–1, default 0.85)
  - `toxicityFlagThreshold` (float, 0–1, default 0.60)
  - `spamRemoveThreshold` (float, 0–1, default 0.80)
  - `botFlagThreshold` (float, 0–1, default 0.75)
  - `enabled` (boolean, default true)
  - `dryRun` (boolean, default false)
  - `moderationProfile` (select: `strict` | `chill`, default `chill`) — see Story 15
- Settings changes take effect on the next triggered comment; no redeploy required.
- Invalid threshold values (e.g., remove threshold lower than flag threshold) are validated at settings-read time with a safe fallback to defaults and a logged warning.
- All active thresholds are logged at app startup for auditability.

Feasibility rating: High

Justification:
Devvit App Settings is the standard mechanism for per-subreddit configuration. No platform blockers.

Devvit hooks:
- `Devvit.addSettings([...])` — declare all settings fields
- `context.settings.get('toxicityRemoveThreshold')` — read at trigger time
- `context.settings.getAll()` — read all settings for validation

Edge cases:
- Moderator sets remove threshold lower than flag threshold: log a warning and treat flag threshold as max(flag, remove) to prevent accidental silent removals.
- Settings read fails: fall back to hardcoded safe defaults and log error.

Dependencies: Stories 03, 04, 05, 07, 15 all consume these settings. Must be implemented before any automated action story is activated.
