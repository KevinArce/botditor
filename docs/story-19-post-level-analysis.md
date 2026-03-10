# Story 19: Post-Level Analysis (Gap Story)

Status: ✅ New — identified via gap analysis; Devvit's `PostSubmit` trigger is a first-class event with no existing story coverage.

Feature area: Core Moderation

Story:
As a moderator, I want new posts scanned for spam and rule violations upon submission so that problematic posts are caught before gaining engagement, not just problematic comments.

Acceptance criteria:
- New posts trigger analysis via the `PostSubmit` event hook.
- The post title and body (self-text) are passed to the AI analysis pipeline (Story 02) for scoring.
- If `spamScore >= spamRemoveThreshold` (Story 06), the post is removed and logged.
- If `toxicityScore >= toxicityFlagThreshold`, the post is reported for manual review.
- Posts from accounts on the moderator allow-list (Story 23) are skipped.
- Post analysis is subject to the same `enabled` and `dryRun` settings as comment analysis (Story 06).
- Post removals are logged to modlog with score and reason.

Feasibility rating: High

Justification:
Devvit's `PostSubmit` trigger works identically to `CommentSubmit`. The same AI pipeline from Story 02 processes the post text. `post.remove()` is available in the same reddit API surface as `comment.remove()`. No additional platform capabilities are required.

Devvit hooks:
- `Devvit.addTrigger({ event: 'PostSubmit', onEvent: handler })`
- `context.reddit.getPostById(postId)` then `post.remove()`
- `context.modLog.add({ action: 'removelink', target: postId, details: 'botditor', description: reason })`

Gemini prompt strategy:
Reuse the Story 02 pipeline with a modified prompt preamble:
```
Analyze the following Reddit post for toxicity and spam.

Post title: "{title}"
Post body: "{body}"
Author account age: {accountAgeDays} days
Author comment karma: {commentKarma}
```

Edge cases:
- Link posts with no body: analyze title only; flag posts where the URL domain is on the blocked list.
- Image posts: analyze title only; image content analysis is out of scope.
- Crossposted posts: analyze the crosspost's title and body; note the original subreddit in the modlog.
- Post removed by OP before bot acts: catch the error and skip.

Dependencies: Story 02 (AI Analysis Pipeline), Story 06 (thresholds), Story 23 (allow-list). Parallel to Story 01 (Comment Ingestion).
