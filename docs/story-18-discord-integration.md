# Story 18: Discord Webhook Notifications

Status: ⚠️ Scope Down — full Discord integration as a primary notification channel is out of scope for a Reddit-native Devvit app; scoped to opt-in Discord webhook notifications for high-severity auto-removals only, with a copyable-summary fallback for subreddits that do not use Discord.

Feature area: Nice-to-Have

Story (scoped):
As a moderator, I want high-severity auto-removal events optionally sent to a Discord webhook so that my moderation team is notified in our team channel without having to monitor the Reddit mod queue continuously.

Acceptance criteria:
- A `discordWebhookUrl` field is available in App Settings (optional, blank by default).
- When set, the app sends a Discord webhook POST (via `context.fetch()`) for every auto-removal with severity above `toxicityRemoveThreshold`.
- The webhook payload includes: subreddit name, comment author, comment snippet (first 200 characters, redacted if NSFW), toxicity score, and a direct link to the removed comment.
- Personally identifiable information beyond Reddit username is not included.
- If the webhook call fails (network error, 4xx, 5xx), the failure is logged but does not affect the removal itself.
- For subreddits without a webhook URL configured, the app provides a "Copy alert summary" button in the toxicity snapshot (Story 13) to allow manual sharing.

Feasibility rating: Medium

Justification:
Devvit's `context.fetch()` supports outbound HTTPS POST, which is all Discord webhooks require. The webhook URL is stored securely in encrypted App Settings. The fallback copyable summary requires no external calls at all.

Devvit hooks:
- `Devvit.addSettings([{ name: 'discordWebhookUrl', type: 'string', label: 'Discord Webhook URL (optional)', isSecret: true }])`
- `context.fetch(webhookUrl, { method: 'POST', body: JSON.stringify({ content: ... }) })`

Edge cases:
- Webhook URL is invalid: validate basic URL format in settings and log a warning on the first failed call.
- Rate limiting by Discord (max 30 requests/minute per webhook): batch or debounce notifications for high-volume subreddits; consider only sending for the top 10 removals per minute.
- NSFW subreddits: truncate and redact comment snippet; do not include author avatar or profile links.

Limitation: Bi-directional Discord ↔ Reddit integration (e.g., issuing ban commands from Discord) is not feasible within Devvit's sandboxed model and is explicitly out of scope.

Dependencies: Story 07 (auto-removal event), Story 13 (copyable summary fallback), Story 06 (webhook enabled by settings).
