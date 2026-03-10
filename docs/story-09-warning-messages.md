# Story 09: Warning Messages

Status: ⚠️ Scope Down — automatic modmail sending requires elevated permissions and is not reliably available in all Devvit deployments; scoped to creating a modmail draft that the moderator reviews and sends manually.

Feature area: Core Moderation

Story (scoped):
As a moderator, I want the app to create a modmail draft warning pre-filled with the user, reason, and subreddit rules reference so that I can review and send it manually rather than writing it from scratch.

Acceptance criteria:
- When a comment is flagged (not auto-removed), the app creates a modmail draft via the Reddit API addressed to the comment author.
- The draft includes: the author's username, a configurable warning template, the detected issue (toxicity/spam), and a link to the subreddit rules.
- Warning templates are configurable in App Settings (at minimum a `strict` template and a `chill` template matching Story 15).
- A warning cooldown per user is tracked in `kvStore`; if a warning draft was created for the same user in the last 48 hours, a new draft is not created (a note is logged instead).
- Warnings are logged in `kvStore` with timestamp for the stats command (Story 14).

Feasibility rating: Medium

Justification:
Devvit exposes `context.reddit.sendPrivateMessage()` for direct messages, and modmail via `context.reddit.modMail.createConversation()`. Actual sending may require elevated mod privileges. Creating the draft via the modmail API and letting the moderator review is the safer approach that works across all subreddit permission levels.

Devvit hooks:
- `context.reddit.modMail.createConversation(...)` or `context.reddit.sendPrivateMessage({ to: username, subject, text })`
- `context.kvStore.get(`warned:${authorName}`)` / `context.kvStore.set(...)`

Edge cases:
- User has disabled direct messages: the modmail API should still work; catch any delivery errors and log.
- User is banned before warning is sent: skip if user is already banned.

Limitation: Fully automated warning delivery without moderator review is deferred until modmail permissions are clarified for all subreddit configurations.

Dependencies: Story 08 (flag triggers warning flow), Story 06 (which profile determines template), Story 15 (moderation profiles).
