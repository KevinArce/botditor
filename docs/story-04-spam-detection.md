# Story 04: Spam Detection

Feature area: Core Ingestion and Analysis

Story:
As a moderator, I want spam comments detected, so that obvious spam is removed quickly.

Acceptance criteria:
- Spam score is computed per comment.
- Rule-based heuristics can run without AI.
- Actions are logged and reversible.

Feasibility rating: Medium-High

Justification:
Heuristics and simple ML are feasible within Devvit.

Implementation notes:
- Implement URL pattern checks and keyword heuristics first.
- Consider account age and comment rate signals.
- Provide a flag-only mode to validate thresholds.
