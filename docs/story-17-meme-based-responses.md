# Story 17: Humorous Warning Templates

Status: ⚠️ Scope Down — image-based meme responses are not feasible in Devvit (no image upload API for bot-posted content); scoped to text-only humorous templates used in warning messages.

Feature area: Nice-to-Have

Story (scoped):
As a moderator, I want an optional set of light-hearted text warning templates so that automated warnings feel less robotic and match subreddits with a casual culture.

Acceptance criteria:
- A third moderation profile option, `comedy`, is available in App Settings (Story 15) for subreddits that want humorous warnings.
- The `comedy` profile uses the same thresholds as `chill` but substitutes a humorous warning template (e.g., "Hey friend, we noticed your comment was a little spicy 🌶️ — let's keep it cool!").
- Templates are predefined text strings (not AI-generated) to ensure predictability and policy compliance.
- The `comedy` profile explicitly does not change removal or ban behavior — it only affects the tone of warning messages sent via Story 09.
- Humorous templates must not mock, demean, or target any group; they must comply with Reddit's content policy.

Feasibility rating: Medium

Justification:
Text templates are trivially implementable as constants. The `comedy` profile is a pure settings extension of Story 15. No image hosting or upload API is required.

Devvit hooks:
- `context.settings.get('moderationProfile')` — if `comedy`, use humor template map
- Template strings stored as constants in code

Limitation: Image-based meme responses (original requirement) are not feasible — Devvit does not provide an API for bots to upload images to Reddit posts or comments. Text-only templates fully address the intent.

Dependencies: Story 09 (Warning Messages), Story 15 (Moderation Style Profiles).
