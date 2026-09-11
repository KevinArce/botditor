# 🤖 Botditor: The AI-Powered Reddit Comment Guardian 🛡️

## Welcome to Botditor! 🎭
Ever wondered if that comment was written by a human or a slightly sentient toaster? **Botditor** is a [Devvit](https://developers.reddit.com) app that analyzes subreddit comments in real-time using Google's Gemini AI. It can:

✅ Detect toxic comments before they ruin the vibe 😡☠️  
✅ Identify spam faster than you can say "HODL 🚀"  
✅ Auto-remove or flag toxic comments based on configurable thresholds ⚡  
✅ Flag suspicious comments for mod queue review with structured reasons 🚩  
✅ Send warning PMs to users with configurable templates (strict/chill) ⚠️  
✅ Dry-run mode to tune moderation without affecting real content 🧪  
✅ Allow moderators to bulk-remove comment trees ("Mop" 🧹)  
✅ Ban users directly from comments with a pre-filled confirmation form 🔨  
🔜 Spot potential bots — Gemini scores bot-likelihood today, but nothing acts on it yet (Story 05) 🤖

> 📚 **Docs:** [Architecture & current state](docs/ARCHITECTURE.md) · [Backlog & action items](docs/BACKLOG.md) · [Story index](docs/README.md)

---

## 🎯 How It Works
1. **Comment Ingestion** – Listens for `CommentSubmit` events and validates each comment against guards (enabled toggle, allowlist, self-comment, deletion, duplicates). 👂
2. **AI Analysis** – Sends the comment to the Gemini API (JSON mode, 10 s timeout) for structured scoring: toxicity, spam, bot-likelihood, and sentiment. The comment goes in as delimited data, separate from the instructions, so "ignore previous instructions…" tricks are much less effective. 🧠
3. **Spam Detection** – Rule-based heuristics score the comment for spam (URL count, blocked domains, repeated body, new account). Fast, no API cost. Enforcement currently uses this rule-based score only; the AI spam score is stored but not yet acted on. 🕵️
4. **Toxicity Enforcement** – Compares the toxicity score against configurable thresholds to auto-remove, flag for review, or take no action. 🚨
5. **Spam Enforcement** – Compares the spam score against configurable thresholds. Default mode is flag-only; can be switched to auto-remove. Blocked domains trigger instant removal. 🚫
6. **Deduplication** – Removed comment IDs are stored in Redis to prevent double-removal on event re-delivery. Removals show up in Reddit's mod log under the app account. Botditor's own reason isn't attached yet ([OPS-3](docs/BACKLOG.md)). 📋
7. **Flag for Review** – Comments above the flag threshold but below auto-remove get reported to the mod queue with a structured reason (`[botditor] toxicity=0.72 — reason`). Flagged IDs are deduplicated via Redis with a 24-hour TTL. 🚩
8. **Warning Messages** – When a comment is flagged, a warning PM is sent to the author right away (before any human review) using a profile-specific template (strict = formal, chill = friendly). Templates support `{{username}}`, `{{issue}}`, and `{{rulesLink}}` placeholders and are configurable in App Settings. A 48-hour per-user cooldown prevents spam. ⚠️
9. **Safe by Default** – If the AI call fails (no key, network error, timeout, bad response), all scores default to zero, so no moderation action is taken (as long as thresholds stay above 0). 🛡️
10. **Dry-Run Mode** – Moderators can enable dry-run to see what actions *would* be taken without executing them. 🧪
11. **Caching** – Successful results are cached in Redis for 1 hour to avoid redundant API calls on event re-deliveries. ⚡

---

## 🔧 Installation & Setup

### 1️⃣ Prerequisites
- [Node.js](https://nodejs.org/) **22.2+** and npm (Devvit 0.12 requirement; 24.x recommended) 🏗️
- The [Devvit CLI](https://developers.reddit.com/docs/quickstart) installed globally, at the same version as `@devvit/public-api`:
  ```sh
  npm install -g devvit@0.12.20
  ```
  > The `devvit` entry in `devDependencies` is currently an empty placeholder package ([TOOL-1](docs/BACKLOG.md)), so the npm scripts rely on this global install.
- A Reddit account with **mod privileges** on the target subreddit 👑
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) 🔑

### 2️⃣ Clone & Install
```sh
git clone https://github.com/KevinArce/botditor.git
cd botditor
npm install
```

### 3️⃣ Log in to Devvit
```sh
devvit login
```

### 4️⃣ Configure App Secrets

Gemini credentials are stored as **encrypted Devvit App Settings** (never in source control).

Set them via the CLI:

```sh
# Required – your Gemini API key
devvit settings set geminiApiKey

# Optional – model name (defaults to gemini-3.6-flash)
devvit settings set geminiModel
```

> **Note**: These are *app-level* settings (`SettingScope.App`). They are persisted in Devvit's encrypted store and apply across all installations.

> ⚠️ **Model choice matters.** If `geminiModel` names a retired or unknown model, every analysis falls back to zero scores and toxicity moderation silently stops. The old default, `gemini-1.5-flash`, was shut down by Google on 2025-09-29. If you ever set `geminiModel` by hand, check it against Google's [model list](https://ai.google.dev/gemini-api/docs/models) and [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations). `gemini-3.5-flash-lite` is a cheaper, faster option for high-traffic subreddits.

### 5️⃣ Configure Installation Settings

After installing the app on a subreddit, moderators can configure these from the app settings page (`https://developers.reddit.com/r/<subreddit>/apps/botditor`):

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Botditor** | Master on/off toggle. When disabled, comments are received but not analyzed. | `true` |
| **Allowlisted usernames** | Comma-separated usernames whose comments always skip analysis. | (empty) |
| **Allowlisted domains** | Comma-separated domains that won't trigger spam heuristics. | (empty) |
| **Toxicity auto-remove threshold** | Comments scored at or above this value are automatically removed. Set to `1.0` to disable. | `0.85` |
| **Toxicity flag-for-review threshold** | Comments scored at or above this (but below remove) are reported for mod review. | `0.60` |
| **Spam auto-remove threshold** | Spam score at or above triggers removal (only in `remove` mode). | `0.80` |
| **Spam flag-for-review threshold** | Spam score at or above triggers a report for manual review. | `0.50` |
| **Spam enforcement mode** | `flag` (default, report only) or `remove` (auto-remove above threshold). | `flag` |
| **Blocked domains** | Comma-separated domains that trigger instant spam removal (score = 1.0). | (empty) |
| **Bot-likelihood flag threshold** | Registered but **not enforced yet** (Story 05). Changing it has no effect. | `0.75` |
| **Moderation profile** | `chill` or `strict`. Currently **only picks the warning template** below; it doesn't change any thresholds yet (Story 15). | `chill` |
| **Warning template (strict)** | PM body for flagged users under the strict profile. Supports `{{username}}`, `{{issue}}`, `{{rulesLink}}`. | (formal) |
| **Warning template (chill)** | PM body for flagged users under the chill profile. Supports `{{username}}`, `{{issue}}`, `{{rulesLink}}`. | (friendly) |
| **Dry-run mode** | Log moderation actions without executing them. Great for threshold tuning. | `false` |

> Thresholds are plain numbers between 0 and 1. They aren't range-checked yet ([COR-2](docs/BACKLOG.md)): a remove threshold of `0` would remove *every* comment.

### 6️⃣ Run Locally (Playtest)

Create a `.env` file for any local environment overrides (this file is `.gitignore`d):
```sh
touch .env
```

Then start the playtest:
```sh
npm run dev
```

This runs `devvit playtest`, which deploys a development version to your test subreddit. Visit the URL shown in the terminal to trigger comments.

### 7️⃣ Deploy to Production
```sh
npm run deploy    # uploads to Devvit
npm run launch    # publishes the app
```

> 🧹 **Never leave compiled `.js` files in `src/`.** The Devvit bundler (esbuild) and Vitest resolve `import "./ai.js"` to a real `src/ai.js` before `src/ai.ts`, so stale build output gets shipped and tested instead of your source. `npm run type-check` uses `tsc --noEmit` and no longer creates these files. If you ever run plain `tsc`, delete its output.

---

## 🌐 Fetch Domains

Devvit requires every outbound domain to be declared (`Devvit.configure({ http: { domains } })` in `src/main.ts`) and justified for app review:

- `generativelanguage.googleapis.com` — Google Gemini API, used to score each new comment for toxicity, spam, bot-likelihood and sentiment. Only the comment text is sent; Google Gemini is one of Devvit's two approved AI providers.

Apps that use fetch also need Terms of Service and Privacy Policy links in their Devvit app details. The privacy policy should disclose that comment text is sent to Google for analysis ([POL-2](docs/BACKLOG.md)).

---

## 🧪 Testing
```sh
npm run test           # run all tests once (Vitest, src/**/*.test.ts)
npm run test:watch     # run tests in watch mode
npm run type-check     # TypeScript type checking (tsc --noEmit)
```

> `npm run type-check` currently reports two known errors in `src/nuke.ts`: `context.modLog` was removed from Devvit ([OPS-3](docs/BACKLOG.md)).

---

## 📁 Project Structure
```
src/
├── main.ts              # App entry point – triggers, menus, forms
├── ai.ts                # AI analysis pipeline (Gemini API)
├── spam.ts              # Rule-based spam scoring (Story 04)
├── moderation.ts        # Toxicity & spam enforcement (remove/flag/dry-run/mod-log/dedup)
├── warnings.ts          # Warning PMs with configurable templates & 48h cooldown (Story 09)
├── commentIngestion.ts  # Comment ingestion handler
├── commentStorage.ts    # Redis persistence layer
├── allowlist.ts         # User allowlist management
├── bans.ts              # "Ban User" menu action (Story 10)
├── nuke.ts              # "Mop" bulk comment removal
├── rules.ts             # Centralized moderation rules loader (Story 06)
├── settings.ts          # Devvit settings registration
├── types.ts             # Shared types, constants, Redis key helpers
└── __tests__/           # Vitest unit tests
docs/
├── ARCHITECTURE.md      # How it works today + known limitations
├── BACKLOG.md           # Prioritized action items and verified story status
└── story-*.md           # One file per user story
```

---

## 🎭 Moderator Actions

### Comment Menu
- **Mop comments** – Remove a comment and all its children 🧹
- **Ban User** – Ban the comment's author via a pre-filled confirmation form (reason, duration, mod note) 🔨
- **Add/Remove author to allowlist** – Allowlisted users' comments skip AI analysis ✅

### Post Menu
- **Mop post comments** – Remove all comments under a post 🧹

---

## 🚀 What's Next
See [docs/BACKLOG.md](docs/BACKLOG.md). The short version:

🔧 Attach Botditor's reason to removals and record the acting moderator on bans (OPS-3)  
🔜 Bot detection enforcement (Story 05) and profile threshold presets (Story 15)  
🔜 Post analysis (Story 19), moderation stats and summaries 📈  
🧭 Migration to Devvit Web: the menu/form API this app uses is deprecated (PLAT-1)  

---

## 🎉 Contribute
Got ideas? Bugs? Open a PR or an issue on our GitHub! 🤝

🔗 [GitHub Repo](https://github.com/KevinArce/botditor)

---

🚀 **Botditor – Because moderating Reddit shouldn't feel like herding cats.** 🐱
