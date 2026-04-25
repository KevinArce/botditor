# Story 08: Flag for Manual Review

Status: 🚀 Implemented

Feature area: Core Moderation

Story:
As a moderator, I want suspicious comments flagged automatically so that I can review them in the Reddit mod queue without missing anything.

Acceptance criteria:
- ✅ When a score is above the flag threshold but below the remove threshold, the comment is reported via the Reddit API with a structured reason string.
- ✅ The report reason includes the score type, score value, and Gemini reason (e.g., `"[botditor] toxicity=0.72 — possibly offensive but below auto-remove threshold"`).
- ✅ Flagged comment IDs and their scores are stored in Redis (`flagged:<commentId>`) for use by the stats command (Story 14).
- ✅ Moderators can see flagged items in the standard Reddit mod queue (reports tab) — no custom UI is required.
- ✅ A single comment is not reported more than once by the app within a 24-hour window.

Feasibility rating: High

Justification:
Reddit's mod report system (`comment.report()` or the reddit API equivalent) is accessible through Devvit. The mod queue is the natural review surface for moderators and requires no additional UI.

Implementation notes:
- All Story 08 logic lives in `src/moderation.ts`, inside the `flagComment()` helper.
- `enforceToxicityInner()` and `enforceSpamInner()` build structured reason strings (`[botditor] toxicity=<score> — <reason>` / `[botditor] spam=<score> — <reason>`) and pass them to `flagComment()`.
- `flagComment()` follows the same three-section pattern as `removeComment()` (Story 07): dedup check → API call → Redis persistence. Each section has its own try/catch — failures in one never block the others.
- Deduplication: before reporting, `flagComment()` reads `flagged:<commentId>` from Redis. If the key exists (set by a prior flag within 24 hours), the report is skipped.
- Persistence: on successful report, `{ score, reason, timestamp }` is stored as JSON in `flagged:<commentId>` with a 24-hour TTL via `context.redis.expire()`. This data is available for Story 14's stats command.
- The `truncateReason()` helper (shared with Story 07) clips the reason string to Reddit's 100-character limit before passing it to `context.reddit.report()`.
- 7 unit tests cover structured reason format, Redis persistence, 24h TTL, dedup behavior, dry-run exclusions, and Redis failure resilience.

Devvit hooks:
- `context.reddit.report(comment, { reason: truncateReason('[botditor] toxicity=0.72 — reason') })` — flag action
- `context.redis.set('flagged:<commentId>', JSON.stringify({ score, reason, timestamp }))` — persistence + deduplication
- `context.redis.expire('flagged:<commentId>', 86400)` — 24-hour TTL
- `context.redis.get('flagged:<commentId>')` — deduplication check

Edge cases:
- Comment deleted before report is submitted: catch the error, log, and skip.
- Moderator already reported the same comment manually: duplicate reports are harmless in the mod queue.
- High-volume flag burst (many comments in a short window): each flag is independent; no batching issues.
- Redis dedup read fails: logged as error, flag proceeds anyway (fail-open).
- Redis persistence write fails: logged as error, flag still counts as successful (report was already submitted).
- AI-generated reason exceeds 100 characters: `truncateReason()` clips to 99 chars + `…` before sending to Reddit API.

Dependencies: Story 02 (scores), Story 06 (thresholds), Story 14 (stats consume flagged count).
