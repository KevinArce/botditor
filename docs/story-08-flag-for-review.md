# Story 08: Flag for Manual Review

Feature area: Moderation Actions and Rules

Story:
As a moderator, I want suspicious comments flagged, so that I can review them in a queue.

Acceptance criteria:
- Flagging adds a clear marker or report.
- A moderator can see flagged items in a dedicated view.

Feasibility rating: Medium

Justification:
Requires a review queue mechanism in Devvit.

Implementation notes:
- Use mod reports if available.
- Alternatively, store IDs in app storage and render a review list UI.
