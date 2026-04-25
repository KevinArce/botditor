# Botditor — Refined Product Backlog

> **Platform**: Reddit Devvit v0.12.14  
> **AI Provider**: Google Gemini API (`gemini-1.5-flash`)  
> **Last updated**: 2026-03-10

---

## Changelog

### Implemented (🚀)
| Story | Notes |
|-------|-------|
| Story 01 — Comment Ingestion | Fully implemented. `CommentSubmit` trigger, enabled toggle, allowlist guard, self-comment guard, Redis persistence with duplicate detection, sanitization, and Story 02 dispatch stub. Also delivers partial Story 23 (allowlist service + menu actions). |
| Story 07 — Auto-Remove Comments | Fully implemented. Threshold-triggered auto-removal via `comment.remove()`, mod log entries with `botditor` details tag, Redis deduplication (`removed:<commentId>`), dry-run support, and fail-safe error handling. Lives in `src/moderation.ts`. |

### Kept & Enriched (✅)
| Story | Change |
|-------|--------|
| Story 02 — AI Analysis Pipeline | Specified `context.fetch()` + Gemini REST API, structured JSON response schema, schema validation, caching in `kvStore`, and full Gemini prompt template. |
| Story 03 — Toxicity Detection | Clarified three-threshold action model (remove / flag / ignore), `modLog` integration, dry-run reference, and edge cases for overrides and concurrent deletions. |
| Story 04 — Spam Detection | Expanded rule-based heuristics with concrete scoring deltas, combined with AI score for ambiguous cases, added domain block-list and account-age signals. |
| Story 06 — Auto-Moderation Rules | Listed all settings fields by name and type, added threshold validation logic, startup audit log. |
| ~~Story 07 — Auto-Remove Comments~~ | _Moved to Implemented._ |
| Story 08 — Flag for Manual Review | Upgraded to use Reddit's native report API; specified structured report reason format; added 24-hour dedup window. |
| Story 11 — Thread Summarization | Added Gemini prompt template, token budget strategy, top-50-comment selection, and post/delete edge cases. |
| Story 14 — Subreddit Stats | Clarified metric list, date-keyed counter strategy, and conflict/overlap note with Story 13. |
| Story 16 — Sentiment Tracking | Added 30-day retention policy, `kvStore` key format, and integration points with Stories 13/14. |

### Scoped Down (⚠️)
| Story | What changed | Reason |
|-------|-------------|--------|
| Story 05 — Bot Detection | Scoped to same-subreddit behavioral signals only; full account-history traversal removed. | Devvit cannot efficiently paginate full Reddit-wide user history within a per-event execution. |
| Story 09 — Warning Messages | Scoped to modmail draft creation; automatic sending deferred. | Reliable automated modmail requires elevated mod permissions not guaranteed across all subreddit configurations. |
| Story 10 — User Bans | Replaced text command `!botditor ban @user` with a menu-action confirmation form. | Comment-text command parsing in `CommentSubmit` triggers is unreliable and creates false-positive risk. |
| Story 12 — Summarize Command | Replaced `!botditor summarize` text command with a moderator menu item on posts. | Same unreliability concern as Story 10; menu items are the established Devvit pattern. |
| Story 13 — Toxicity Reports | Scoped to on-demand snapshot; scheduled digest deferred to Story 20. | Periodic scheduled reports require scheduler infrastructure; on-demand view delivers value sooner. |
| Story 15 — Moderation Style Profiles | Removed Comedy mode as a threshold profile; kept as a warning-template variant in Story 17. | Threshold-based Comedy mode is undefined; the humor is in the tone, not the thresholds. |
| Story 17 — Meme-Based Responses | Renamed to "Humorous Warning Templates"; image memes removed. | Devvit provides no API for bots to upload images to Reddit comments or posts. |
| Story 18 — Discord Integration | Upgraded from "copyable summary" fallback to opt-in Discord webhook via `context.fetch()`; copyable summary retained as fallback. | Outbound HTTP is supported in Devvit; webhook integration is feasible. Bi-directional integration remains out of scope. |

### Cut (❌)
_No stories were fully cut._ Story 18's original "copyable alert summary only" scope was upgraded to a real webhook integration because `context.fetch()` makes it feasible.

### Added via Gap Analysis (🆕)
| Story | Rationale |
|-------|-----------|
| Story 19 — Post-Level Analysis | `PostSubmit` trigger covers posts just as `CommentSubmit` covers comments; original backlog only addressed comments. |
| Story 20 — Scheduled Metrics Aggregation | Devvit scheduler enables daily counter rollups; without this, analytics stories read unbounded per-day keys. |
| Story 21 — User Moderation History Panel | Per-user `kvStore` data exists after action stories run; a summary panel reduces the need for mods to navigate externally. |
| Story 22 — Comment Flair on Detection | Comment flair API lets flagged content be visible inline in threads, improving moderator awareness without queue navigation. |
| Story 23 — Configurable Allow-list | No existing story suppresses false positives for trusted users; this is foundational for production reliability. |

---

## Backlog

### Core Moderation

| ID | Story | Status | Feasibility |
|----|-------|--------|-------------|
| 01 | Comment Ingestion | 🚀 Implemented | High |
| 23 | Configurable Allow-list | 🚀 Partially Implemented | High |
| 06 | Auto-Moderation Rules | ✅ Keep & Enrich | High |
| 03 | Toxicity Detection | ✅ Keep & Enrich | High |
| 04 | Spam Detection | ✅ Keep & Enrich | High |
| 05 | Bot Detection | ⚠️ Scoped Down | Medium |
| 07 | Auto-Remove Comments | 🚀 Implemented | High |
| 08 | Flag for Manual Review | ✅ Keep & Enrich | High |
| 09 | Warning Messages | ⚠️ Scoped Down | Medium |
| 10 | User Bans via Menu | ⚠️ Scoped Down | Medium |
| 15 | Moderation Style Profiles | ⚠️ Scoped Down | High |
| 19 | Post-Level Analysis | 🆕 New | High |
| 21 | User Moderation History Panel | 🆕 New | High |
| 22 | Comment Flair on Detection | 🆕 New | Medium |

### AI Analysis

| ID | Story | Status | Feasibility |
|----|-------|--------|-------------|
| 02 | AI Analysis Pipeline | ✅ Keep & Enrich | High |
| 11 | Thread Summarization | ✅ Keep & Enrich | High |
| 12 | Summarize Command (Menu) | ⚠️ Scoped Down | High |

### Analytics

| ID | Story | Status | Feasibility |
|----|-------|--------|-------------|
| 13 | Toxicity Reports (Snapshot) | ⚠️ Scoped Down | Medium |
| 14 | Subreddit Stats | ✅ Keep & Enrich | Medium |
| 20 | Scheduled Metrics Aggregation | 🆕 New | Medium |

### Nice-to-Have

| ID | Story | Status | Feasibility |
|----|-------|--------|-------------|
| 16 | Sentiment Tracking | ✅ Keep | Medium |
| 17 | Humorous Warning Templates | ⚠️ Scoped Down | Medium |
| 18 | Discord Webhook Notifications | ⚠️ Scoped Down | Medium |

---

## Dependency Map

```
Story 23 (Allow-list)
  └─ required by Stories 01, 04, 19

Story 01 (Comment Ingestion)
  └─ required by Story 02 (AI Pipeline)
        └─ required by Stories 03, 04, 05, 11, 16

Story 06 (Auto-Moderation Rules)
  └─ required by Stories 03, 04, 05, 07, 08, 09, 10, 15, 19, 22

Story 03 (Toxicity Detection)
Story 04 (Spam Detection)
Story 07 (Auto-Remove)
Story 08 (Flag for Review)
Story 09 (Warning Messages)
Story 10 (User Bans)
  └─ all write kvStore counters consumed by Stories 13, 14, 20, 21

Story 15 (Moderation Profiles)
  └─ required by Story 09 (warning template selection)
  └─ required by Story 17 (comedy profile)

Story 11 (Thread Summarization)
  └─ required by Story 12 (Summarize Menu Command)

Story 13 (Toxicity Snapshot)
Story 14 (Stats Command)
  └─ both read counters written by Stories 03, 04, 07, 08, 09, 10
  └─ enhanced by Story 20 (Scheduled Aggregation)
  └─ enhanced by Story 16 (Sentiment Tracking)

Story 08 (Flag for Review)
  └─ triggers Story 09 (Warning Messages)
  └─ triggers Story 22 (Comment Flair)

Story 21 (User History Panel)
  └─ links to Story 23 (Allow-list add action)

Story 19 (Post-Level Analysis)
  └─ depends on Story 02, 06, 23 (same as Story 01)
```

### Conflicts Identified

| Conflict | Resolution |
|----------|-----------|
| Stories 13 and 14 both read the same `kvStore` counters and display similar data. | Kept both intentionally: Story 13 is a toxicity-specific deep dive; Story 14 is a broader moderation health dashboard. Shared counter infrastructure avoids duplication. |
| Stories 10 and README.md document `!botditor ban @user` as a text command. | Story 10 is scoped to a menu form; README.md should be updated to remove references to text commands. |
| Stories 12 and README.md document `!botditor summarize` as a text command. | Story 12 is scoped to a menu action; README.md should be updated accordingly. |
| Story 15 originally included Comedy mode as a full threshold profile; Story 17 covers comedy as a warning-tone variant. | Comedy is now solely a warning template tone (Story 17). Story 15 covers Strict/Chill threshold presets only. No overlap remains. |
| Story 06 sets `dryRun` globally, but Story 07 describes its own dry-run mode. | Unified: `dryRun` is the single setting in Story 06; Story 07 reads it. No separate flag needed. |
