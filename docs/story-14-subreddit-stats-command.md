# Story 14: Subreddit Stats Command

Status: ✅ Keep & Enrich

Feature area: Analytics

Story:
As a moderator, I want a "Subreddit Stats" menu action that shows key moderation metrics so that I can check subreddit health at a glance.

Acceptance criteria:
- A "Subreddit Stats" menu item is available to moderators on the subreddit and posts.
- The stats panel displays:
  - Comments analyzed today and in the last 7 days
  - Auto-removal rate % (last 7 days)
  - Spam rate % (last 7 days)
  - Flag rate % (last 7 days)
  - Number of unique users warned (last 7 days)
  - Number of unique users banned via the app (last 7 days)
- Output is kept to a short display (fits in a modal form) to avoid information overload.
- Data is sourced from `kvStore` counters (same counters as Story 13).
- A "Refresh" action re-reads the counters (no caching delay).

Feasibility rating: Medium

Justification:
`kvStore` counter reads are fast. The menu item pattern is established. The main risk is `kvStore` key proliferation for daily counters; using date-keyed counters (e.g., `stats:removed:2025-06-01`) and reading the last 7 days is manageable.

Devvit hooks:
- `Devvit.addMenuItem({ label: 'Subreddit Stats', location: 'subreddit', forUserType: 'moderator', onPress })`
- `context.kvStore.get(...)` for each metric counter
- Form/toast display via `context.ui.showForm(...)` or `context.ui.showToast(...)`

Edge cases:
- No data yet (fresh install): display "No data yet" and prompt to wait for the first comment to be processed.
- Date rollover at midnight: use UTC-based date keys; partial-day counts are fine.

Conflicts: Overlaps with Story 13 (Toxicity Reports) — both read the same `kvStore` counters. These are intentionally complementary: Story 13 is a deeper toxicity-focused snapshot; Story 14 is a broader health dashboard. Both should be kept to serve different mental models.

Dependencies: Stories 03, 04, 07, 08, 09, 10 must write to `kvStore` counters. Story 13 shares the same data source.
