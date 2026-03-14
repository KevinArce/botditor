# Story 02: AI Analysis Pipeline

Status: ✅ Implemented

Feature area: Core Moderation

Implementation notes:
- Pipeline implemented in `src/ai.ts` with `analyzeComment()` entry point.
- Uses global `fetch()` (Devvit `http: true` config) to call the Gemini REST API.
- Default model: `gemini-2.5-flash` (configurable via `devvit settings set geminiModel`).
- API key stored as encrypted Devvit App Setting (`devvit settings set geminiApiKey`).
- Results cached in Redis for 1 hour (`analysis:cache:{commentId}`).
- All errors return safe fallback scores (all zeros) — no moderation action on failure.
- `maxOutputTokens` set to 2048 to account for Gemini 2.5 thinking tokens.

Story:
As a moderator, I want comments analyzed by the Gemini API so that moderation signals are more accurate than simple keyword rules.

Acceptance criteria:
- The app calls the Gemini API (`gemini-2.5-flash` or configurable model) for each comment via `context.fetch()`.
- The Gemini API key is stored in Devvit App Settings (encrypted at rest) and never committed to source control.
- The prompt requests a structured JSON response containing `toxicityScore` (0–1), `spamScore` (0–1), `botLikelihood` (0–1), `sentiment` (`positive` | `neutral` | `negative`), and a short `reason` string.
- Responses are validated against the expected schema; malformed responses fall back to `{ toxicityScore: 0, spamScore: 0, botLikelihood: 0, sentiment: 'neutral', reason: 'parse error' }`.
- API call failures (network error, 4xx, 5xx) also fall back to the safe default and are logged.
- A configurable timeout (default 10 s) is applied; timeouts are treated as failures.
- Responses are cached in `kvStore` by comment ID for 1 hour to avoid redundant API calls on retries.

Feasibility rating: High

Justification:
Devvit 0.12+ supports outbound HTTP via `context.fetch()` when `Devvit.configure({ http: true })` is set. The Gemini REST API is a standard HTTPS endpoint with no special socket requirements. App Settings provides encrypted key storage.

Devvit hooks:
- `Devvit.configure({ redditAPI: true, http: true })`
- `Devvit.addSettings([...])` with the following fields:
  - `{ name: 'geminiApiKey', type: 'string', label: 'Gemini API Key', isSecret: true }`
  - `{ name: 'geminiModel', type: 'string', label: 'Gemini Model', defaultValue: 'gemini-1.5-flash' }`
- `context.fetch('https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', { method: 'POST', ... })`
- `context.kvStore.get` / `context.kvStore.set`

Gemini prompt strategy:
```
You are a Reddit moderation assistant. Analyze the following comment and respond ONLY with valid JSON.

Comment: "{commentBody}"
Author account age: {accountAgeDays} days
Author comment karma: {commentKarma}

Return JSON with these exact fields:
{
  "toxicityScore": <float 0-1>,
  "spamScore": <float 0-1>,
  "botLikelihood": <float 0-1>,
  "sentiment": "positive" | "neutral" | "negative",
  "reason": "<one sentence explanation>"
}
```

Edge cases:
- Comments longer than 8 000 characters: truncate to 8 000 chars and append `[truncated]` before sending to API.
- Non-English comments: include the raw text; Gemini handles multilingual content natively.
- Emoji-only or empty comments: skip API call; assign `{ toxicityScore: 0, spamScore: 0.1, botLikelihood: 0.2 }` heuristically.

Dependencies: Story 01 (Comment Ingestion) provides the event; Story 06 (Auto-Moderation Rules) consumes the scores.
