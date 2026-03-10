# Story 05: Bot Detection

Feature area: Core Ingestion and Analysis

Story:
As a moderator, I want likely bot accounts identified, so that I can review or ban them.

Acceptance criteria:
- A bot-likelihood score is produced with explainable signals.
- The app only flags, it does not auto-ban by default.
- A review list is generated for moderators.

Feasibility rating: Low-Medium

Justification:
Requires access to user history and risks false positives.

Implementation notes:
- Use conservative heuristics and provide manual review first.
- Provide a clear explanation of signals used.

Modified story:
As a moderator, I want the app to flag accounts exhibiting spam-like behavior in the last N comments, so that I can manually review them without relying on full account history.
