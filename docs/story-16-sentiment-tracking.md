# Story 16: Sentiment Tracking

Status: ✅ Keep — moved to Nice-to-Have; provides community health insight but depends on sufficient analytics infrastructure from Stories 13/14.

Feature area: Nice-to-Have

Story:
As a moderator, I want daily sentiment metrics tracked over time so that I can see whether the community's tone is improving or worsening and adjust moderation accordingly.

Acceptance criteria:
- Each analyzed comment's `sentiment` value (`positive`, `neutral`, `negative`) is stored as a daily counter in `kvStore` (e.g., `sentiment:positive:2025-06-01`).
- The toxicity snapshot (Story 13) and stats command (Story 14) include a 7-day sentiment trend summary: percentage positive, neutral, and negative per day.
- No dedicated UI is required; sentiment data is surfaced through existing reporting stories.
- Data is retained for 30 days; older counters are deleted to manage `kvStore` size.

Feasibility rating: Medium

Justification:
Daily counter increments are low-cost `kvStore` writes. The `sentiment` field comes for free from the Story 02 Gemini response, so no additional API call is needed. Rollup and retention management add implementation complexity.

Devvit hooks:
- `context.kvStore.set(`sentiment:${sentiment}:${dateKey}`, count)` on each analyzed comment
- Read in Stories 13 and 14 to display trend

Edge cases:
- `kvStore` size limits: use daily rollup keys, not per-comment entries, to keep key count manageable.
- Sentiment field missing from AI response: default to `neutral` and log.

Dependencies: Story 02 (sentiment field in AI response), Stories 13 and 14 (consumption of sentiment data). Story 20 (Scheduled Metrics Aggregation) could automate the 30-day retention cleanup.
