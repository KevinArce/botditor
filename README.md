# 🤖 Botditor: The AI-Powered Reddit Comment Guardian 🛡️

[![CI](https://github.com/KevinArce/botditor/actions/workflows/ci.yml/badge.svg)](https://github.com/KevinArce/botditor/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Devvit](https://img.shields.io/badge/Devvit-0.12.20-FF4500?logo=reddit&logoColor=white)](https://developers.reddit.com)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](LICENSE)

Ever wondered if that comment was written by a human or a slightly sentient toaster? **Botditor** is a [Devvit](https://developers.reddit.com) moderation app that scores every new comment in your subreddit with AI and fast rule-based heuristics, then removes it, reports it, or lets it be, all according to thresholds you set.

✅ Detects toxic comments, then auto-removes them or reports them to the mod queue ⚡  
✅ Catches spam with zero-cost heuristics plus an AI second opinion 🕵️  
✅ Reports likely bots for human review (never auto-removes or bans) 🤖  
✅ Sends warning PMs with configurable strict/chill templates and a 48 h cooldown ⚠️  
✅ Records Botditor's reason on every removal and the acting moderator on every ban 📋  
✅ Dry-run mode to tune thresholds without touching real content 🧪  
✅ Bulk-removes comment trees ("Mop" 🧹) and bans users from a pre-filled form 🔨  
✅ Powered by Google Gemini, with an offline benchmark against TypeSafe Jev (`npm run bench`) 🧠

> 📚 **Docs:** [Architecture & current state](docs/ARCHITECTURE.md) · [Backlog & action items](docs/BACKLOG.md) · [Story index](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

---

## 🎯 How It Works

1. **Comment Ingestion.** Listens for `CommentSubmit` events and checks guards: the enabled toggle, the allow-list, self-comments, deleted comments, and duplicate deliveries (an atomic Redis `SET NX`). The author's username comes from `event.author.name`. 👂
2. **AI Analysis.** Google Gemini scores toxicity, spam, bot-likelihood, and sentiment (JSON mode, 10 s timeout, comment isolated from instructions to resist prompt injection). Results are cached for 1 hour. 🧠
3. **Spam Blend.** Rule-based heuristics (URL count, blocked domains, repeated body, new account) score the comment at no API cost. A rule score ≥ 0.5 is final. Below that, the higher of the rule and AI spam scores is enforced. 🕵️
4. **Toxicity Enforcement.** At or above the remove threshold, the comment is removed with a mod-facing removal note (`[botditor] <reason>`). At or above the flag threshold, it's reported to the mod queue with `[botditor] toxicity=0.72 — <reason>`. 🚨
5. **Spam Enforcement.** Flag-only by default; switch to `remove` mode to auto-remove. Blocked domains are always removed. 🚫
6. **Bot Detection.** When the AI bot-likelihood reaches `botFlagThreshold`, the comment is reported for review. Botditor never removes or bans for this, and never PMs the author. 🤖
7. **Warning Messages.** When a comment is flagged for toxicity or spam, the author gets a warning PM straight away, before any human review, using the profile's template. A 48-hour per-user cooldown applies. ⚠️
8. **Safe by Default.** If the AI call fails (no key, network error, timeout, bad response), all scores are zero and nothing happens. Thresholds are range-checked, so a `0` can't make Botditor remove everything. 🛡️
9. **Bounded Storage.** Comment records expire after 30 days and removal dedup keys after 7, so Redis stays well under Devvit's 5 GB quota. 📦

---

## 🧠 AI Provider & Benchmark

The app uses **Google Gemini** (`gemini-3.6-flash` by default) and nothing else. Devvit's [HTTP fetch policy](https://developers.reddit.com/docs/capabilities/http-fetch) permits only OpenAI and Google Gemini as AI providers, and it reviews fetch domains for playtests as well as uploads. So no other AI service can run inside a Devvit app.

**TypeSafe Jev is benchmarked offline.** `npm run bench` runs on your own machine. It scores a local corpus with both Gemini and TypeSafe Jev (System One, `jev-1.13.0`) and compares them using the app's own thresholds:

```sh
# .env (git-ignored): GEMINI_API_KEY=…  JEV_API_KEY=…   optional: GEMINI_MODEL, JEV_MODEL
npm run bench                                  # synthetic bench/corpus.example.jsonl
npm run bench -- my-corpus.jsonl --concurrency 4
```

It reports, per provider:
- **Latency:** mean, p50 and p95.
- **Score differences:** mean |Δ| for toxicity, spam and bot.
- **Decision agreement:** toxicity action (remove/flag/none), spam flag, bot flag, and sentiment.
- **Accuracy:** precision and recall for any items labelled with `expected`.

Full results go to `bench/results/<timestamp>.json`, which is git-ignored. The corpus format is documented at the top of [`bench/corpus.example.jsonl`](bench/corpus.example.jsonl). Use synthetic text or your own test comments: the benchmark sends the text to Google and TypeSafe.

---

## 🔧 Installation & Setup

### 1️⃣ Prerequisites
- [Node.js](https://nodejs.org/) **22.2+** and npm (24.x recommended).
- A Reddit account with **mod privileges** on a test subreddit.
- A [Google Gemini API key](https://aistudio.google.com/app/apikey).
- *(Optional, benchmark only)* A [TypeSafe](https://docs.typesafe.ai) API key.

The Devvit CLI is a pinned devDependency (`devvit@0.12.20`, matching `@devvit/public-api`), so `npm install` provides it and the npm scripts use it. No global install is needed. Run it directly with `npx devvit …`.

### 2️⃣ Clone & Install
```sh
git clone https://github.com/KevinArce/botditor.git
cd botditor
npm install
```

### 3️⃣ Log in to Devvit
```sh
npm run login        # = devvit login
```

### 4️⃣ Configure App Secrets

API keys are stored as **encrypted Devvit app settings**, never in source control ([SECURITY.md](SECURITY.md#handling-secrets)):

```sh
npx devvit settings set geminiApiKey     # required
npx devvit settings set geminiModel      # optional — defaults to gemini-3.6-flash
```

These are *app-level* settings (`SettingScope.App`). They apply across all installations, and subreddit moderators can't see them.

> ⚠️ **Model choice matters.** If `geminiModel` names a retired or unknown model, every analysis falls back to zero scores and moderation silently stops. The old default, `gemini-1.5-flash`, was shut down by Google on 2025-09-29. If you set `geminiModel` by hand, check it against Google's [model list](https://ai.google.dev/gemini-api/docs/models) and [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations). `gemini-3.5-flash-lite` is a cheaper, faster option for high-traffic subreddits. `npm run bench` with `GEMINI_MODEL=…` is a quick way to compare models before switching.

### 5️⃣ Configure Installation Settings

Moderators set these per subreddit at `https://developers.reddit.com/r/<subreddit>/apps/botditor`. Thresholds must be **greater than 0 and at most 1**. The form rejects other values, and the runtime falls back to the default if an older saved value is out of range.

| Setting | Description | Default |
|---|---|---|
| **Enable Botditor** | Master on/off toggle. When off, comments aren't analyzed. | `true` |
| **Allowlisted usernames** | Comma-separated usernames whose comments always skip analysis. | (empty) |
| **Allowlisted domains** | Comma-separated domains that don't count toward the URL heuristic. | (empty) |
| **Toxicity auto-remove threshold** | Remove at or above this score. `1.0` removes only maximum-score comments. | `0.85` |
| **Toxicity flag-for-review threshold** | Report at or above this score (below the remove threshold). | `0.60` |
| **Spam auto-remove threshold** | Remove at or above this score. Only in `remove` mode. | `0.80` |
| **Spam flag-for-review threshold** | Report at or above this score. | `0.50` |
| **Spam enforcement mode** | `flag` (report only) or `remove`. | `flag` |
| **Blocked domains** | Comma-separated domains that trigger instant spam removal. | (empty) |
| **Bot-likelihood flag threshold** | Report at or above this AI bot-likelihood. Never removes or bans. | `0.75` |
| **Moderation profile** | `chill` or `strict`. Picks the **warning PM template** only; it doesn't change thresholds ([why](docs/story-15-moderation-styles.md)). | `chill` |
| **Warning template (strict)** | PM body under the strict profile. Placeholders: `{{username}}`, `{{issue}}`, `{{rulesLink}}`. | (formal) |
| **Warning template (chill)** | PM body under the chill profile. Same placeholders. | (friendly) |
| **Dry-run mode** | Log what would happen without acting. Great for tuning. | `false` |

App-level settings (developer only): `geminiApiKey` (secret) and `geminiModel`.

> 🆕 **Upgrading to 1.5.0?** Bot-likelihood reporting (Story 05) is now active at the existing `0.75` default, and the AI spam score now counts toward spam reports. Both produce **reports only** in the default `flag` mode. In spam `remove` mode, a high AI spam score alone can now remove a comment. Use dry-run first if you want to preview the volume.

### 6️⃣ Run Locally (Playtest)

```sh
touch .env      # optional local overrides; git-ignored
npm run dev     # devvit playtest on your test subreddit
```

Start with dry-run on and watch the logs for `[ingestion]`, `[ai]` and `[moderation]` lines. More in [CONTRIBUTING.md](CONTRIBUTING.md#playtesting).

### 7️⃣ Deploy (maintainers)
```sh
npm run deploy    # devvit upload
npm run launch    # devvit publish (submits for review)
```

> 🧹 **Never leave compiled `.js` files in `src/`.** The Devvit bundler and Vitest resolve `import "./ai.js"` to a real `src/ai.js` before `src/ai.ts`, so stale build output gets shipped and tested instead of your source. `npm run type-check` uses `tsc --noEmit` and emits nothing.

---

## 🌐 Fetch Domains

Devvit requires every outbound domain to be declared (`Devvit.configure({ http: { domains } })` in `src/main.ts`) and justified for app review:

- **`generativelanguage.googleapis.com`** — Google Gemini API. Scores each new, non-allow-listed comment for toxicity, spam, bot-likelihood and sentiment. Only the comment text is sent (≤ 8,000 characters). Google Gemini is one of Devvit's approved AI providers.
The app requests no other domain. TypeSafe (`api.typesafe.ai`) is called only by the local `npm run bench` script, never by the Devvit app, because Devvit permits only OpenAI and Google Gemini as AI providers.

Apps that use fetch also need Terms and Privacy Policy links in their Devvit app details: see [Terms & Conditions](TERMS.md) and [Privacy Policy](PRIVACY.md).

---

## 🧪 Testing

```sh
npm test               # Vitest — src/** and bench/** tests once (299 tests)
npm run test:watch     # watch mode
npm run type-check     # tsc --noEmit — must exit 0
```

CI runs both on every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## 📁 Project Structure
```
src/
├── main.ts              # Entry point – Devvit.configure, trigger, menus, forms
├── commentIngestion.ts  # CommentSubmit handler – guards + pipeline orchestration
├── ai.ts                # Gemini analysis (cache) + context-free requestGeminiAnalysis()
├── jev.ts               # TypeSafe Jev System One client — benchmark only, not bundled
├── spam.ts              # Rule-based spam heuristics + AI blend
├── rules.ts             # Loads + validates moderation settings
├── settingsSnapshot.ts  # One settings RPC per comment
├── moderation.ts        # Toxicity / spam / bot enforcement, removal notes, dedup
├── warnings.ts          # Warning PMs with templates and 48 h cooldown
├── commentStorage.ts    # Redis persistence with TTLs
├── allowlist.ts         # User allow-list
├── bans.ts              # "Ban User" form handler
├── nuke.ts              # "Mop" bulk removal
├── settings.ts          # Devvit settings registration + validators
├── types.ts             # Shared types, constants, Redis key builders
└── __tests__/           # Vitest unit and pipeline tests
bench/                   # Offline Gemini-vs-Jev benchmark (npm run bench) + example corpus
docs/                    # Architecture, backlog, one file per user story
```

---

## 🎭 Moderator Actions

**Comment menu**
- **Mop comments.** Remove and/or lock a comment and all its replies. Records the acting moderator in a removal note. 🧹
- **Ban User.** Pre-filled form: a mod-facing reason, an optional message to the user, duration (0 = permanent, 1–999 days), and a mod note. The acting moderator and the offending comment are recorded. 🔨
- **Add/Remove author to allowlist.** Allow-listed users' comments skip analysis. ✅

**Post menu**
- **Mop post comments.** Remove and/or lock every comment on a post. 🧹

---

## 🚀 What's Next

See [docs/BACKLOG.md](docs/BACKLOG.md). The short version:

🧪 Benchmark Gemini vs TypeSafe Jev on a real labelled corpus (`npm run bench`)  
📈 Date-keyed moderation counters (ANL-0), then stats and reports (Stories 14, 13, 20, 21)  
📝 Post-level analysis (Story 19)  
🧱 Migration to Devvit Web: the menu/form API this app uses is deprecated (PLAT-1)  

---

## 🤝 Contribute

Bugs, ideas, and PRs are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately through [SECURITY.md](SECURITY.md).

## 📄 License

[BSD 3-Clause](LICENSE) · [Terms & Conditions](TERMS.md) · [Privacy Policy](PRIVACY.md)

---

🚀 **Botditor – Because moderating Reddit shouldn't feel like herding cats.** 🐱
