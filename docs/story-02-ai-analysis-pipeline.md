# Story 02: AI Analysis Pipeline

Status: ✅ Implemented

Feature area: Core Moderation

Implementation notes (updated 2026-09-10, BACKLOG OPS-1):
- Pipeline implemented in `src/ai.ts` with `analyzeComment()` entry point.
- Uses global `fetch()` to call the Gemini REST API. `Devvit.configure({ http: { domains: ['generativelanguage.googleapis.com'] } })` declares the domain, as Devvit's fetch policy requires even for globally allow-listed domains.
- Default model: `gemini-3.6-flash` (`DEFAULT_GEMINI_MODEL` in `types.ts`, used by both the registered setting default and the runtime fallback; configurable via `devvit settings set geminiModel`).
  - **Incident:** the setting default used to be `gemini-1.5-flash`, which Google shut down on 2025-09-29. Devvit always returns a setting's registered default, so the `gemini-2.5-flash` fallback in `ai.ts` never ran. Every call failed and fell back to zero scores, silently disabling AI moderation. A single shared constant plus `settings.test.ts` now guard against this.
- API key stored as encrypted Devvit App Setting (`devvit settings set geminiApiKey`) and sent in the `x-goog-api-key` header (no longer in the URL).
- Instructions go in `systemInstruction`. The comment is the only user content, wrapped in `<comment>` delimiters (tags inside the body are stripped), to reduce prompt injection.
- `responseMimeType: "application/json"`. Gemini 3+ models get `thinkingLevel: "LOW"` and their default temperature (per Google's Gemini 3 guidance). Older models get `temperature: 0.1` and no `thinkingLevel`.
- 10 s timeout via `Promise.race` (Devvit's fetch polyfill ignores `AbortSignal`; the platform cap is 30 s) → fallback reason `timeout`.
- Successful results cached in Redis for 1 hour (`analysis:cache:{commentId}`). Parse errors are not cached.
- All errors return safe fallback scores (all zeros) — no moderation action on failure.
- No logging of comment bodies, raw responses, or the key. Empty responses log `blockReason`/`finishReason`.
- `maxOutputTokens` set to 2048 to leave room for thinking tokens.

Story:
As a moderator, I want comments analyzed by the Gemini API so that moderation signals are more accurate than simple keyword rules.

Acceptance criteria:
- The app calls the Gemini API (`gemini-2.5-flash` or configurable model) for each comment via `context.fetch()`.
- The Gemini API key is stored in Devvit App Settings (encrypted at rest) and never committed to source control.
- The prompt requests a structured JSON response containing `toxicityScore` (0–1), `spamScore` (0–1), `botLikelihood` (0–1), `sentiment` (`positive` | `neutral` | `negative`), and a short `reason` string.
- Responses are validated against the expected schema; malformed responses fall back to `{ toxicityScore: 0, spamScore: 0, botLikelihood: 0, sentiment: 'neutral', reason: 'parse error' }`.
- API call failures (network error, 4xx, 5xx) also fall back to the safe default and are logged.
- A timeout (default 10 s, `GEMINI_TIMEOUT_MS`) is applied; timeouts are treated as failures. *(Implemented 2026-09-10. It's a constant, not a moderator setting.)*
- Responses are cached in Redis (`kvStore` was removed in Devvit 0.13) by comment ID for 1 hour to avoid redundant API calls on retries.

Feasibility rating: High

Justification:
Devvit 0.12+ supports outbound HTTP via `context.fetch()` when `Devvit.configure({ http: true })` is set. The Gemini REST API is a standard HTTPS endpoint with no special socket requirements. App Settings provides encrypted key storage.

Devvit hooks:
- `Devvit.configure({ redditAPI: true, http: true })`
- `Devvit.addSettings([...])` with the following fields:
  - `{ name: 'geminiApiKey', type: 'string', label: 'Gemini API Key', isSecret: true }`
  - `{ name: 'geminiModel', type: 'string', label: 'Gemini Model', defaultValue: DEFAULT_GEMINI_MODEL }` (`gemini-3.6-flash`; was the retired `gemini-1.5-flash`)
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
