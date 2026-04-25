# Story 09: Warning Messages

Status: ✅ Implemented

Feature area: Core Moderation

Story (scoped):
As a moderator, I want the app to create a modmail draft warning pre-filled with the user, reason, and subreddit rules reference so that I can review and send it manually rather than writing it from scratch.

Acceptance criteria:
- ✅ When a comment is flagged (not auto-removed), the app sends a warning PM via `context.reddit.sendPrivateMessage()` addressed to the comment author.
- ✅ The message includes: the author's username, a configurable warning template, the detected issue (toxicity/spam), and a link to the subreddit rules.
- ✅ Warning templates are configurable in App Settings — a `strict` template (formal tone) and a `chill` template (informal tone) matching Story 15.
- ✅ Templates support `{{username}}`, `{{issue}}`, and `{{rulesLink}}` placeholders.
- ✅ A warning cooldown per user is tracked in Redis (`warned:<authorName>`); if a warning was sent for the same user in the last 48 hours, a new warning is not sent (a note is logged instead).
- ✅ Warnings are logged in Redis with timestamp for the stats command (Story 14).
- ✅ Dry-run mode is respected — logs but does not send.

Implementation details:

API used:
- `context.reddit.sendPrivateMessage({ to: username, subject, text })` — simpler and more reliable than `modMail.createConversation()` across all subreddit permission levels.
- `context.reddit.getCommentById(commentId)` — resolves the actual display username, since the `CommentSubmit` event may supply an internal user ID (`t2_xxx`).
- `context.redis.get/set/expire` — 48-hour cooldown tracking per user.

Module: `src/warnings.ts`

Settings:
- `warningTemplateStrict` — PM body for the strict moderation profile.
- `warningTemplateChill` — PM body for the chill moderation profile.

Redis keys:
- `warned:<authorName>` — cooldown key with 48-hour TTL, stores `{ commentId, issue, profile, timestamp }`.

Edge cases handled:
- User has disabled direct messages: `sendPrivateMessage` throws → caught, logged, returns `"none"`.
- Username resolution failure: falls back to the `authorName` from the event payload.
- Redis down for cooldown check: proceeds with warning (fail-open pattern).
- Redis down for cooldown write: PM already sent, logs error but returns `"warned"`.
- Same user flagged twice in 48h: cooldown key blocks second warning; log note emitted.
- Comment flagged by both toxicity and spam: first flag triggers warning; second sees cooldown.

Dependencies: Story 08 (flag triggers warning flow), Story 06 (which profile determines template), Story 15 (moderation profiles).
