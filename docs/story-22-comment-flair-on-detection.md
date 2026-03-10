# Story 22: Comment Flair on Detection (Gap Story)

Status: ✅ New — identified via gap analysis; Devvit exposes comment flair APIs that can visually mark flagged content inline, reducing the need for moderators to navigate to the mod queue.

Feature area: Core Moderation

Story:
As a moderator, I want flagged comments automatically labeled with a visible flair tag so that I can identify suspect content at a glance while browsing the thread without opening the mod queue.

Acceptance criteria:
- When a comment is flagged for review (Story 08) and NOT auto-removed, the app applies a configurable flair tag to that comment (e.g., `[⚠️ Under Review]`).
- The flair text and color are configurable in App Settings.
- Flair is applied only if the `commentFlair` setting is enabled (default: disabled) to avoid noise on subreddits that prefer a clean UI.
- If the flagged comment is later approved or dismissed by a moderator (via the mod queue), a menu action "Remove Botditor Flair" is available to clear the flair.
- Flair is never applied to auto-removed comments (they are already removed from view).

Feasibility rating: Medium

Justification:
Devvit exposes comment flair APIs via `context.reddit.setCommentFlair()` (or equivalent). This is a low-cost enhancement that significantly improves moderator visibility without requiring navigation to the mod queue.

Devvit hooks:
- `context.reddit.setCommentFlair({ subredditName, commentId, text, cssClass })` or equivalent
- `Devvit.addMenuItem({ label: 'Remove Botditor Flair', location: 'comment', forUserType: 'moderator', onPress })` — for manual flair removal
- `context.settings.get('commentFlairEnabled')` and `context.settings.get('commentFlairText')`

Edge cases:
- Subreddit has flair disabled: catch the API error and log; do not treat as a critical failure.
- Flair overrides an existing author-set flair: check for existing flair before applying; if present, skip to avoid overwriting legitimate content flairs.
- Comment is deleted between flag and flair application: catch the 404 and log.

Limitation: Flair visibility depends on the subreddit's CSS/flair settings. For subreddits with flair disabled or heavily customized, the visual indicator may not appear. This is a best-effort enhancement.

Dependencies: Story 08 (Flag for Manual Review — triggers the flair), Story 06 (enabled/disabled setting).
