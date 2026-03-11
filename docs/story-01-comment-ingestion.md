# Story 01: Comment Ingestion

Status: ✅ Keep & Enrich

Feature area: Core Moderation

Story:
As a moderator, I want the app to process new comments automatically so that problematic content is detected quickly without requiring manual action.

Acceptance criteria:
- New comments trigger analysis automatically via the `CommentSubmit` event hook.
- Each comment is passed to the AI analysis pipeline (Story 02) as a distinct job.
- Processing failures are caught, logged to console, and do not block analysis of other comments.
- The app exposes a per-subreddit enabled/disabled toggle in Devvit App Settings.
- When disabled, the trigger fires but exits immediately with a logged no-op.
- Comments from accounts on the moderator allow-list (Story 23) are skipped.

Feasibility rating: High

Justification:
Devvit's `CommentSubmit` trigger is a first-class event. Rate limiting is handled with per-comment async dispatch rather than batch polling. App Settings provides the on/off toggle without requiring a redeploy.

Devvit hooks:
- `Devvit.addTrigger({ event: 'CommentSubmit', onEvent: handler })`
- `Devvit.addSettings([{ name: 'enabled', type: 'boolean', label: 'Enable Botditor', defaultValue: true }])`
- `context.settings.get('enabled')`

Edge cases:
- Very high comment velocity (viral posts): process each comment independently so one slow AI call doesn't cascade.
- Deleted comment between trigger firing and fetch: handle `null` gracefully and skip.
- Bot's own comments: check `comment.authorName` against the app's own username to avoid self-analysis loops.

Dependencies: Story 02 (AI Analysis Pipeline) must be implemented before automated actions take effect.
