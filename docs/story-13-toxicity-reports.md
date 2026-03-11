# Story 13: Toxicity Reports

Status: ⚠️ Scope Down — periodic scheduled toxicity reports require a reliable scheduler and persistent aggregation; scoped to an on-demand toxicity snapshot to reduce implementation risk while delivering immediate value.

Feature area: Analytics

Story (scoped):
As a moderator, I want an on-demand toxicity snapshot accessible via a menu action so that I can see current trend metrics without waiting for a scheduled report.

Acceptance criteria:
- A "View Toxicity Snapshot" menu item appears on the subreddit or on posts for moderators.
- The snapshot displays:
  - Total comments analyzed (lifetime and last 7 days)
  - Auto-removed count (last 7 days)
  - Flagged-for-review count (last 7 days)
  - Toxicity rate % (removed / analyzed, last 7 days)
  - Spam removal count (last 7 days)
  - Top flagged authors (up to 5, by flag count)
- All metrics are sourced from `kvStore` counters updated in real time as actions are taken.
- If no data exists yet, a "No data collected yet — processing will begin on the next comment" message is shown.

Feasibility rating: Medium

Justification:
`kvStore` counters are incremented on each action (removal, flag, warning). Reading and formatting them on demand is low-cost and has no scheduling dependencies. A future Story 20 (Scheduled Metrics Aggregation) can extend this with scheduled rollups.

Devvit hooks:
- `Devvit.addMenuItem({ label: 'View Toxicity Snapshot', location: 'subreddit', forUserType: 'moderator' })`
- `context.kvStore.get('stats:removed:7d')` etc.
- `context.ui.showToast(...)` or a form modal for display

Edge cases:
- `kvStore` read failure: show a "Stats temporarily unavailable" message.
- Counters overflow (very active subreddit): use string-based numeric storage and parse safely.

Limitation: Scheduled weekly email/report digest is out of scope until Devvit's scheduler API is confirmed stable for long-running aggregation jobs.

Dependencies: Stories 03, 04, 07, 08 must write counter increments to `kvStore` for this story to have data. Story 20 (gap story) extends this with scheduled aggregation.
