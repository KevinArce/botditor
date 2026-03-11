# Story 20: Scheduled Metrics Aggregation (Gap Story)

Status: ✅ New — identified via gap analysis; Devvit's scheduler API enables periodic background jobs, but no story currently uses it for analytics aggregation.

Feature area: Analytics

Story:
As a moderator, I want daily metrics automatically aggregated in the background so that the stats command (Story 14) and toxicity snapshot (Story 13) always reflect accurate rolling summaries without requiring a manual trigger.

Acceptance criteria:
- A Devvit scheduler job runs once per day (at midnight UTC) to aggregate the previous day's `kvStore` counters into a daily summary record.
- The daily summary includes: comments analyzed, removed (toxicity), removed (spam), flagged, warnings created, bans executed, and sentiment breakdown.
- Rolling 7-day and 30-day aggregates are pre-computed and stored so the stats command reads a single key rather than summing 7–30 individual keys.
- Counter keys older than 30 days are deleted during the daily job to manage `kvStore` size.
- If the scheduler job fails, the failure is logged and the previous aggregates are not overwritten.

Feasibility rating: Medium

Justification:
Devvit's `Devvit.addSchedulerJob()` and `context.scheduler.runJob()` APIs support periodic background execution. The aggregation logic is pure `kvStore` read/write with no AI calls. The main risk is the scheduler job timing out on very large subreddits; keeping the aggregation to counter summation (not comment-by-comment replay) keeps it fast.

Devvit hooks:
- `Devvit.addSchedulerJob({ name: 'dailyAggregation', onRun: handler })`
- `context.scheduler.runJob({ name: 'dailyAggregation', cron: '0 0 * * *' })`
- `context.kvStore.get` / `context.kvStore.set` / `context.kvStore.delete`

Edge cases:
- Scheduler job misses a day (e.g., app is uninstalled and reinstalled): gap days are recorded with `null` values rather than zero to distinguish missing data from zero activity.
- Clock skew across subreddit timezones: use UTC for all date keys.
- `kvStore` write failure during aggregation: log the error and retry on the next run rather than partially overwriting.

Dependencies: Stories 03, 04, 07, 08, 09, 10 write raw counters. Stories 13 and 14 read the pre-aggregated summaries. Story 16 (Sentiment Tracking) uses the daily aggregation job for retention cleanup.
