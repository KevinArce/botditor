# Story 01: Comment Ingestion

Status: ✅ Implemented

Feature area: Core Moderation

Story:
As a moderator, I want the app to process new comments automatically so that problematic content is detected quickly without requiring manual action.

Acceptance criteria:
- [x] New comments trigger analysis automatically via the `CommentSubmit` event hook.
- [x] Each comment is passed to the AI analysis pipeline (Story 02) as a distinct job.
- [x] Processing failures are caught, logged to console, and do not block analysis of other comments.
- [x] The app exposes a per-subreddit enabled/disabled toggle in Devvit App Settings.
- [x] When disabled, the trigger fires but exits immediately with a logged no-op.
- [x] Comments from accounts on the moderator allow-list (Story 23) are skipped.

Feasibility rating: High

Justification:
Devvit's `CommentSubmit` trigger is a first-class event. Rate limiting is handled with per-comment async dispatch rather than batch polling. App Settings provides the on/off toggle without requiring a redeploy.

## Implementation details

### Architecture

The ingestion pipeline is split into four modules with clean separation of concerns:

| Module | Responsibility |
|--------|---------------|
| `src/types.ts` | Shared types (`IngestedComment`, `AnalysisResult`, `CommentStatus`, `SkipReason`), Redis key helpers, settings constants |
| `src/settings.ts` | Registers all `Devvit.addSettings` — enabled toggle, allowlist fields, Gemini API key (secret), Gemini model |
| `src/allowlist.ts` | Allowlist service — checks Redis keys + settings bulk-list, with implicit self-allowlist and fail-open on errors |
| `src/commentStorage.ts` | Redis persistence — save with duplicate detection, update status, paginated listing via sorted set |
| `src/commentIngestion.ts` | Core handler — the full ingestion pipeline wired to the `CommentSubmit` trigger |

### Data model

Each ingested comment is persisted in Redis as a JSON blob:

```
Key:   comment:<commentId>
Value: {
  commentId, postId, subredditName, authorName,
  body (max 4000 chars), createdAt, ingestedAt,
  status: "pending" | "processing" | "analyzed" | "skipped" | "error",
  skipReason?: "disabled" | "allowlisted" | "self_comment" | "deleted" | "missing_body" | "duplicate",
  analysis?: { toxicityScore, spamScore, botLikelihood, sentiment, reason },
  errorMessage?: string
}
```

A per-subreddit sorted set (`comments:index:<subreddit>`) provides time-ordered listing, and a counter key (`comments:count:<subreddit>`) tracks totals.

### Processing flow

```
CommentSubmit event
  │
  ├─ 1. Check enabled toggle → exit if disabled
  ├─ 2. Extract & validate payload → skip if missing comment
  ├─ 3. Guard: empty body → persist as "skipped/deleted"
  ├─ 4. Guard: self-comment → persist as "skipped/self_comment"
  ├─ 5. Guard: allowlist → persist as "skipped/allowlisted"
  ├─ 6. Sanitize body (trim, cap 4000 chars)
  ├─ 7. Persist to Redis (duplicate detection)
  └─ 8. Dispatch to AI pipeline (Story 02 stub)
```

### Devvit hooks used

- `Devvit.addTrigger({ event: 'CommentSubmit', onEvent: handler })`
- `Devvit.addSettings([...])` with fields:
  - `{ name: 'botditorEnabled', type: 'boolean', label: 'Enable Botditor', defaultValue: true, scope: 'installation' }`
  - `{ name: 'allowlistUsernames', type: 'string', label: 'Allowlisted usernames (comma-separated)', scope: 'installation' }`
  - `{ name: 'allowlistDomains', type: 'string', label: 'Allowlisted domains (comma-separated)', scope: 'installation' }`
  - `{ name: 'geminiApiKey', type: 'string', isSecret: true, scope: 'app' }`
  - `{ name: 'geminiModel', type: 'string', defaultValue: 'gemini-1.5-flash', scope: 'app' }`
- `context.settings.get('botditorEnabled')`
- `context.redis.get / set / del / zAdd / zRange / incrBy`
- `context.reddit.getAppUser()`
- `Devvit.addMenuItem(...)` for allowlist management (partial Story 23)

### Edge cases handled

| Edge case | How it's handled |
|-----------|-----------------|
| Very high comment velocity (viral posts) | Each comment processed independently; no batching or shared mutable state |
| Deleted comment between trigger and fetch | Empty/missing body detected → persisted as `skipped/deleted` |
| Bot's own comments | `getAppUser()` check prevents self-analysis loops |
| Duplicate events (re-delivery) | Redis existence check in `saveComment()` returns `"duplicate"` — idempotent |
| Allowlist read failure (Redis outage) | Fails open (analysis proceeds) per Story 23 guidance, with error logged |
| Oversized comment body | Truncated to 4,000 characters before storage |
| Settings not yet configured | `enabled` defaults to `true`; missing allowlist treated as empty |

### Deviations from original story

| Original | Implemented | Reason |
|----------|-------------|--------|
| Setting name `enabled` | Setting name `botditorEnabled` | Avoids collision with other settings; more descriptive |
| `context.settings.get('enabled')` | `context.settings.get('botditorEnabled')` | Same as above |
| No data persistence specified | Full Redis-backed `IngestedComment` records | Needed for Story 02 pipeline handoff, duplicate detection, and future analytics (Stories 13, 14, 20) |
| Allow-list check mentioned but undefined | Full allowlist service with Redis + settings sources | Partial Story 23 implementation to unblock Story 01 |

Dependencies: Story 02 (AI Analysis Pipeline) must be implemented before automated actions take effect. The ingestion handler currently sets status to `"processing"` and leaves a TODO stub for the analysis call.
