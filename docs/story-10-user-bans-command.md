# Story 10: User Bans via Command

Status: ⚠️ Scope Down — direct ban-by-comment-command introduces moderation safety risks; scoped to a moderator-initiated menu action that pre-fills and confirms a ban request.

Feature area: Core Moderation

Story (scoped):
As a moderator, I want a "Ban User" menu action on comments that opens a pre-filled confirmation form with the user, reason, and ban duration so that I can execute bans quickly without navigating away from the thread.

Acceptance criteria:
- A "Ban User" option appears in the comment action menu (moderators only).
- Pressing it opens a Devvit form pre-filled with: author username, ban reason (defaulting to the Gemini reason if the comment was analyzed), and a configurable default duration (default: permanent).
- On confirmation, the ban is executed via the Reddit API and logged to modlog.
- The action requires the acting user to have `ban` or `all` mod permissions; if not, an error toast is shown.
- Ban actions are logged in `kvStore` for analytics (Story 14).

Feasibility rating: Medium

Justification:
`context.reddit.banUser()` is available in Devvit. The form-based confirmation pattern is proven in the existing `nukeForm` implementation in `src/main.ts`. A comment-triggered text command (`!botditor ban @user`) is not scoped because Devvit comment triggers cannot reliably parse commands from arbitrary text.

Devvit hooks:
- `Devvit.addMenuItem({ label: 'Ban User', location: 'comment', forUserType: 'moderator', onPress })`
- `Devvit.createForm(...)` — pre-filled with author and reason
- `context.reddit.banUser({ subredditName, username, reason, duration })` (or equivalent API)
- `context.modLog.add({ action: 'banuser', ... })`

Edge cases:
- User already banned: catch the API error and show a toast indicating the user is already banned.
- Mod has insufficient permissions: check `user.getModPermissionsForSubreddit()` before executing.

Limitation: In-thread text command `!botditor ban @user` is removed from scope. Comment text parsing is unreliable and creates ambiguity with legitimate comment content.

Conflicts: README.md documents `!botditor ban @user` as a feature — this should be updated to reflect the menu-based approach.

Dependencies: Story 06 (moderation settings), existing `nuke.ts` permission check pattern.
