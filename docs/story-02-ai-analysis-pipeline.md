# Story 02: AI Analysis Pipeline

Feature area: Core Ingestion and Analysis

Story:
As a moderator, I want comments analyzed by an external AI model, so that moderation signals are more accurate than simple rules.

Acceptance criteria:
- The app can call a configurable AI provider for comment scoring.
- API keys are stored securely and are not in source control.
- Failures fall back to a safe default (no action).

Feasibility rating: Medium

Justification:
Depends on outbound HTTP and key storage support.

Implementation notes:
- Add app settings for model provider, model name, and thresholds.
- Cache or memoize responses to reduce cost.
- Add timeout and retry limits with safe fallback behavior.
