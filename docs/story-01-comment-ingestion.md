# Story 01: Comment Ingestion

Feature area: Core Ingestion and Analysis

Story:
As a moderator, I want the app to process new comments automatically, so that problematic content is detected quickly.

Acceptance criteria:
- New comments trigger analysis without manual menu action.
- Processing failures are logged and do not block other comments.
- The app can be disabled per subreddit.

Feasibility rating: Medium

Justification:
Requires Devvit comment triggers and careful rate limiting.

Implementation notes:
- Use Devvit comment event handlers.
- Add a throttle or queue to avoid rate limit bursts.
- Provide a per-subreddit toggle in app settings.
