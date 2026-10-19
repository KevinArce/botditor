# Story 07: Auto-Remove Rule-Breaking Comments

Status: ✅ Implemented — removal, Redis dedup (`removed:<id>`, 7-day TTL), dry-run, and a mod-facing removal note on every auto-removal via `comment.addRemovalNote({ reasonId: "", modNote })`, which replaced the dead `context.modLog.add()` (BACKLOG OPS-3, 2026-10-18). 🔍 Confirm the note in a playtest.

Feature area: Core Moderation

Story:
As a moderator, I want the app to remove comments that violate rules automatically so that the subreddit stays clean without requiring constant moderator attention.

Acceptance criteria:
- ✅ Removal is triggered only when a score exceeds the relevant threshold from Story 06.
- ❌ Every removal is written to the mod log with: action type, target comment ID, score, reason from Gemini, and a `botditor` details tag. *(Dead code — see status.)*
- ✅ A `dryRun` mode (configurable via App Settings) logs what would have been removed but takes no action.
- ✅ The removal function is reused from the existing `nuke.ts` comment removal logic (`comment.remove()`).
- ✅ Removed comments are stored in Redis (`removed:<commentId>`) so the app does not attempt to re-remove them.

Feasibility rating: High

Justification:
`comment.remove()` is already used in `src/nuke.ts`. This story extends that logic to trigger automatically from AI scores rather than manual moderator menu action.

Implementation notes:
- All Story 07 logic lives in `src/moderation.ts`, inside the `removeComment()` helper.
- The dedup check, removal note, and dedup key set each have their own try/catch — failures in one never block the others.
- ~~`modLog` is omitted from Devvit's `TriggerContext` type but is available at runtime; accessed via a targeted cast (same pattern as `nuke.ts`).~~ **Incorrect (verified 2026-09-10):** `modLog` isn't available at runtime in `@devvit/public-api` 0.12.14+. The unit tests pass only because they mock `context.modLog`.
- Since 2026-10-18 the reason is attached with `comment.addRemovalNote({ reasonId: "", modNote: "[botditor] <reason>" })`. `reasonId: ""` attaches no subreddit removal reason, so nothing is sent to the user. Tests mock `addRemovalNote` on the comment object, the real API, instead of `modLog`.
- Unit tests cover removal notes (including truncation), dedup behaviour and its 7-day TTL, dry-run exclusions, and Redis failure resilience.
- Reddit's API enforces a **100-character limit** on the `reason` (report) and `description` (mod log) fields. A `truncateReason()` helper in `moderation.ts` clips any string that exceeds this limit, appending an `…` ellipsis. This is applied at both API boundaries (`reddit.report()` and `addRemovalNote()`), not at the AI layer, so internal logs still contain the full reason text.

Devvit hooks:
- `comment.remove()` — reused from `src/nuke.ts`
- `comment.addRemovalNote({ reasonId: '', modNote: truncateReason('[botditor] ' + reason) })` (replaces the removed `context.modLog.add()`)
- `context.reddit.report(comment, { reason: truncateReason('Botditor: ' + reason) })` — flag action
- `context.redis.set(`removed:${commentId}`, '1')` — deduplication
- `context.redis.get(`removed:${commentId}`)` — dedup check before removal

Edge cases:
- Comment already removed by another mod before the app acts: `comment.remove()` is idempotent; catch and log any error.
- Comment already auto-removed on a previous event delivery: dedup key in Redis prevents re-removal.
- Removal of a top-level comment that spawns child comments: only the specific comment is targeted; use Story 01's nuke logic only when explicitly invoked by a moderator.
- App setting `dryRun` toggled on mid-flight: check the setting at action time, not at trigger time.
- Mod log write fails: logged as error, removal still counts as successful.
- Redis dedup read fails: logged as error, removal proceeds anyway (fail-open).
- AI-generated reason exceeds 100 characters: `truncateReason()` clips to 99 chars + `…` before sending to Reddit APIs, preventing gRPC `TOO_LONG` errors.

Dependencies: Story 01 (Comment Ingestion), Story 02 (AI scores), Story 06 (thresholds).
