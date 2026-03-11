# Story 08: Flag for Manual Review

Status: ✅ Keep & Enrich

Feature area: Core Moderation

Story:
As a moderator, I want suspicious comments flagged automatically so that I can review them in the Reddit mod queue without missing anything.

Acceptance criteria:
- When a score is above the flag threshold but below the remove threshold, the comment is reported via the Reddit API with a structured reason string.
- The report reason includes the score type, score value, and Gemini reason (e.g., `"[botditor] toxicity=0.72 — possibly offensive but below auto-remove threshold"`).
- Flagged comment IDs and their scores are stored in `kvStore` for use by the stats command (Story 14).
- Moderators can see flagged items in the standard Reddit mod queue (reports tab) — no custom UI is required.
- A single comment is not reported more than once by the app within a 24-hour window.

Feasibility rating: High

Justification:
Reddit's mod report system (`comment.report()` or the reddit API equivalent) is accessible through Devvit. The mod queue is the natural review surface for moderators and requires no additional UI.

Devvit hooks:
- `context.reddit.report(commentId, reason)` or equivalent report API
- `context.kvStore.set(`flagged:${commentId}`, JSON.stringify({ score, reason, timestamp }))` 
- `context.kvStore.get(`reported:${commentId}`)` — deduplication check

Edge cases:
- Comment deleted before report is submitted: catch the error, log, and skip.
- Moderator already reported the same comment manually: duplicate reports are harmless in the mod queue.
- High-volume flag burst (many comments in a short window): each flag is independent; no batching issues.

Dependencies: Story 02 (scores), Story 06 (thresholds), Story 14 (stats consume flagged count).
