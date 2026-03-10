# Story 10: User Bans via Command

Feature area: Moderation Actions and Rules

Story:
As a moderator, I want a command to ban users, so that I can act quickly in-thread.

Acceptance criteria:
- `!botditor ban @user` triggers a ban request.
- The action requires moderator permissions.
- Actions are logged.

Feasibility rating: Medium

Justification:
Depends on whether Devvit exposes ban endpoints to mod tools.

Implementation notes:
- If direct ban is blocked, send a modmail or create a mod action request.

Modified story:
As a moderator, I want the app to open a ban request form pre-filled with user and reason, so that I can confirm the ban manually.
