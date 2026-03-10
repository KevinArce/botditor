# Story 14: Subreddit Stats Command

Feature area: Analytics and Reporting

Story:
As a moderator, I want `!botditor stats` to show key metrics, so that I can check subreddit health quickly.

Acceptance criteria:
- Returns top metrics (toxicity %, spam %, flagged users).
- Works without blocking or timing out.

Feasibility rating: Medium

Justification:
Requires metrics storage and retrieval.

Implementation notes:
- Cache daily aggregates.
- Provide a limited output to avoid long responses.
