# Botditor — Backlog and Action Items

> **Source of truth** for what's done and what's next.
> **Platform**: Devvit `@devvit/public-api` 0.12.20 (latest Devvit: 0.14.3) · **AI**: Google Gemini API
> **Last verified**: 2026-09-10 — full code review of v1.2.0 (`fca785f`). Architecture and current behaviour: [ARCHITECTURE.md](./ARCHITECTURE.md).

Status legend: ✅ Done · 🟡 Partial · 🔧 In progress · ⬜ Not started · 🚫 Obsolete / re-scoped

---

## Action items (prioritized)

### P0 — broken or unsafe in production

| ID | Item | Why | Status |
|---|---|---|---|
| **OPS-1** | **Restore Gemini analysis.** Replace the retired default model and harden the request: timeout, JSON mode, API key in a header, declared fetch domain, no per-comment body logging, comment text isolated from instructions. | `geminiModel` defaulted to `gemini-1.5-flash`, which Google shut down on 2025-09-29. Devvit applies registered setting defaults, so the `gemini-2.5-flash` fallback in `ai.ts` never ran. Every call failed, scores fell back to 0, and **toxicity moderation never fired** (Stories 02/03/07/08/09 inert). | ✅ 2026-09-10 — see note ¹ |
| **OPS-2** | **Stop shipping stale build output.** Switch `type-check` to `tsc --noEmit`, limit Vitest to `*.test.ts`, delete the compiled `src/**/*.js`. | `tsc --build` wrote `.js` next to each `.ts`. The Devvit CLI's esbuild **and Vitest** resolve `./x.js` to that file before `x.ts`, so deploys and tests ran whatever was last compiled, not the source. Vitest also ran every test twice (328 = 2 × 164). | ✅ 2026-09-10 |
| **OPS-3** | **Replace the dead `context.modLog.add()` calls.** Use `reddit.addRemovalNote({ itemIds, reasonId: "", modNote })` for auto-removals. For bans, record the acting moderator in `banUser({ note })` and pass `context: commentId`. Drop or replace the call in `nuke.ts`. Update the test mocks that fake `modLog`. Also: the ban form says the reason is "Shown to the banned user", but `reason` is mod-facing (`message` is what the user sees), and ban duration must be 1–999. | Devvit removed the ModLog client between 0.12.0 and 0.12.14 (types *and* runtime). Every call throws and is swallowed, so there's no Botditor reason on removals and no record of which moderator banned or mopped. It also causes the two `nuke.ts` errors that keep `npm run type-check` red. | ⬜ **next** |

¹ **OPS-1 as shipped:** `DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"` (one constant for the setting default and the runtime fallback). `x-goog-api-key` header. `responseMimeType: application/json`. `thinkingLevel: LOW` and default temperature on Gemini 3+ (temperature 0.1 on older models). 10 s `Promise.race` timeout (Devvit's fetch ignores `AbortSignal`). `systemInstruction` plus a `<comment>`-delimited user turn. `http: { domains: ["generativelanguage.googleapis.com"] }`. `[ai:debug]` body/response logging removed. Parse errors no longer cached. 18 new tests. **Still to do by the owner:** run one `npm run dev` playtest with the real key and confirm an `[ai] Analysis complete … toxicity=…` log line. If `geminiModel` was ever set with `devvit settings set`, that value overrides the new default, so check it.

### P1 — correctness and robustness

| ID | Item | Why |
|---|---|---|
| **COR-1** | Verify in a playtest whether `event.comment.author` is a username or a `t2_` ID. Read the username from `event.author?.name` (`UserV2.name`, as established Devvit mod apps do), falling back to `comment.author`. | `warnings.ts` already works around an ID showing up. If it is an ID, the allow-list, the new-account heuristic, and the warning cooldown silently miss. |
| **COR-2** | Range-validate threshold settings (`onValidate`, 0 < x ≤ 1). Make `spamMode` and `moderationProfile` `select` settings. | A remove threshold of `0` removes every comment, including those whose AI call failed and fell back to zero scores. Values > 1 silently disable actions. Typos in the free-text settings fall back without warning. |
| **COR-3** | Feed the AI spam score into enforcement when the rule-based score is < 0.5 (Story 04 AC). | `enforceSpam` only sees the rule-based `SpamResult`. The merged `analysis.spamScore` is stored but never acted on. |
| **COR-4** | Redis retention: put TTLs on `comment:*`, `removed:*`, `ban:*` and trim `comments:index:*`. | Nothing per-comment expires. Devvit's 5 GB per-installation quota blocks writes when full, and `saveComment` then throws, so ingestion stops. |
| **COR-5** | Make `saveComment` atomic (`set(key, v, { nx: true })`). | Get-then-set lets concurrent re-deliveries both pass the duplicate check. |
| **PERF-1** | Read settings once per trigger (`settings.getAll()`) and pass the values down. | About 15 `settings.get()` calls per comment, and each one fetches *all* settings over plugin RPC. |
| **TOOL-1** | Fix the `devvit` devDependency: pin `0.12.20` (matching `@devvit/public-api`) or remove it and rely on the global CLI the README already requires. Stop Dependabot from "upgrading" it. | `devvit@1.0.0` is an empty 2022 placeholder with no CLI (Dependabot commit `c9a3315`). Scripts only work because a global CLI exists. |
| **TOOL-2** | Add at least one pipeline-level test using `@devvit/test` (installed, unused), or type the hand-written mocks against the real client types. | Hand-rolled mocks drifted from the real API (`modLog`) and hid a production failure. |

### P1 — product and policy decisions (need the owner's call)

| ID | Question | Context |
|---|---|---|
| **POL-1** | Should warning PMs go out automatically on a *flag*? | They're sent before any human review, so AI false positives warn innocent users. Options: opt-in setting (default off), or warn only on removal. |
| **POL-2** | App-review readiness for fetch. | Devvit requires Terms and Privacy Policy links for any app that uses fetch. Gemini receives comment text, so the privacy policy must say so. The README "Fetch Domains" section was added in this review. |

### P2 — platform

| ID | Item | Why |
|---|---|---|
| **PLAT-1** | Plan the migration to Devvit Web (`@devvit/web`, `devvit.json`, server endpoints for menu items/forms/triggers) and the upgrade from 0.12.20 to 0.14.x. | Devvit 0.13.0 deprecated `@devvit/public-api` menu actions and forms ("support will be dropped in the future"), removed `Devvit.Context` (used by `bans.ts` and `nuke.ts`), and removed `kvStore`. The official Comment Mop template that `nuke.ts` came from is now Devvit Web. |

### Feature order after P0/P1

1. **Story 05 — Bot detection enforcement.** The `botFlagThreshold` setting is shown to moderators but does nothing. Implement it or hide it.
2. **Story 15 — Profile threshold presets.**
3. **Story 19 — Post-level analysis.**
4. **ANL-0 (new) — Date-keyed moderation counters.** Written at action time and shared by Stories 13/14/20/21. Nothing writes per-day counters yet, and `flagged:*` expires after 24 h.
5. Stories 14 → 13 → 20 → 21 (analytics), 11 → 12 (summaries), 22 (re-scoped), 16, 17, 18.

---

## Story status (verified against code, 2026-09-10)

| ID | Story | Status | Notes |
|---|---|---|---|
| 01 | Comment Ingestion | ✅ | All ACs met. Author-identity caveat: COR-1. |
| 02 | AI Analysis Pipeline | ✅ | Restored and hardened by OPS-1 (current model, 10 s timeout AC now met, JSON mode). Pending one live playtest. The prompt omits the account age/karma the story sketches (deliberate simplification). |
| 03 | Toxicity Detection | 🟡 | Remove/report/dry-run work. The "written to the mod log with the Gemini reason" AC isn't met (OPS-3). |
| 04 | Spam Detection | 🟡 | All rule heuristics, blocked domains, flag/remove modes done. AI spam score isn't used for enforcement (COR-3). |
| 05 | Bot Detection | ⬜ | `botLikelihood` stored and `botFlagThreshold` loaded; no enforcement, no behavioural heuristics. |
| 06 | Auto-Moderation Rules | ✅ | Centralised `rules.ts` with remove ≥ flag clamping. Gaps: no range validation, free-text instead of `select` (COR-2). "Startup audit log" is logged per trigger. |
| 07 | Auto-Remove Comments | 🟡 | Removal, Redis dedup, dry-run done. Mod-log entry is dead code (OPS-3). |
| 08 | Flag for Manual Review | ✅ | Structured reasons, 24 h dedup. |
| 09 | Warning Messages | ✅ | Ships *automatic* PMs (the backlog had scoped this down to modmail drafts). Profile templates, placeholders, 48 h cooldown, dry-run. Policy question: POL-1. |
| 10 | User Bans via Menu | 🟡 | Form, permission check (`all` / `access`), error handling, analytics record done. Mod-log entry dead; acting mod not recorded; misleading "reason" help text (OPS-3). |
| 11 | Thread Summarization | ⬜ | |
| 12 | Summarize Command (menu) | ⬜ | Depends on 11. |
| 13 | Toxicity Reports (snapshot) | ⬜ | Needs ANL-0. |
| 14 | Subreddit Stats | ⬜ | Needs ANL-0. `comments:count` and `bans:count` exist. |
| 15 | Moderation Style Profiles | 🟡 | Setting exists and picks the warning template. Threshold presets not implemented. |
| 16 | Sentiment Tracking | ⬜ | Sentiment is stored per comment. |
| 17 | Humorous Warning Templates | ⬜ | Could reuse the Story 09 template machinery. |
| 18 | Discord Webhook | ⬜ | `discord.com` is on Devvit's global fetch allow-list but must still be declared. |
| 19 | Post-Level Analysis | ⬜ | |
| 20 | Scheduled Metrics Aggregation | ⬜ | Needs ANL-0. |
| 21 | User Moderation History Panel | ⬜ | Feasible as a read-only form. Needs per-user counters (ANL-0). |
| 22 | ~~Comment Flair on Detection~~ → Mod Note on Detection | 🚫 re-scoped | Reddit and Devvit have **no comment flair** (only user and post flair). Re-scoped to a private mod note via `reddit.addModNote({ subreddit, user, note, label: "ABUSE_WARNING" \| "SPAM_WARNING", redditId })`. |
| 23 | Configurable Allow-list | ✅ | Users (Redis + settings), domains (URL heuristic), menu actions, self-allowlist, fail-open. Post path arrives with Story 19. |

---

## Review log — 2026-09-10

- **Completed but mislabelled:** 02, 03, 06, 09, 10 were marked "Keep & Enrich / Scoped Down" in this file but are implemented (fully or partially) in code. Statuses corrected above.
- **Partially completed:** 03, 04, 07, 10, 15 — gaps listed in the table.
- **Broken:** 02 (retired model → OPS-1, **fixed in this review**), 07/10 (dead mod-log API → OPS-3, next).
- **Obsolete / re-scoped:** 22 (no comment flair exists). The `kvStore` references in stories 02, 04, 05, 13, 14, 16, 21, 23 now mean **Redis**: `kvStore` was removed in Devvit 0.13 and the code already uses Redis.
- **Reprioritized:** platform health (OPS-*) now comes before any new feature. Story 05 moves up because its setting is already visible to moderators.
- **Added:** OPS-1/2/3, COR-1…5, PERF-1, TOOL-1/2, POL-1/2, PLAT-1, ANL-0.

---

## Dependency map

```
Story 23 (Allow-list) ─ required by 01, 04, 19
Story 01 (Ingestion) ─ required by 02 (AI pipeline) ─ required by 03, 04, 05, 11, 16
Story 06 (Rules) ─ required by 03, 04, 05, 07, 08, 09, 10, 15, 19, 22
Stories 03/04/07/08/09/10 ─ write the events counted by ANL-0 ─ read by 13, 14, 20, 21
Story 15 (Profiles) ─ used by 09 (template selection) and 17 (tone variants)
Story 11 (Summaries) ─ required by 12
Story 08 (Flag) ─ triggers 09 (warning) and 22 (mod note, re-scoped)
Story 21 (History panel) ─ links to 23 (allow-list add)
Story 19 (Posts) ─ depends on 02, 06, 23
OPS-1 ─ unblocks the value of 02, 03, 07, 08, 09 · OPS-3 ─ completes 03, 07, 10
```

### Conflicts

| Conflict | Resolution |
|---|---|
| Stories 13 and 14 read the same counters. | Kept both: 13 is a toxicity deep dive, 14 a broad health dashboard. Shared ANL-0 counters avoid duplication. |
| Stories 10/12 vs README text commands (`!botditor ban`, `!botditor summarize`). | Resolved — the README only documents menu actions. |
| Story 15 Comedy mode vs Story 17. | Comedy is only a warning-template tone (Story 17). |
| Story 06 `dryRun` vs Story 07's own dry-run. | Unified: single `dryRunMode` setting read through `rules.ts`. |
| Story 09 "modmail draft" scope vs automatic PMs in code. | Code wins (automatic PMs). Whether that's desirable is POL-1. |
| README/stories said the moderation profile changes thresholds. | Corrected in the README. Presets are Story 15 work. |

---

## History — 2026-03-10 backlog refinement

Preserved for context. Statuses above supersede it.

### Scoped down (⚠️)
| Story | What changed | Reason |
|---|---|---|
| 05 — Bot Detection | Scoped to same-subreddit behavioural signals. | Devvit can't efficiently paginate full Reddit-wide user history per event. |
| 09 — Warning Messages | Scoped to modmail drafts; automatic sending deferred. *(Superseded: automatic PMs were implemented in v1.1.0.)* | Reliable automated modmail needs elevated permissions. |
| 10 — User Bans | Text command replaced with a menu-action form. | Parsing commands from comment text is unreliable. |
| 12 — Summarize Command | Text command replaced with a post menu item. | Same as 10. |
| 13 — Toxicity Reports | On-demand snapshot; scheduled digest deferred to 20. | Needs scheduler infrastructure. |
| 15 — Moderation Profiles | Comedy removed as a threshold profile; kept as a template tone (17). | Threshold-based comedy mode was undefined. |
| 17 — Meme Responses | Renamed "Humorous Warning Templates"; images removed. | No Devvit API for bots to upload images to comments. |
| 18 — Discord | Opt-in webhook via fetch; copyable summary fallback. | Outbound HTTP is supported. |

### Added via gap analysis (🆕)
| Story | Rationale |
|---|---|
| 19 — Post-Level Analysis | `PostSubmit` mirrors `CommentSubmit`; posts were uncovered. |
| 20 — Scheduled Metrics Aggregation | Scheduler enables daily rollups instead of reading unbounded keys. |
| 21 — User Moderation History Panel | Per-user data exists after action stories run. |
| 22 — Comment Flair on Detection | *(Re-scoped 2026-09-10: comment flair doesn't exist.)* |
| 23 — Configurable Allow-list | Foundational false-positive suppression. |
