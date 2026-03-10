# Story 06: Auto-Moderation Rules

Feature area: Moderation Actions and Rules

Story:
As a moderator, I want configurable rules that determine actions, so that moderation aligns with my subreddit’s policies.

Acceptance criteria:
- Rules can be configured via an app settings UI.
- Rules support thresholds for toxicity, spam, and bot-likelihood.
- Rule changes take effect without redeploy.

Feasibility rating: High

Justification:
Configuration UI and rule evaluation are standard.

Implementation notes:
- Use Devvit settings to store thresholds.
- Validate inputs and provide sensible defaults.
