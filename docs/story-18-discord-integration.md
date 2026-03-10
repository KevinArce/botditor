# Story 18: Discord Integration

Feature area: Future Integrations

Story:
As a moderator, I want moderation alerts sent to Discord, so that my team is notified outside Reddit.

Acceptance criteria:
- Alerts are sent to a configurable channel.
- Sensitive data is redacted.

Feasibility rating: Low

Justification:
Outbound HTTP and webhook support may be restricted.

Implementation notes:
- Provide a manual "copy alert" UI as fallback.

Modified story:
As a moderator, I want a copyable alert summary, so that I can paste it into Discord manually.
