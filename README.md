# 🤖 Botditor: The AI-Powered Reddit Comment Guardian 🛡️

## Welcome to Botditor! 🎭
Ever wondered if that comment was written by a human or a slightly sentient toaster? **Botditor** is a [Devvit](https://developers.reddit.com) app that analyzes subreddit comments in real-time using Google's Gemini AI. It can:

✅ Detect toxic comments before they ruin the vibe 😡☠️  
✅ Identify spam faster than you can say "HODL 🚀"  
✅ Spot potential bots trying to infiltrate your wholesome discussions 🤖  
✅ Auto-moderate based on customizable rules ⚡  
✅ Allow moderators to bulk-remove comment trees ("Mop" 🧹)  

---

## 🎯 How It Works
1. **Comment Ingestion** – Listens for `CommentSubmit` events and validates each comment against guards (enabled toggle, allowlist, self-comment, deletion, duplicates). 👂
2. **AI Analysis** – Sends the comment body to the Gemini API for structured scoring: toxicity, spam, bot-likelihood, and sentiment. 🧠
3. **Safe by Default** – If the AI call fails (no key, network error, bad response), all scores default to zero — no moderation action is taken. 🛡️
4. **Caching** – Results are cached in Redis for 1 hour to avoid redundant API calls on event re-deliveries. ⚡

---

## 🔧 Installation & Setup

### 1️⃣ Prerequisites
- [Node.js](https://nodejs.org/) v18+ and npm 🏗️
- The [Devvit CLI](https://developers.reddit.com/docs/quickstart) installed globally:
  ```sh
  npm install -g devvit
  ```
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

# Optional – model name (defaults to gemini-2.5-flash)
devvit settings set geminiModel
```

> **Note**: These are *app-level* settings (`SettingScope.App`). They are persisted in Devvit's encrypted store and apply across all installations.

### 5️⃣ Configure Installation Settings

After installing the app on a subreddit, moderators can configure these from the app settings page (`https://developers.reddit.com/r/<subreddit>/apps/botditor`):

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Botditor** | Master on/off toggle. When disabled, comments are received but not analyzed. | `true` |
| **Allowlisted usernames** | Comma-separated usernames whose comments always skip analysis. | (empty) |
| **Allowlisted domains** | Comma-separated domains that won't trigger spam heuristics. | (empty) |

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

---

## 🧪 Testing
```sh
npm run test           # run all tests once
npm run test:watch     # run tests in watch mode
npm run type-check     # TypeScript type checking
```

---

## 📁 Project Structure
```
src/
├── main.ts              # App entry point – triggers, menus, forms
├── ai.ts                # AI analysis pipeline (Gemini API)
├── commentIngestion.ts  # Comment ingestion handler
├── commentStorage.ts    # Redis persistence layer
├── allowlist.ts         # User allowlist management
├── nuke.ts              # "Mop" bulk comment removal
├── settings.ts          # Devvit settings registration
├── types.ts             # Shared types, constants, Redis key helpers
└── __tests__/           # Vitest unit tests
```

---

## 🎭 Moderator Actions

### Comment Menu
- **Mop comments** – Remove a comment and all its children 🧹
- **Add/Remove author to allowlist** – Allowlisted users' comments skip AI analysis ✅

### Post Menu
- **Mop post comments** – Remove all comments under a post 🧹

---

## 🚀 Future Features
🔜 Auto-moderation rules engine based on AI scores (Story 06)  
🔜 Sentiment tracking dashboard 📈  
🔜 Configurable score thresholds for auto-remove/flag actions  

---

## 🎉 Contribute
Got ideas? Bugs? Open a PR or an issue on our GitHub! 🤝

🔗 [GitHub Repo](https://github.com/KevinArce/botditor)

---

🚀 **Botditor – Because moderating Reddit shouldn't feel like herding cats.** 🐱
