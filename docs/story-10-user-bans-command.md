# Story 10: User Bans via Command

Status: ✅ Implemented — menu-based ban action with pre-filled confirmation form.

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
- User already banned: catch the API error (`ALREADY_BANNED`) and show a toast indicating the user is already banned.
- Mod has insufficient permissions: check `user.getModPermissionsForSubreddit()` before executing; require `all` or `access`.
- Target is a moderator: catch the API error (`CANT_RESTRICT_MODERATOR`) and show a toast: "u/X is a moderator and cannot be banned."
- Ban reason exceeds 100 characters: the Gemini-generated reason can exceed Reddit's `ban_reason` field limit; truncate to 100 characters before calling the API.

Limitation: In-thread text command `!botditor ban @user` is removed from scope. Comment text parsing is unreliable and creates ambiguity with legitimate comment content.

Conflicts: README.md previously documented `!botditor ban @user` — updated to reflect the menu-based approach.

Dependencies: Story 06 (moderation settings), existing `nuke.ts` permission check pattern.

Implementation notes:
- Module: `src/bans.ts` — `handleBanUser()` with permission check → `banUser()` → mod log → Redis analytics.
- Form: registered in `src/main.ts` via `Devvit.createForm()` with dynamic data pre-fill.
- Analytics: ban records persisted under `ban:<user>:<epoch>` key; per-subreddit counter at `bans:count:<sub>`.
- Tests: `src/__tests__/bans.test.ts` — 13 unit tests covering happy path, permissions, error handling.
