# Botditor Docs Index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the app works today: pipeline, AI providers, settings, Redis keys, external services, tooling notes, known limitations.
- [BACKLOG.md](./BACKLOG.md) — prioritized action items (OPS / AI / COR / POL / PLAT), verified story status with recommendations, dependency map, Devvit Web migration map.

Story statuses below were verified against the code on 2026-10-18. Legend: ✅ Done · 🟡 Partial · ⬜ Not started · 🚫 Re-scoped / dropped · 🔍 needs a live playtest.

## Core Moderation
- [story-01-comment-ingestion.md](./story-01-comment-ingestion.md) — ✅ 🔍 Done (atomic dedup, 30-day retention, username from `event.author`)
- [story-23-configurable-allowlist.md](./story-23-configurable-allowlist.md) — ✅ Done (comments; posts arrive with Story 19)
- [story-06-auto-moderation-rules.md](./story-06-auto-moderation-rules.md) — ✅ Done (range/enum validation, one settings RPC per comment)
- [story-03-toxicity-detection.md](./story-03-toxicity-detection.md) — ✅ 🔍 Done (removal notes carry the reason)
- [story-04-spam-detection.md](./story-04-spam-detection.md) — ✅ Done (rule heuristics + AI score blend)
- [story-05-bot-detection.md](./story-05-bot-detection.md) — 🟡 Partial (AI bot-likelihood reports done; behavioural heuristics pending)
- [story-07-auto-remove-comments.md](./story-07-auto-remove-comments.md) — ✅ 🔍 Done (removal note, 7-day dedup)
- [story-08-flag-for-review.md](./story-08-flag-for-review.md) — ✅ Done
- [story-09-warning-messages.md](./story-09-warning-messages.md) — ✅ Done (policy question: POL-1)
- [story-10-user-bans-command.md](./story-10-user-bans-command.md) — ✅ 🔍 Done (correct ban fields, acting moderator recorded)
- [story-15-moderation-styles.md](./story-15-moderation-styles.md) — 🟡 Re-scoped to warning tone only (threshold presets blocked by registered defaults)
- [story-19-post-level-analysis.md](./story-19-post-level-analysis.md) — ⬜ Not started (planned for v2.0)
- [story-21-user-moderation-history-panel.md](./story-21-user-moderation-history-panel.md) — ⬜ Not started (needs ANL-0)
- [story-22-comment-flair-on-detection.md](./story-22-comment-flair-on-detection.md) — 🚫 Re-scoped to mod notes (comment flair doesn't exist)

## AI Analysis
- [story-02-ai-analysis-pipeline.md](./story-02-ai-analysis-pipeline.md) — ✅ 🔍 Done (Gemini in the app; TypeSafe Jev compared offline via `npm run bench`, POL-3)
- [story-11-thread-summarization.md](./story-11-thread-summarization.md) — ⬜ Deferred (P3)
- [story-12-summarize-command.md](./story-12-summarize-command.md) — ⬜ Deferred (P3; depends on 11)

## Analytics
- [story-13-toxicity-reports.md](./story-13-toxicity-reports.md) — ⬜ Blocked on ANL-0 counters
- [story-14-subreddit-stats-command.md](./story-14-subreddit-stats-command.md) — ⬜ Blocked on ANL-0 counters
- [story-20-scheduled-metrics-aggregation.md](./story-20-scheduled-metrics-aggregation.md) — ⬜ Blocked on ANL-0 counters
- [story-16-sentiment-tracking.md](./story-16-sentiment-tracking.md) — ⬜ Sentiment stored per comment; aggregation needs ANL-0

## Nice-to-Have
- [story-18-discord-integration.md](./story-18-discord-integration.md) — ⬜ Re-evaluate (opt-in webhook; extra fetch domain + privacy disclosure)
- [story-17-meme-based-responses.md](./story-17-meme-based-responses.md) — 🚫 Dropped (2026-10-18)

> Stories written before Devvit 0.13 say `kvStore`; read that as **Redis** (`kvStore` was removed and the code uses Redis).
