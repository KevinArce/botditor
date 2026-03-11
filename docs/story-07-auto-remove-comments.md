# Story 07: Auto-Remove Rule-Breaking Comments

Status: ✅ Keep & Enrich

Feature area: Core Moderation

Story:
As a moderator, I want the app to remove comments that violate rules automatically so that the subreddit stays clean without requiring constant moderator attention.

Acceptance criteria:
- Removal is triggered only when a score exceeds the relevant threshold from Story 06.
- Every removal is written to the mod log with: action type, target comment ID, score, reason from Gemini, and a `botditor` details tag.
- A `dryRun` mode (configurable via App Settings) logs what would have been removed but takes no action.
- The removal function is reused from the existing `nuke.ts` comment removal logic.
- Removed comments are stored in `kvStore` so the app does not attempt to re-remove them.

Feasibility rating: High

Justification:
`comment.remove()` and `context.modLog.add()` are already implemented in `src/nuke.ts`. This story extends that logic to trigger automatically from AI scores rather than manual moderator menu action.

Devvit hooks:
- `comment.remove()` — reused from `src/nuke.ts`
- `context.modLog.add({ action: 'removecomment', target: commentId, details: 'botditor', description: reason })`
- `context.kvStore.set(`removed:${commentId}`, '1')` — deduplication

Edge cases:
- Comment already removed by another mod before the app acts: `comment.remove()` is idempotent; catch and log any error.
- Removal of a top-level comment that spawns child comments: only the specific comment is targeted; use Story 01's nuke logic only when explicitly invoked by a moderator.
- App setting `dryRun` toggled on mid-flight: check the setting at action time, not at trigger time.

Dependencies: Story 01 (Comment Ingestion), Story 02 (AI scores), Story 06 (thresholds).
