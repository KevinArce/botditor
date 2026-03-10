# Story 21: User Moderation History Panel (Gap Story)

Status: ✅ New — identified via gap analysis; Devvit supports custom UI panels and `kvStore` user-level data, enabling per-user moderation history without navigating away from the thread.

Feature area: Core Moderation

Story:
As a moderator, I want a quick-view panel of a user's recent moderation actions in this subreddit so that I can make informed decisions (warn, ban, ignore) without leaving the current thread.

Acceptance criteria:
- A "User Mod History" menu action is available on comments for moderators.
- The panel displays for the comment's author:
  - Number of comments auto-removed (all time in this subreddit)
  - Number of times flagged for review
  - Number of warnings issued
  - Whether the user is on the allow-list (Story 23)
  - Date of first and most recent moderation action
  - Last toxicity score and reason (most recent analyzed comment)
- Data is read from `kvStore` using the author's username as the key prefix.
- The panel is displayed as a Devvit form modal (read-only).
- A "Add to Allow-list" button is available directly from the panel (Story 23).

Feasibility rating: High

Justification:
All data is sourced from `kvStore` records written by other stories. `Devvit.addMenuItem` and `Devvit.createForm` are proven patterns in `src/main.ts`. No external API calls are required for the panel itself, making it fast and reliable.

Devvit hooks:
- `Devvit.addMenuItem({ label: 'User Mod History', location: 'comment', forUserType: 'moderator', onPress })`
- `context.kvStore.get(`user:${authorName}:removed`)` etc.
- `Devvit.createForm(...)` for the read-only display panel

Edge cases:
- No moderation history for the user: display "No moderation history for this user in this subreddit."
- Username with special characters: sanitize as `kvStore` key (encode or hash).
- High-activity user with large history: display only the most recent 10 actions; no pagination needed.

Dependencies: Stories 03, 04, 07, 08, 09, 10 write per-user `kvStore` entries that this story reads. Story 23 (Allow-list) is accessible from this panel.
