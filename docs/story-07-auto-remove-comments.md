# Story 07: Auto-Remove Rule-Breaking Comments

Feature area: Moderation Actions and Rules

Story:
As a moderator, I want the app to remove comments that violate rules, so that the sub stays clean.

Acceptance criteria:
- Removals happen only when confidence exceeds a threshold.
- Every removal logs to modlog with reason.
- A "dry run" mode exists.

Feasibility rating: High

Justification:
Removal is already supported by the existing mop logic.

Implementation notes:
- Reuse comment removal APIs used in /Users/arce/Projects/botditor/src/nuke.ts.
- Implement a dry-run flag that only logs actions.
