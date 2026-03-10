# Story 11: Thread Summarization

Feature area: Summarization

Story:
As a moderator, I want to summarize long threads, so that I can quickly understand the discussion.

Acceptance criteria:
- A summary is generated for a post or comment thread.
- Summaries are limited to a set length and include top points.
- Failures provide a fallback message.

Feasibility rating: Medium

Justification:
Needs AI integration and careful context truncation.

Implementation notes:
- Summarize top-level comments only by default.
- Provide a max token budget and truncate with a clear note.
