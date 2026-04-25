# Story 07: Auto-Remove Rule-Breaking Comments

Status: 🚀 Implemented

Feature area: Core Moderation

Story:
As a moderator, I want the app to remove comments that violate rules automatically so that the subreddit stays clean without requiring constant moderator attention.

Acceptance criteria:
- ✅ Removal is triggered only when a score exceeds the relevant threshold from Story 06.
- ✅ Every removal is written to the mod log with: action type, target comment ID, score, reason from Gemini, and a `botditor` details tag.
- ✅ A `dryRun` mode (configurable via App Settings) logs what would have been removed but takes no action.
- ✅ The removal function is reused from the existing `nuke.ts` comment removal logic (`comment.remove()`).
- ✅ Removed comments are stored in Redis (`removed:<commentId>`) so the app does not attempt to re-remove them.

Feasibility rating: High

Justification:
`comment.remove()` and `context.modLog.add()` are already implemented in `src/nuke.ts`. This story extends that logic to trigger automatically from AI scores rather than manual moderator menu action.

Implementation notes:
- All Story 07 logic lives in `src/moderation.ts`, inside the `removeComment()` helper.
- The dedup check, mod log write, and dedup key set each have their own try/catch — failures in one never block the others.
- `modLog` is omitted from Devvit's `TriggerContext` type but is available at runtime; accessed via a targeted cast (same pattern as `nuke.ts`).
- 7 unit tests cover mod log entries, dedup behavior, dry-run exclusions, and Redis failure resilience.

Devvit hooks:
- `comment.remove()` — reused from `src/nuke.ts`
- `context.modLog.add({ action: 'removecomment', target: commentId, details: 'botditor', description: reason })`
- `context.redis.set(`removed:${commentId}`, '1')` — deduplication
- `context.redis.get(`removed:${commentId}`)` — dedup check before removal

Edge cases:
- Comment already removed by another mod before the app acts: `comment.remove()` is idempotent; catch and log any error.
- Comment already auto-removed on a previous event delivery: dedup key in Redis prevents re-removal.
- Removal of a top-level comment that spawns child comments: only the specific comment is targeted; use Story 01's nuke logic only when explicitly invoked by a moderator.
- App setting `dryRun` toggled on mid-flight: check the setting at action time, not at trigger time.
- Mod log write fails: logged as error, removal still counts as successful.
- Redis dedup read fails: logged as error, removal proceeds anyway (fail-open).

Dependencies: Story 01 (Comment Ingestion), Story 02 (AI scores), Story 06 (thresholds).
