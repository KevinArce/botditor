# Story 03: Toxicity Detection

Status: ✅ Implemented

Feature area: Core Moderation

Implementation notes:
- Enforcement logic in `src/moderation.ts` with `enforceToxicity()` entry point.
- Three configurable per-installation settings: `toxicityRemoveThreshold` (0.85), `toxicityFlagThreshold` (0.60), `dryRunMode` (false).
- Auto-remove uses `comment.remove()`, flagging uses `context.reddit.report()`.
- Dry-run mode logs actions without executing — useful for threshold tuning.
- All errors return `"none"` — fail safe, never throws.
- Comment already deleted (404) is handled gracefully.

Story:
As a moderator, I want toxic comments detected and acted upon automatically so that harmful content is handled quickly and consistently.

Acceptance criteria:
- A `toxicityScore` (0–1) is produced for every analyzed comment via the AI pipeline (Story 02).
- Three configurable thresholds determine the action taken:
  - `toxicityRemoveThreshold` (default 0.85): comment is removed and logged to modlog.
  - `toxicityFlagThreshold` (default 0.60): comment is reported for manual review (Story 08) and no auto-removal occurs.
  - Below `toxicityFlagThreshold`: no action; score is stored for analytics (Story 13).
- All removals are written to the subreddit mod log with the reason string from Gemini.
- A dry-run mode (Story 07) suppresses removals and only logs what would have happened.
- Moderators can override a removal via the standard Reddit mod queue; the app does not re-remove overridden content.

Feasibility rating: High

Justification:
`comment.remove()` is fully supported. `context.modLog.add()` is used by the existing nuke logic. Gemini returns a structured toxicity score with a single API call.

Devvit hooks:
- `context.reddit.getCommentById(commentId)` then `comment.remove()`
- `context.modLog.add({ action: 'removecomment', target: commentId, details: 'botditor', description: reason })`
- `context.settings.get('toxicityRemoveThreshold')`

Gemini prompt strategy:
The `toxicityScore` and `reason` fields are sourced from the shared AI Analysis Pipeline prompt (Story 02). No additional API call is needed.

Edge cases:
- Auto-moderated comment is restored by a mod: the `ModAction` event (if available) can be used to record the override and reduce false-positive weighting in future tuning.
- Comment deleted by author before removal completes: catch the 404 and log a skip.
- Back-to-back toxic comments from same user: each is processed independently; ban escalation is handled by Story 10.

Dependencies: Story 02 (AI Analysis Pipeline), Story 06 (Auto-Moderation Rules thresholds), Story 07 (dry-run mode), Story 08 (flagging path).
