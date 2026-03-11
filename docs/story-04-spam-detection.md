# Story 04: Spam Detection

Status: ✅ Keep & Enrich

Feature area: Core Moderation

Story:
As a moderator, I want spam comments detected and removed automatically so that obvious spam is cleared without manual effort.

Acceptance criteria:
- A `spamScore` (0–1) is produced for each comment, combining rule-based heuristics and the AI pipeline (Story 02).
- Rule-based heuristics run first (fast, no API cost):
  - More than 3 URLs in a comment body → spamScore += 0.4
  - URL domain matches a configurable blocked-domain list → spamScore = 1.0 (instant removal)
  - Repeated identical comment body submitted by the same user in the last 10 minutes → spamScore += 0.5
  - Author account age < 3 days AND karma < 10 → spamScore += 0.3
- If rule-based score is below 0.5, the AI pipeline score is used as the final value.
- Comments with `spamScore >= spamRemoveThreshold` (default 0.80) are removed and logged.
- All removals are logged to modlog with reason.
- A flag-only mode suppresses removal and reports the comment instead.

Feasibility rating: High

Justification:
Rule-based heuristics are pure logic. The AI score comes for free from Story 02. `comment.remove()` is fully supported. Account age and karma are accessible via `context.reddit.getUserByUsername()`.

Devvit hooks:
- `context.reddit.getUserByUsername(author)` for account age/karma
- `context.kvStore.get` / `context.kvStore.set` for tracking recent identical submissions
- `comment.remove()` and `context.modLog.add()`

Edge cases:
- Legitimate promotional posts with multiple links: the configurable blocked-domain list prevents false positives on known-good domains.
- High-karma accounts posting spam: karma threshold is advisory, not a hard pass; AI score still applies.
- Spam flood (100+ comments in 1 minute): each fires independently; no batching risk since each is its own trigger invocation.

Dependencies: Story 02 (AI Analysis Pipeline) for ambiguous cases; Story 06 (thresholds); Story 23 (allow-list to suppress false positives).
