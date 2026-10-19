# Story 15: Moderation Style Profiles

Status: 🟡 Partial — re-scoped (2026-10-18) to **warning tone only**. The setting's help text and the README now say so. Threshold presets are on hold, for the reason below.

Current state (2026-10-18): `moderationProfile` (`chill` | `strict`, validated) chooses between the chill and strict warning templates (Story 09). It doesn't change any threshold.

Why presets aren't implemented: the acceptance criterion "profile thresholds are overridden by any individual threshold setting explicitly set by the moderator" can't be met today. Every threshold setting registers a `defaultValue`, and Devvit returns that default when the moderator hasn't set the field. So code can't tell "the moderator chose 0.85" from "untouched", and a preset would either override explicit choices or never apply. A workable design: remove the `defaultValue` from the threshold settings (help text: "leave blank to use the profile preset") and resolve `explicit ?? preset[profile]` in `rules.ts`. Before shipping it, verify in a playtest that installs that already saved values keep them, and that unset fields come back `undefined`. The cleanest moment is the Devvit Web migration (PLAT-1), where settings are re-declared in `devvit.json`.

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

Deferred: "Comedy mode" isn't a profile option. Story 17 (humorous templates) was dropped on 2026-10-18.

Dependencies: Story 06 (threshold settings), Story 09 (warning template selection).
