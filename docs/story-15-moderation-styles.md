# Story 15: Moderation Style Profiles

Status: ⚠️ Scope Down — AI-generated response tone per profile is deferred; scoped to threshold presets only, with an optional tone label used in warning templates (Story 09).

Feature area: Core Moderation

Story (scoped):
As a moderator, I want to select a Strict or Chill moderation preset so that I can quickly align automated thresholds with my subreddit's culture without manually adjusting each threshold.

Acceptance criteria:
- `moderationProfile` is a configurable App Setting with two options: `strict` and `chill` (default `chill`).
- Selecting `strict` applies: `toxicityRemoveThreshold = 0.70`, `toxicityFlagThreshold = 0.45`, `spamRemoveThreshold = 0.65`, `botFlagThreshold = 0.60`.
- Selecting `chill` applies: `toxicityRemoveThreshold = 0.85`, `toxicityFlagThreshold = 0.60`, `spamRemoveThreshold = 0.80`, `botFlagThreshold = 0.75`.
- Profile thresholds are overridden by any individual threshold setting explicitly set by the moderator (profiles are defaults, not locks).
- The active profile name is included in modlog entries for auditability.
- Warning message templates (Story 09) include a tone variant per profile: strict templates are formal, chill templates are informal.

Feasibility rating: High

Justification:
Profile selection maps directly to App Setting values. No AI call is needed. The existing settings system fully supports this.

Devvit hooks:
- `Devvit.addSettings([{ name: 'moderationProfile', type: 'select', options: ['strict', 'chill'], defaultValue: 'chill' }])`
- `context.settings.get('moderationProfile')` — read at trigger time to determine effective thresholds

Edge cases:
- Individual threshold overrides conflict with profile defaults: individual settings win; profile is advisory.

Deferred: "Comedy mode" (meme-based responses) is not implemented as a profile option — see Story 17 for the scoped humor template approach.

Dependencies: Story 06 (threshold settings), Story 09 (warning template selection).
