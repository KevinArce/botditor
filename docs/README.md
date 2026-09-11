# Botditor Docs Index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the app works today: pipeline, settings, Redis keys, external services, tooling pitfalls, known limitations.
- [BACKLOG.md](./BACKLOG.md) — prioritized action items (OPS / COR / POL / PLAT), verified story status, dependency map.

Story statuses below were verified against the code on 2026-09-10. Legend: ✅ Done · 🟡 Partial · 🔧 In progress · ⬜ Not started · 🚫 Re-scoped.

## Core Moderation
- [story-01-comment-ingestion.md](./story-01-comment-ingestion.md) — ✅ Done
- [story-23-configurable-allowlist.md](./story-23-configurable-allowlist.md) — ✅ Done (comments; posts arrive with Story 19)
- [story-06-auto-moderation-rules.md](./story-06-auto-moderation-rules.md) — ✅ Done (range validation pending: COR-2)
- [story-03-toxicity-detection.md](./story-03-toxicity-detection.md) — 🟡 Partial (mod-log reason: OPS-3)
- [story-04-spam-detection.md](./story-04-spam-detection.md) — 🟡 Partial (AI spam score not enforced: COR-3)
- [story-05-bot-detection.md](./story-05-bot-detection.md) — ⬜ Not started
- [story-07-auto-remove-comments.md](./story-07-auto-remove-comments.md) — 🟡 Partial (mod-log entry: OPS-3)
- [story-08-flag-for-review.md](./story-08-flag-for-review.md) — ✅ Done
- [story-09-warning-messages.md](./story-09-warning-messages.md) — ✅ Done (policy question: POL-1)
- [story-10-user-bans-command.md](./story-10-user-bans-command.md) — 🟡 Partial (mod-log / acting moderator: OPS-3)
- [story-15-moderation-styles.md](./story-15-moderation-styles.md) — 🟡 Partial (template selection only; no threshold presets)
- [story-19-post-level-analysis.md](./story-19-post-level-analysis.md) — ⬜ Not started
- [story-21-user-moderation-history-panel.md](./story-21-user-moderation-history-panel.md) — ⬜ Not started
- [story-22-comment-flair-on-detection.md](./story-22-comment-flair-on-detection.md) — 🚫 Re-scoped to mod notes (comment flair doesn't exist)

## AI Analysis
- [story-02-ai-analysis-pipeline.md](./story-02-ai-analysis-pipeline.md) — ✅ Done (restored and hardened by OPS-1; pending one live playtest)
- [story-11-thread-summarization.md](./story-11-thread-summarization.md) — ⬜ Not started
- [story-12-summarize-command.md](./story-12-summarize-command.md) — ⬜ Not started (menu action, not text command)

## Analytics
- [story-13-toxicity-reports.md](./story-13-toxicity-reports.md) — ⬜ Not started (needs ANL-0 counters)
- [story-14-subreddit-stats-command.md](./story-14-subreddit-stats-command.md) — ⬜ Not started (needs ANL-0 counters)
- [story-20-scheduled-metrics-aggregation.md](./story-20-scheduled-metrics-aggregation.md) — ⬜ Not started

## Nice-to-Have
- [story-16-sentiment-tracking.md](./story-16-sentiment-tracking.md) — ⬜ Not started
- [story-17-meme-based-responses.md](./story-17-meme-based-responses.md) — ⬜ Not started (text templates only)
- [story-18-discord-integration.md](./story-18-discord-integration.md) — ⬜ Not started (opt-in webhook)

> Stories written before Devvit 0.13 say `kvStore`; read that as **Redis** (`kvStore` was removed and the code uses Redis).
