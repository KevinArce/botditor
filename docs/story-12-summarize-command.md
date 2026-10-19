# Story 12: Summarize Command

Status: ⬜ Not started — deferred to P3 with Story 11. Scoped to a moderator menu action on posts: text commands (`!botditor summarize`) can't be told apart from ordinary comments without fragile parsing.

Feature area: AI Analysis

Story (scoped):
As a moderator, I want a "Summarize Thread" menu action on posts so that I can request an AI summary on demand without typing a command in the thread.

Acceptance criteria:
- A "Summarize Thread" menu item appears on posts for moderators only.
- Pressing it invokes the thread summarization pipeline (Story 11) for that post.
- The summary is displayed in a Devvit toast or modal dialog — it is not posted as a comment unless the moderator explicitly confirms.
- A "Post as mod comment" option in the confirmation form lets the moderator choose to share the summary publicly.
- The action respects the `enabled` setting from Story 06.

Feasibility rating: High

Justification:
`Devvit.addMenuItem({ location: 'post', forUserType: 'moderator' })` is the established pattern (see `src/main.ts`). It is reliable, requires no text parsing, and is invisible to regular users.

Devvit hooks:
- `Devvit.addMenuItem({ label: 'Summarize Thread', location: 'post', forUserType: 'moderator', onPress })`
- `Devvit.createForm(...)` — show summary result with "Post as mod comment" option
- `context.reddit.submitComment({ ...  })` if moderator confirms posting

Limitation: The `!botditor summarize` text-command interface described in the README is removed from scope. Text command parsing creates an ambiguity risk and adds unnecessary complexity.

Conflicts: README.md documents `!botditor summarize` as a command — this should be updated to describe the menu action.

Dependencies: Story 11 (Thread Summarization) is a prerequisite.
