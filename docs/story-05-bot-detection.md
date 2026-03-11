# Story 05: Bot Detection

Status: ⚠️ Scope Down — full account-history bot detection is not practical within Devvit's per-event execution model; scoped to behavioral signals from recent comment activity only.

Feature area: Core Moderation

Story (scoped):
As a moderator, I want accounts exhibiting bot-like behavior across their last N comments in this subreddit flagged for manual review, so that I can investigate without relying on full account history.

Acceptance criteria:
- A `botLikelihood` score (0–1) is computed per comment from the AI pipeline (Story 02) combined with local heuristics:
  - Identical or near-identical comment bodies posted > 3 times in 10 minutes by the same author → high signal.
  - All comments posted within 1-second intervals → high signal.
  - Comment karma == 0 AND account age < 1 day → moderate signal.
- When `botLikelihood >= botFlagThreshold` (default 0.75), the comment is reported for manual review (Story 08); no auto-ban is performed.
- The moderator review list shows the top signals used for the flag (explainable output).
- Auto-ban is explicitly disabled by default; moderators must act manually.

Feasibility rating: Medium

Justification:
Devvit cannot efficiently paginate a user's full Reddit-wide comment history. Scoping to recent same-subreddit activity stored in `kvStore` is practical. The AI score from Story 02 provides a supplementary signal without extra API calls.

Devvit hooks:
- `context.kvStore` to store recent comment timestamps per author
- `context.reddit.getUserByUsername(author)` for account age and karma
- Report via `comment.report()` or stored flag (Story 08)

Edge cases:
- Active human commenter who posts rapidly during a live event: account age and karma signals should prevent false positives; manual review is the final gate.
- Username changes: track by author ID, not name, where the API exposes a stable ID.

Limitation: Full bot-network detection (cross-subreddit coordination) is out of scope for Devvit's per-subreddit app model.

Dependencies: Story 02 (AI Analysis Pipeline), Story 08 (Flag for Manual Review).
