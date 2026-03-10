# Story 12: Summarize Command

Feature area: Summarization

Story:
As a moderator, I want `!botditor summarize` to generate a summary on demand, so that I can request it in-thread.

Acceptance criteria:
- Command is recognized in comments.
- Summary is posted as a reply or surfaced in mod UI.

Feasibility rating: Medium

Justification:
Requires command parsing and posting ability.

Implementation notes:
- Provide a mod-only UI fallback if replies are restricted.
