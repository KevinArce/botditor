# Botditor — Backlog and Action Items

> **Source of truth** for what's done and what's next.
> **Platform**: Devvit `@devvit/public-api` 0.12.20 (latest Devvit: 0.14.8, 2026-10-16) · **AI**: Google Gemini (app) · TypeSafe Jev (offline benchmark only, POL-3)
> **Last verified**: 2026-10-18 — full audit of `eb4822b` (after PR #18, TypeSafe Jev integration) plus the remediation released as v1.5.0 described in the 2026-10-18 review log. Architecture and current behaviour: [ARCHITECTURE.md](./ARCHITECTURE.md).

Status legend: ✅ Done · 🟡 Partial · 🔧 In progress · ⬜ Not started · 🚫 Obsolete / re-scoped / dropped · 🔍 Done in code, needs a live playtest

---

## Action items (prioritized)

### P0 — broken, unsafe, or blocking release

| ID | Item | Why | Status |
|---|---|---|---|
| **POL-3** | **TypeSafe Jev vs Devvit's AI-provider policy.** Decision (owner, 2026-10-18): **keep Jev for local benchmarking only.** | Devvit's HTTP fetch policy: *"Only OpenAI and Google Gemini are currently permitted as AI providers. Requests for any other AI services will be denied."* Domain requests are reviewed for playtests too, so Jev can't run on Reddit's servers at all. **As shipped:** `api.typesafe.ai` removed from `http.domains` (guarded by `main.test.ts`). The in-app `aiProvider` / `jev` / `dual_run` modes and the `jevApiKey` / `jevApiHost` / `jevModel` settings were removed. `jev.ts` is now a context-free client used only by `npm run bench`, which compares Gemini and Jev on a local corpus (latency, score deltas, decision agreement, labelled precision/recall). | ✅ 2026-10-18 |
| **AI-1** | **Rewrite the Jev client to TypeSafe's real API.** | PR #18 POSTed `{ model, target, state, decision_schema }` to `/v1/decide`, which doesn't exist in TypeSafe's API (`POST /v1/systemone` with a `questions` map and an `answers` response). Every Jev call errored, so `jev` and `dual_run` ran on Gemini alone, and the benchmark compared Gemini with a fallback. The default model `jev-1` isn't a valid ID either. | 🔍 2026-10-18 — now used by the offline benchmark only (POL-3); see note ¹ |
| **OPS-1** | Restore Gemini analysis (retired `gemini-1.5-flash` default). | Fixed 2026-09-10. | 🔍 needs one playtest with a real key (`[ai] Analysis complete … toxicity=…`) |
| **OPS-2** | Stop shipping stale build output. | Fixed 2026-09-10. | ✅ |
| **OPS-3** | **Replace the dead `context.modLog.add()` calls.** | Devvit removed the ModLog client between 0.12.0 and 0.12.14; every call threw and was swallowed. Removals carried no Botditor reason, and bans and mops didn't record the moderator. | ✅ 2026-10-18 — see note ² |

¹ **AI-1 as shipped:** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer` only. `state = { comment: { text, subreddit } }`, with no username or comment ID. Four questions: `toxic`/`spam`/`bot` (`noul`) and `sentiment` (`choice`). `answers.*.noul` maps to the three scores, and `composeReason()` builds the reason. Default model pinned to `jev-1.13.0`. Exact failure detection via `isJevFailure()` (AI-4; PR #18 substring-matched `"error"`). PR #18's dual-run defects are **moot now that the in-app dual-run is removed**: the shared cache key (AI-2) and the hard-coded `0` Jev latency (AI-3). The offline benchmark times each provider separately and doesn't cache. **Still to do by the owner:** one `npm run bench` with real `GEMINI_API_KEY` / `JEV_API_KEY` to confirm the live contract.

² **OPS-3 as shipped:** auto-removals call `comment.addRemovalNote({ reasonId: "", modNote: "[botditor] <reason>" })` (100-char limit). Mop calls `reddit.addRemovalNote({ itemIds, … })` with `[botditor] mopped by u/<mod> …` in batches of 100 IDs. Ban User sends `banUser({ reason (mod-facing, ≤ 100), message (user-facing, new optional field), duration (0 or 1–999, validated), note: "Banned by u/<mod> via botditor[: note]" (≤ 300), context: commentId })`. The ban form's misleading "Shown to the banned user" help text is fixed. The test mocks no longer fake `modLog`.

### P1 — correctness and robustness

| ID | Item | Status |
|---|---|---|
| **COR-1** | Read the username from `event.author?.name`, falling back to `comment.author` (which can be a `t2_` ID). | 🔍 2026-10-18 — coded and tested; confirm in a playtest log that `[ingestion] Processing comment … by u/<username>` shows a name, not `t2_…` |
| **COR-2** | Range-validate thresholds (0 < x ≤ 1) and the enum settings. | ✅ 2026-10-18 — `onValidate` on all five thresholds and on `spamMode` / `moderationProfile`. `rules.ts` re-checks at runtime (≤ 0 or non-numeric → default; > 1 kept but logged). *Not done, deliberately:* converting to `select` fields, because a select's value is `string[]` and changing the type of a setting that installs have already saved is unsafe. Revisit with PLAT-1, where `devvit.json` settings are declared fresh. |
| **COR-3** | Feed the AI spam score into enforcement when the rule score is < 0.5. | ✅ 2026-10-18 — `mergeSpamSignals()`: a rule score ≥ 0.5 or a blocked domain is final; otherwise `max(rule, AI)` is stored **and** enforced, with the AI reason appended. |
| **COR-4** | Redis retention. | ✅ 2026-10-18 — `comment:*` 30 d (kept across status updates), `comments:index:*` trimmed to 30 d on each save, `removed:*` 7 d, `bench:*` 7 d. `ban:*` and `allowlist:*` intentionally have no TTL (they grow per moderator action, not per comment). |
| **COR-5** | Make `saveComment` atomic. | 🔍 2026-10-18 — `set(key, v, { nx: true, expiration })`. Devvit returns `""` when NX doesn't write (verified in `@devvit/redis`'s mock); confirm on a playtest re-delivery. |
| **PERF-1** | Read settings once per trigger. | ✅ 2026-10-18 — `withSettingsSnapshot()`: one `getAll()` RPC per comment, down from ~15 (each `settings.get()` was a full `getAll()`). |
| **TOOL-1** | Fix the `devvit` devDependency. | ✅ 2026-10-18 — pinned to `0.12.20` (exact). Re-pin together with `@devvit/public-api`. Adding `.github/dependabot.yml` with an `ignore` for `devvit` is recommended; it was left out because it would also turn on version-update PRs. |
| **TOOL-2** | Add at least one `@devvit/test` integration test, and tests for `main.ts` / `nuke.ts`. | ⬜ Pipeline-level tests with realistic mocks now exist in `commentIngestion.test.ts`, and CI runs on every PR. |
| **OPS-4** | Version alignment. | ✅ 2026-10-18 — `package.json` and `devvit.yaml` aligned (now `1.5.0`) (which `devvit upload` manages and must never go backwards). |

### P1 — product and policy decisions (need the owner's call)

| ID | Question | Context |
|---|---|---|
| **POL-1** | Should warning PMs go out automatically on a *flag*? | They're sent before any human review, so AI false positives warn innocent users. Options: a `warnOn` setting (`never` / `flag` / `remove`, default `never`), or warn only on removal. Bot flags deliberately never send PMs. |
| **POL-2** | App-review readiness for fetch. | Devvit requires Terms and Privacy Policy links for any app that uses fetch. The privacy policy must disclose that comment text goes to Google. The app sends nothing to TypeSafe (POL-3). The README Fetch Domains section justifies the single Gemini domain. |
| **POL-4** | Upgrade behaviour. | v1.5.0 turns on Story 05 bot reports (at the existing `0.75` default) and AI-assisted spam reports. Both are report-only in the default modes. Decide whether to announce this in the app's release notes or ship bot reporting off until moderators opt in. |

### P2 — platform

**PLAT-1 — migrate to Devvit Web (0.14.x).** Devvit 0.13.0 deprecated `@devvit/public-api` menu actions and forms ("support will be dropped in the future"), removed `Devvit.Context` (used by `bans.ts` and `nuke.ts`), and removed `kvStore`. The official Comment Mop template that `nuke.ts` came from is now Devvit Web. Migration map:

| Today (0.12 Blocks API) | Devvit Web (`devvit.json` + `@devvit/web/server`) |
|---|---|
| `devvit.yaml` | `devvit.json` (`name`, `version`, …) |
| `Devvit.configure({ redditAPI, redis, http: { domains } })` | `"permissions": { "reddit": { "enable": true, "scope": "moderator" }, "redis": true, "http": { "enable": true, "domains": [...] } }` |
| `Devvit.addTrigger({ event: "CommentSubmit", onEvent })` | `"triggers": { "onCommentSubmit": "/internal/triggers/on-comment-submit" }` + a server route |
| `Devvit.addMenuItem({ label, location, forUserType, onPress })` | `"menu": { "items": [{ "label", "location": ["comment"], "forUserType": "moderator", "endpoint": "/internal/menu/…" }] }` |
| `Devvit.createForm(…)` + `context.ui.showForm` | `"forms": { "banForm": "/internal/form/ban-submit" }`; the menu endpoint responds with a `showForm` action |
| `Devvit.addSettings([...])` + `onValidate` | `"settings": { "global": {…}, "subreddit": {…} }` with `validationEndpoint`; `isSecret` stays for keys. Use `select` for the enum settings here (COR-2). |
| `context.redis / reddit / settings` | `import { redis, reddit, settings, context } from "@devvit/web/server"` |
| `Devvit.Context` in `bans.ts` / `nuke.ts` | Plain functions taking the server clients |

Suggested order: (1) port `nuke.ts` from the current Comment Mop template; (2) move settings and triggers; (3) move the Ban form; (4) delete `main.ts`'s Blocks wiring. Keep the pure modules (`spam.ts`, `rules.ts`, `jev.ts`, the `ai.ts` parsers) unchanged.

---

## Story status (verified against code, 2026-10-18)

Recommendation key: **Keep** (done, maintain) · **Harden** · **Complete** · **Re-scope** · **Defer** · **Drop**.

| ID | Story | Status | Recommendation | Notes |
|---|---|---|---|---|
| 01 | Comment Ingestion | ✅ 🔍 | Keep & Harden | Atomic `SET NX` (COR-5), 30-day retention (COR-4), username from `event.author.name` (COR-1), one settings RPC (PERF-1). |
| 02 | AI Analysis Pipeline | ✅ 🔍 | Keep & Enrich | Gemini only in the app (POL-3). PR #18's in-app Jev/dual-run removed. TypeSafe Jev is compared offline with `npm run bench`, on a client rebuilt for the real System One API (AI-1). The Gemini request is context-free (`requestGeminiAnalysis`), so the benchmark measures the exact production call. |
| 03 | Toxicity Detection | ✅ 🔍 | Keep | Remove, report, dry-run. "Logged with the reason" AC met by removal notes (OPS-3). |
| 04 | Spam Detection | ✅ | Keep | Rule heuristics + AI blend (COR-3) + flag/remove modes + blocked domains. Removals carry a removal note. |
| 05 | Bot Detection | 🟡 | Complete | **AI-signal enforcement done** (2026-10-18): `botLikelihood ≥ botFlagThreshold` → report `[botditor] bot-likelihood=<score> — <reason>`. Report-only, no PM, shares flag dedup. Still open: the behavioural heuristics in the AC (> 3 near-identical bodies in 10 min, sub-second cadence, 0-karma/< 1-day accounts) and listing top signals. |
| 06 | Auto-Moderation Rules | ✅ | Keep | Range + enum validation (COR-2), settings batching (PERF-1). `select` fields deferred to PLAT-1. |
| 07 | Auto-Remove Comments | ✅ 🔍 | Keep | Removal note with reason (OPS-3), 7-day dedup key. |
| 08 | Flag for Manual Review | ✅ | Keep | Structured reasons, 24 h dedup shared by tox/spam/bot. |
| 09 | Warning Messages | ✅ | Keep | Automatic PMs on tox/spam flags. Policy question: POL-1. |
| 10 | User Bans via Menu | ✅ 🔍 | Keep | Correct `reason`/`message`/`note`/`context` mapping, acting moderator recorded, 1–999 day validation (OPS-3). |
| 11 | Thread Summarization | ⬜ | Defer (P3) | Large threads exceed comfortable prompt sizes and per-trigger time limits. Revisit after PLAT-1 with a chunked map-reduce design. |
| 12 | Summarize Command (menu) | ⬜ | Defer (P3) | Depends on 11. |
| 13 | Toxicity Reports (snapshot) | ⬜ | Blocked → ANL-0 | |
| 14 | Subreddit Stats | ⬜ | Blocked → ANL-0 | `comments:count` and `bans:count` exist. |
| 15 | Moderation Style Profiles | 🟡 | Re-scope | Profile = **warning tone only**, now stated in the setting's help text and the README. Threshold presets can't honour "explicit settings win" while every threshold registers a `defaultValue` (Devvit can't tell unset from default). See the story for the design that would work. |
| 16 | Sentiment Tracking | ⬜ | Keep (P3) | Sentiment is already extracted and stored per comment; needs ANL-0 to aggregate. |
| 17 | ~~Humorous Warning Templates~~ | 🚫 Dropped | Drop | Joke-toned automated warnings about AI-flagged content invite hostility and undercut moderator credibility, and they add policy risk for no moderation value. Moderators who want a lighter tone can edit the chill template. |
| 18 | Discord Webhook | ⬜ | Re-evaluate (P3, opt-in) | Needs a declared `discord.com` fetch domain, webhook-URL secret handling, and a privacy disclosure (content leaves Reddit). |
| 19 | Post-Level Analysis | ⬜ | Plan for v2.0 | `PostSubmit` trigger; reuse the pipeline. Pairs well with PLAT-1. |
| 20 | Scheduled Metrics Aggregation | ⬜ | Blocked → ANL-0 | |
| 21 | User Moderation History Panel | ⬜ | Blocked → ANL-0 | Needs per-user counters. |
| 22 | ~~Comment Flair on Detection~~ → Mod Note on Detection | 🚫 re-scoped | Re-scope | Reddit has no comment flair. Re-scoped to a private `reddit.addModNote({ subreddit, user, note, label, redditId })`, gated by a setting (default off). |
| 23 | Configurable Allow-list | ✅ | Keep | Users (Redis + settings), domains, menu actions, self-allowlist, fail-open. Post allow-listing arrives with Story 19. |

### Feature order after P0/P1

1. The 🔍 checks: one Gemini playtest, and one real `npm run bench`. Grow the corpus with labelled examples from your own test subreddit before drawing provider conclusions.
2. **ANL-0 — date-keyed moderation counters.** Increment `stats:daily:<YYYY-MM-DD>` (hash: `ingested`, `removed`, `flagged`, `spam_removed`, `spam_flagged`, `bot_flagged`, `warned`, `banned`; TTL 400 d) and `stats:daily:<date>:users` (zset; TTL 35 d) at action time. Schema in [ARCHITECTURE §8](./ARCHITECTURE.md#8-redis-data-model). Unblocks 13/14/16/20/21 without key scans (Devvit Redis has no `SCAN`).
3. **Story 05** behavioural heuristics.
4. **Story 19** (post analysis), ideally on Devvit Web (PLAT-1).
5. Stories 14 → 13 → 20 → 21 (analytics), then 22 (mod notes), 16, 11 → 12, 18.

---

## Review log — 2026-10-18 (follow-up: POL-3 decision)

- **Owner decision:** keep TypeSafe Jev for local benchmarking only.
- **Removed from the app:** the `api.typesafe.ai` fetch domain, the `aiProvider` setting with its `jev` / `dual_run` routing, the `jevApiKey` / `jevApiHost` / `jevModel` settings, the `analysis:cache:jev:*` and `bench:jev_vs_gemini:*` Redis keys, and `DualRunBenchmarkRecord`.
- **Added:**
  - `requestGeminiAnalysis()`, a context-free Gemini call; `analyzeComment` wraps it with the cache.
  - The context-free `requestJevAnalysis()`.
  - `bench/` and `npm run bench`, with `tsx` and `@types/node` as pinned devDependencies.
  - A guard test on `http.domains`, and benchmark unit tests.
- **Verified:** an esbuild bundle of `main.ts` contains no `jev.ts` and no "typesafe" string. A stubbed-`fetch` run of `npm run bench` produces the report and the results file.
- **Tests:** 299/299, type-check clean.

## Review log — 2026-10-18

Full audit after PR #18 (TypeSafe Jev integration). Baseline: type-check clean, 198/198 tests. After: type-check clean, **287/287 tests** (12 files).

- **Broken (found and fixed):**
  - The Jev integration targeted a non-existent API, so it never produced a single decision (AI-1).
  - Jev and Gemini shared a cache key, which corrupted dual-run benchmarks (AI-2).
  - Dual-run latency metrics were wrong (AI-3).
  - Jev failures were detected by substring match (AI-4).
  - `modLog` calls were dead (OPS-3).
- **Half-implemented (completed):**
  - Story 05: the bot threshold was visible but did nothing.
  - COR-3: the AI spam score was stored but ignored.
  - Story 10: the ban fields were mis-mapped.
- **Hardened:**
  - Threshold and enum validation (COR-2).
  - Atomic writes (COR-5).
  - Retention TTLs (COR-4).
  - One settings RPC per comment (PERF-1).
  - Author resolution (COR-1).
  - Pinned CLI (TOOL-1).
  - Version alignment (OPS-4).
- **Docs that were wrong:**
  - README/ARCHITECTURE said type-check fails on `nuke.ts`. It hadn't since an `as unknown as` cast was added, and now the casts are gone too.
  - Neither documented Jev.
  - The threshold help text said "1.0 disables". It doesn't: a score of exactly 1.0 still acts.
- **New policy finding:** POL-3 (TypeSafe vs Devvit's AI-provider allow-list). Resolved in the follow-up above.
- **Dropped:** Story 17. **Re-scoped:** Story 15 (tone only).
- **Repository health:** added LICENSE (BSD-3-Clause), CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1; **contact method still to fill in**), SECURITY, issue/PR templates, and a CI workflow.
- **Suggested GitHub metadata:**
  - Description: *"AI moderation assistant for Reddit (Devvit): real-time toxicity, spam, and bot detection with Google Gemini, plus an offline Gemini-vs-TypeSafe-Jev benchmark."*
  - Topics: `reddit`, `devvit`, `reddit-bot`, `moderation`, `ai-moderation`, `gemini-api`, `typesafe-jev`, `typescript`, `vitest`.

## Review log — 2026-09-10

- **Completed but mislabelled:** 02, 03, 06, 09, 10 were marked "Keep & Enrich / Scoped Down" but are implemented.
- **Broken:** 02 (retired model → OPS-1, fixed), 07/10 (dead mod-log API → OPS-3, fixed 2026-10-18).
- **Obsolete / re-scoped:** 22 (no comment flair exists). `kvStore` references in old stories mean **Redis**.
- **Added:** OPS-1/2/3, COR-1…5, PERF-1, TOOL-1/2, POL-1/2, PLAT-1, ANL-0.

---

## Dependency map

```
Story 23 (Allow-list) ─ required by 01, 04, 19
Story 01 (Ingestion) ─ required by 02 (AI pipeline) ─ required by 03, 04, 05, 11, 16
Story 06 (Rules) ─ required by 03, 04, 05, 07, 08, 09, 10, 15, 19, 22
Stories 03/04/05/07/08/09/10 ─ write the events counted by ANL-0 ─ read by 13, 14, 16, 20, 21
Story 15 (Profiles) ─ used by 09 (template selection)
Story 11 (Summaries) ─ required by 12
Story 08 (Flag) ─ triggers 09 (warning) and 22 (mod note, re-scoped)
Story 21 (History panel) ─ links to 23 (allow-list add)
Story 19 (Posts) ─ depends on 02, 06, 23 · best done after PLAT-1
POL-3 (resolved) ─ Jev lives in bench/, outside the app bundle
```

### Conflicts

| Conflict | Resolution |
|---|---|
| Stories 13 and 14 read the same counters. | Kept both: 13 is a toxicity deep dive, 14 a broad health dashboard. Shared ANL-0 counters avoid duplication. |
| Story 15 presets vs "explicit settings win". | Can't be satisfied with registered defaults; profiles stay tone-only for now. |
| Story 15 Comedy mode vs Story 17. | Moot: Story 17 dropped. |
| Story 09 "modmail draft" scope vs automatic PMs in code. | Code wins (automatic PMs). Whether that's desirable is POL-1. |
| Story 02 "both providers" vs Devvit AI-provider policy. | POL-3, resolved: Gemini in the app, Jev in the offline benchmark only. |

---

## History — 2026-03-10 backlog refinement

Preserved for context. Statuses above supersede it.

| Story | What changed | Reason |
|---|---|---|
| 05 — Bot Detection | Scoped to same-subreddit behavioural signals. | Devvit can't efficiently paginate full Reddit-wide user history per event. |
| 09 — Warning Messages | Scoped to modmail drafts. *(Superseded: automatic PMs shipped in v1.1.0.)* | |
| 10 — User Bans | Text command replaced with a menu-action form. | Parsing commands from comment text is unreliable. |
| 12 — Summarize Command | Text command replaced with a post menu item. | Same as 10. |
| 13 — Toxicity Reports | On-demand snapshot; scheduled digest deferred to 20. | Needs scheduler infrastructure. |
| 15 — Moderation Profiles | Comedy removed as a threshold profile. | Undefined behaviour. |
| 17 — Meme Responses | Renamed "Humorous Warning Templates"; images removed. *(Dropped 2026-10-18.)* | No image upload API. |
| 18 — Discord | Opt-in webhook via fetch. | Outbound HTTP is supported. |
| 19–23 | Added via gap analysis. | Posts uncovered; rollups; per-user history; 22 re-scoped 2026-09-10; allow-list foundational. |
