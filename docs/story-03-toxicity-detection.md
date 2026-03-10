# Story 03: Toxicity Detection

Feature area: Core Ingestion and Analysis

Story:
As a moderator, I want toxic comments detected, so that they can be flagged or removed quickly.

Acceptance criteria:
- Toxicity score is computed per comment.
- A threshold determines whether to remove, warn, or ignore.
- Actions are logged in the modlog.

Feasibility rating: Medium

Justification:
Requires AI analysis and policy alignment for false positives.

Implementation notes:
- Start with flag-only mode before auto-removal.
- Provide per-subreddit thresholds in settings.
- Record a brief reason string for auditability.
