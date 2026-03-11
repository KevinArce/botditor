# Story 23: Configurable Allow-list (Gap Story)

Status: ✅ New — identified via gap analysis; false positives from trusted contributors are a core risk for any automated moderation tool, and no existing story addresses suppressing them.

Feature area: Core Moderation

Story:
As a moderator, I want to maintain an allow-list of trusted users and domains so that false positives from established contributors or official sources are automatically suppressed and do not trigger moderation actions.

Acceptance criteria:
- An allow-list of usernames is stored in `kvStore` and manageable via:
  - A "Add to Allow-list" menu action on comments (moderators only).
  - A "Remove from Allow-list" menu action on comments for already-listed users.
  - Direct management via a dedicated Devvit settings field (comma-separated usernames).
- A domain allow-list is stored in App Settings as a comma-separated list of trusted domains (e.g., `reddit.com,en.wikipedia.org`).
- When a comment or post is processed and the author is on the allow-list, all AI analysis and moderation actions are skipped; a no-op is logged.
- When a URL in a comment matches a domain on the domain allow-list, the URL-based spam heuristics (Story 04) are suppressed for that URL.
- Allow-list reads happen at the start of each trigger invocation before any AI call, to save API cost.
- The bot's own username is always treated as implicitly allow-listed to prevent self-analysis loops.

Feasibility rating: High

Justification:
`kvStore` key-value storage is the natural home for per-user allow-list entries. Devvit menu items and settings fields make it manageable without a custom UI. This story is foundational for reducing false positives across all analysis stories.

Devvit hooks:
- `context.kvStore.get(`allowlist:user:${username}`)` — check at trigger start
- `context.kvStore.set(`allowlist:user:${username}`, '1')` — add user to allow-list
- `context.kvStore.delete(`allowlist:user:${username}`)` — remove user from allow-list
- `Devvit.addMenuItem({ label: 'Add to Allow-list', location: 'comment', forUserType: 'moderator', onPress })`
- `Devvit.addSettings([{ name: 'allowedDomains', type: 'string', label: 'Allowed domains (comma-separated)' }])`

Edge cases:
- Allow-list read fails: fail open (proceed with analysis) and log the error, to avoid silently bypassing moderation on a `kvStore` outage.
- Username case sensitivity: normalize all usernames to lowercase before storing and looking up.
- Bulk allow-list import (e.g., migrating from another tool): provide a settings field for comma-separated usernames as a bulk import mechanism.

Dependencies: Stories 01 and 19 check the allow-list at trigger start. Story 04 uses the domain allow-list for spam heuristics. Story 21 (User Mod History Panel) links to this story for adding users from the history view.
