# Story 09: Warning Messages

Feature area: Moderation Actions and Rules

Story:
As a moderator, I want the app to warn users, so that they can correct behavior before a ban.

Acceptance criteria:
- Warning templates are configurable.
- Warnings are sent only once per user per time window.
- Warnings are logged.

Feasibility rating: Medium

Justification:
Depends on ability to send modmail or bot replies.

Implementation notes:
- Prefer modmail or comment replies if allowed.
- Track warning history in app storage.

Modified story:
As a moderator, I want the app to create a modmail draft for warnings, so that I can review and send it manually.
