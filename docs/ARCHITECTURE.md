# Botditor — Architecture & Current State

> Verified against the code on 2026-09-10 (v1.2.0, commit `fca785f`) plus the changes made in that review.
> Keep this file in sync when behaviour changes. Planned work lives in [BACKLOG.md](./BACKLOG.md).

---

## 1. Purpose

Botditor is a Reddit [Devvit](https://developers.reddit.com) moderation app. It scores every new comment in a subreddit with Google Gemini (toxicity, spam, bot-likelihood, sentiment) plus fast rule-based spam heuristics, then removes, reports, or ignores the comment according to moderator-configured thresholds. It also gives moderators menu actions to bulk-remove comment trees, ban authors, and manage an allow-list.

Design goals visible in the code:

- **Fail safe.** Every stage catches its own errors. An AI failure produces all-zero scores, which never trigger an action (as long as thresholds are > 0 — see [COR-2](./BACKLOG.md#p1--correctness-and-robustness)). The flip side: a misconfigured AI silently turns moderation off instead of failing loudly, which is how the retired-model bug (OPS-1) went unnoticed.
- **Idempotent.** Event re-deliveries are absorbed by Redis dedup keys at every side-effecting step.
- **Tunable without redeploys.** All thresholds and toggles are Devvit settings, and a dry-run mode logs decisions without acting.

---

## 2. Platform and stack

| Layer | Technology | Notes |
|---|---|---|
| Platform | Devvit `@devvit/public-api` **0.12.20** | Legacy "Blocks-era" singleton API (`Devvit.addTrigger/addMenuItem/createForm`). Deprecated since Devvit 0.13.0 in favour of Devvit Web — see [PLAT-1](./BACKLOG.md#p2--platform). Latest Devvit is 0.14.3. |
| Runtime | Node.js on Reddit's servers | Local dev needs Node **22.2+** (Devvit 0.12 quickstart); the maintainer uses 24.x. |
| AI | Google Gemini REST API (`generateContent`) | Called with the global `fetch` that Devvit polyfills over its HTTP plugin. |
| Storage | Devvit Redis | Scoped per installation (per subreddit). Limits: 5 GB storage, 40k commands/s, 5 MB/request. |
| Language | TypeScript 6.0 | `tsconfig.json` extends `@devvit/public-api/devvit.tsconfig.json` (strict, `NodeNext`, `allowJs`). |
| Tests | Vitest 4.1 | Hand-written `vi.fn()` mocks of the Devvit context. `@devvit/test` is installed but unused. |
| CLI | `devvit` | Scripts resolve a **global** `devvit` 0.12.20; the local devDependency is broken — see [TOOL-1](./BACKLOG.md#p1--correctness-and-robustness). |

---

## 3. Source layout

```
src/
├── main.ts              Entry point: Devvit.configure, CommentSubmit trigger, menu items, forms
├── settings.ts          Devvit.addSettings — every installation and app setting
├── types.ts             Shared types, setting names (SETTINGS), Redis key builders (REDIS_KEYS), constants
├── commentIngestion.ts  CommentSubmit handler — guards, persistence, orchestrates the pipeline
├── commentStorage.ts    Redis persistence of IngestedComment records (+ index, counter)
├── allowlist.ts         User allow-list (Redis keys + settings list, self-allowlist, fail-open)
├── ai.ts                Gemini call, prompt, response parsing/validation, 1 h cache
├── spam.ts              Rule-based spam heuristics
├── rules.ts             Loads + validates moderation settings into a ModerationRules snapshot
├── moderation.ts        Toxicity/spam enforcement: remove, report, dry-run, dedup
├── warnings.ts          Warning PMs with per-profile templates and 48 h cooldown
├── bans.ts              "Ban User" form handler: permission check, ban, analytics record
├── nuke.ts              "Mop" handlers — remove/lock a comment tree or all comments on a post
└── __tests__/           Vitest unit tests (one file per module except main/settings/nuke)
```

Each module that performs side effects exposes a public wrapper that catches everything and an `…Inner` function with the logic, e.g. `analyzeComment` / `analyzeCommentInner`.

---

## 4. Comment pipeline

`Devvit.addTrigger({ event: "CommentSubmit" })` → `handleCommentSubmit()` in `commentIngestion.ts`:

```
CommentSubmit event
 1. botditorEnabled == false ────────────────────────────► exit (nothing stored)
 2. loadModerationRules() + logActiveRules()
 3. missing comment id ──────────────────────────────────► exit
 4. empty body ──────────────► persist status=skipped (deleted | missing_body)
 5. author == app account ───► persist status=skipped (self_comment)
 6. author allow-listed ─────► persist status=skipped (allowlisted)
 7. saveComment() — duplicate id ────────────────────────► exit (idempotent)
 8. status=processing
 9. analyzeComment()            Gemini scores (emoji-only shortcut, 1 h cache, zero-score fallback)
10. computeSpamScore()          rule-based; if score ≥ 0.5 it overwrites analysis.spamScore (stored only)
11. status=analyzed, analysis saved
12. enforceToxicity()           remove ≥ removeThreshold │ report ≥ flagThreshold │ none
13.   └─ "flagged" → sendWarning()
14. enforceSpam()  (skipped if step 12 removed the comment) — uses the rule-based SpamResult only
15.   └─ "spam_flagged" → sendWarning()
```

Notes:

- **Author identity.** `authorName` comes from `event.comment.author`. `warnings.ts` suspects this can be a `t2_…` user ID rather than a username and re-fetches the comment before sending a PM. If that's true, the allow-list lookup, the new-account heuristic, and the warning cooldown key are affected too. Not yet verified in a live playtest — see [COR-1](./BACKLOG.md#p1--correctness-and-robustness).
- `moderationAction` on the stored record is overwritten by each later step, so it holds the *last* action (e.g. `warned`), not the full history.
- `saveComment()` runs outside the pipeline's `try`. If Redis rejects the write (e.g. the storage quota is full), the error escapes to the trigger's top-level catch in `main.ts` and the comment isn't analysed.

---

## 5. Moderation decision rules

| Signal | Condition | Action (live) | Action (dry-run) |
|---|---|---|---|
| Toxicity (Gemini) | `score ≥ toxicityRemoveThreshold` | `comment.remove()` → `removed` | `dry_run_remove` |
| Toxicity (Gemini) | `score ≥ toxicityFlagThreshold` | `reddit.report()` with `[botditor] toxicity=<score> — <reason>` → `flagged`, then warning PM | `dry_run_flag` |
| Spam (rules) | URL on blocked-domain list | remove, regardless of `spamMode` → `spam_removed` | `dry_run_spam_remove` |
| Spam (rules) | `spamMode == "remove"` and `score ≥ spamRemoveThreshold` | remove → `spam_removed` | `dry_run_spam_remove` |
| Spam (rules) | `score ≥ spamFlagThreshold` | report → `spam_flagged`, then warning PM | `dry_run_spam_flag` |
| Bot-likelihood | — | **not enforced** (score stored only; `botFlagThreshold` is loaded but unused) | — |

Threshold validation (`rules.ts`): if a remove threshold is lower than its flag threshold, the flag threshold is clamped down to it. Values aren't range-checked.

Rule-based spam heuristics (`spam.ts`), summed and clamped to 0–1:

| Heuristic | Delta |
|---|---|
| > 3 URLs whose domain isn't allow-listed | +0.4 |
| Same author posted an identical body within 10 min (DJB2 hash in Redis) | +0.5 |
| Account age < 3 days **and** karma < 10 | +0.3 |
| Any URL on the blocked-domain list | score = 1.0, `blockedDomain = true` |

Reddit's report reason and removal-note fields have a 100-character limit, so `truncateReason()` clips strings at those API boundaries only.

---

## 6. Moderator actions (menu items)

All are `forUserType: "moderator"`.

| Location | Label | Behaviour |
|---|---|---|
| comment | Add author to allowlist | Sets `allowlist:user:<name>`. |
| comment | Remove author from allowlist | Deletes that key. The settings-based list isn't touched. |
| comment | Mop comments | Form (remove / lock / skip distinguished). Needs mod permission `all` or `posts`. Removes the comment and every descendant. |
| post | Mop post comments | Same as above, for every comment on the post. |
| comment | Ban User | Form pre-filled with the author and the stored Gemini reason. Needs `all` or `access`. Calls `reddit.banUser()` and stores an analytics record. |

Mop and Ban run as the **app account**, so Reddit's mod log attributes those actions to the app, not to the moderator who clicked. The code tried to add a custom mod-log entry naming the moderator, but that API no longer exists — see §10.

---

## 7. Configuration reference

Installation settings are edited per subreddit at `https://developers.reddit.com/r/<subreddit>/apps/<app-slug>`. App settings are set by the developer with `devvit settings set <name>`.

| Setting (`SETTINGS.*` key) | Scope | Type | Default | Enforced? |
|---|---|---|---|---|
| `botditorEnabled` | installation | boolean | `true` | ✅ |
| `allowlistUsernames` | installation | string (CSV) | `""` | ✅ |
| `allowlistDomains` | installation | string (CSV) | `""` | ✅ URL-count heuristic only |
| `toxicityRemoveThreshold` | installation | number | `0.85` | ✅ |
| `toxicityFlagThreshold` | installation | number | `0.60` | ✅ |
| `dryRunMode` | installation | boolean | `false` | ✅ |
| `spamRemoveThreshold` | installation | number | `0.80` | ✅ only when `spamMode = remove` |
| `spamFlagThreshold` | installation | number | `0.50` | ✅ |
| `spamMode` | installation | string (`flag` / `remove`) | `flag` | ✅ free text; anything but `remove` behaves as `flag` |
| `spamBlockedDomains` | installation | string (CSV) | `""` | ✅ |
| `botFlagThreshold` | installation | number | `0.75` | ❌ loaded, never used (Story 05) |
| `moderationProfile` | installation | string (`strict` / `chill`) | `chill` | ⚠️ selects the warning template only; doesn't change thresholds (Story 15) |
| `warningTemplateStrict` | installation | paragraph | formal template | ✅ |
| `warningTemplateChill` | installation | paragraph | friendly template | ✅ |
| `geminiApiKey` | app (secret) | string | — | ✅ required for AI scoring |
| `geminiModel` | app | string | see §9 | ✅ |

Devvit returns a setting's registered `defaultValue` whenever it hasn't been set, so defaults in `settings.ts` take effect everywhere; hard-coded fallbacks elsewhere never run.

---

## 8. Redis data model

All keys are built by `REDIS_KEYS` in `types.ts`. Devvit Redis is namespaced per installation.

| Key | Value | TTL | Written by | Read by |
|---|---|---|---|---|
| `comment:<commentId>` | `IngestedComment` JSON (body ≤ 4000 chars) | none | commentStorage | ingestion, Ban User pre-fill |
| `comments:index:<sub>` | sorted set, score = ingestion ms | none | commentStorage | `listCommentIds()` (not called by the app yet) |
| `comments:count:<sub>` | integer | none | commentStorage | `getCommentCount()` (not called by the app yet) |
| `allowlist:user:<name>` | `"1"` | none | allow-list menu items | allowlist |
| `analysis:cache:<commentId>` | `AnalysisResult` JSON | 1 h | ai | ai |
| `spam:recentbody:<author>:<hash>` | `"1"` | 10 min | spam | spam |
| `removed:<commentId>` | `"1"` | none | moderation | moderation (dedup) |
| `flagged:<commentId>` | `{ score, reason, timestamp }` | 24 h | moderation | moderation (dedup) |
| `warned:<author>` | `{ commentId, issue, profile, timestamp }` | 48 h | warnings | warnings (cooldown) |
| `ban:<username>:<epochMs>` | ban record JSON | none | bans | nothing yet (Story 14) |
| `bans:count:<sub>` | integer | none | bans | nothing yet (Story 14) |

Nothing that grows per comment is ever expired, and a full 5 GB quota blocks writes — see [COR-4](./BACKLOG.md#p1--correctness-and-robustness). The 24 h `flagged:` records are dedup keys and can't back weekly statistics on their own.

---

## 9. External services

### Google Gemini

| Aspect | Behaviour (since OPS-1, 2026-09-10) |
|---|---|
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` (host in `GEMINI_API_HOST`) |
| Auth | `geminiApiKey` app secret, sent in the `x-goog-api-key` header (previously in the `?key=` query string) |
| Model | `geminiModel` setting, default **`gemini-3.6-flash`** (`DEFAULT_GEMINI_MODEL` in `types.ts`, shared by `settings.ts` and `ai.ts`). This is Google's documented replacement for the Flash line. The previous default, `gemini-1.5-flash`, was shut down on 2025-09-29, and because Devvit always returns the registered default, AI scoring had been silently disabled. |
| Prompt | Instructions go in `systemInstruction` (`SYSTEM_INSTRUCTION`). The user turn is only the comment, wrapped in `<comment>…</comment>` with any such tags stripped from the body, and it's told to treat the text as data. Body capped at 8000 chars. This reduces prompt injection; it doesn't eliminate it. |
| Generation config | `responseMimeType: "application/json"`, `maxOutputTokens: 2048`. Gemini 3+: `thinkingConfig.thinkingLevel: "LOW"` and default temperature (Google advises against lowering it on Gemini 3). Older models: `temperature: 0.1` and no `thinkingLevel`, which they reject. |
| Output | JSON; code fences still stripped defensively, fields validated, scores clamped to 0–1. |
| Timeout | 10 s (`GEMINI_TIMEOUT_MS`) via `Promise.race`, because Devvit's fetch ignores `AbortSignal` → reason `timeout`. Devvit's own cap is 30 s. |
| Caching | Successful results cached 1 h per comment id. Parse errors aren't cached. |
| Logging | Never logs the comment body, the raw response, or the key. Empty responses log `blockReason`/`finishReason` only. |

Fallback `reason` values (all zero scores): `no api key configured`, `timeout`, `fetch error`, `api error <status>`, `response read error`, `empty response`, `parse error`, `unexpected error`.

### Devvit HTTP fetch policy

- Apps must request every domain they fetch, **even globally allow-listed ones** such as `generativelanguage.googleapis.com`. `main.ts` declares it with `http: { domains: [GEMINI_API_HOST] }`.
- Google Gemini and OpenAI are the only AI providers Devvit allows.
- An app that uses fetch needs Terms and Privacy Policy links in its app details, and a "Fetch Domains" section in its README, for review.
- Devvit's fetch polyfill ignores `AbortSignal`, so timeouts need `Promise.race`.

---

## 10. Error-handling conventions and known platform gaps

- Every stage returns a safe value (`"none"`, fallback scores, `{ success: false }`) instead of throwing. Errors are logged with a `[module]` prefix.
- Redis read failures in dedup/cooldown checks **fail open** (the action proceeds). Allow-list read failures also fail open (analysis proceeds).
- **`context.modLog` no longer exists.** Devvit removed the ModLog client between 0.12.0 and 0.12.14; neither the types nor the runtime (`makeAPIClients`) provide it. Every `modLog.add()` call in `moderation.ts`, `bans.ts` and `nuke.ts` throws a `TypeError`, which is caught and logged. Removals and bans still appear in Reddit's native mod log under the app account, but without Botditor's reason or the human moderator's name. Unit tests pass only because they mock `context.modLog`. Supported replacements: `reddit.addRemovalNote()` for removals and `banUser({ note })` for bans. Fix tracked as [OPS-3](./BACKLOG.md#p0--broken-or-unsafe-in-production).

---

## 11. Development workflow

```sh
npm install
npm run test         # vitest run — src/**/*.test.ts only (vitest.config.ts)
npm run type-check   # tsc --noEmit
npm run dev          # devvit playtest (global devvit CLI; loads .env via dotenv-cli)
npm run deploy       # devvit upload
npm run launch       # devvit publish (submits for review)
```

Tooling pitfalls found in review:

1. **Stale build output shadows source** — *fixed by OPS-2 (2026-09-10).* `tsc --build` (the old `type-check`) wrote a `.js` file next to every `.ts` file in `src/`. The Devvit CLI's esbuild 0.25 **and** Vitest resolve `import "./ai.js"` to an existing `ai.js` before `ai.ts` (verified experimentally). So `devvit upload`/`playtest` and the tests ran whatever was last compiled, not the current source, and Vitest ran every test twice. `type-check` is now `tsc --noEmit`, `vitest.config.ts` only includes `src/**/*.test.ts`, and the emitted files were deleted. **If you ever run plain `tsc` or `tsc --build`, delete its output from `src/`.**
2. `npm run type-check` fails on `main` with two errors in `nuke.ts` (`modLog` isn't on `Context`) — part of [OPS-3](./BACKLOG.md#p0--broken-or-unsafe-in-production).
3. The `devvit` devDependency is `1.0.0`, an empty package published in 2022. Dependabot "upgraded" `0.12.14 → 1.0.0` (commit `c9a3315`), so the CLI comes from a global install — [TOOL-1](./BACKLOG.md#p1--correctness-and-robustness).
4. `devvit.yaml`'s `version` (0.0.3) is the Devvit app version managed by `devvit upload`. It's unrelated to `package.json`'s version (1.2.0).

Testing conventions: each test file builds its own mock context (`createMockContext`, `createMockRedis`, `createMockSettings`) and overrides `globalThis.fetch` when needed. `settings.test.ts` spies on `Devvit.addSettings` to check registered defaults. There are no integration tests against `@devvit/test`, and nothing covers `main.ts` or `nuke.ts`. Suite: 10 files, 182 tests.

---

## 12. Known limitations (summary)

See [BACKLOG.md](./BACKLOG.md) for owners, priorities, and fixes.

| Area | Limitation |
|---|---|
| AI | Fixed in code (OPS-1); needs one live playtest with a real key to confirm. If `geminiModel` was ever set by hand, check it's still a served model. Prompt injection is mitigated, not impossible. |
| Audit | Custom mod-log entries never succeed; the acting moderator isn't recorded for bans/mops (OPS-3). |
| Build | Type-check is red (2 `nuke.ts` errors, OPS-3). Stale-`.js` shadowing fixed (OPS-2). |
| Features | Bot-likelihood isn't enforced (05); profiles don't set thresholds (15); AI spam score isn't enforced (COR-3); posts aren't analysed (19); no stats/summaries (11–14, 16, 20). |
| Safety | Warning PMs go out on *flag*, before any human review (POL-1). Threshold settings accept 0 / negative values (COR-2). |
| Scale | Unbounded Redis growth against a 5 GB quota (COR-4); ~15 settings RPCs per comment (PERF-1). |
| Platform | Built on the deprecated `@devvit/public-api` menu/form model (PLAT-1). |
