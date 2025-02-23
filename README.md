# 🤖 Botditor: The AI-Powered Reddit Comment Guardian 🛡️

## Welcome to Botditor! 🎭
Ever wondered if that comment was written by a human or a slightly sentient toaster? **Botditor** is here to save the day! Powered by AI models like OpenAI, this bot will scan through your subreddit’s comments and:

✅ Detect toxic comments before they ruin the vibe 😡☠️  
✅ Identify spam faster than you can say "HODL 🚀"  
✅ Spot potential bots trying to infiltrate your wholesome discussions 🤖  
✅ Summarize long threads for those of us with the attention span of a goldfish 🐠  
✅ Auto-moderate based on customizable rules (because power is fun! ⚡)  
✅ Deliver insightful analytics on your subreddit's comment trends 📊  

---

## 🎯 How It Works
1. **Reddit API Integration** – Connects to your subreddit and listens for incoming comments. 👂
2. **AI-Powered Comment Analysis** – Uses OpenAI and other ML models to assess the quality of discussions. 🧠
3. **Action Time!** – Depending on what the AI finds, Botditor can:
   - Auto-remove rule-breaking comments 🚨
   - Flag sketchy users for manual review 🕵️
   - Issue polite (or savage) warning messages 💌
   - Generate reports on subreddit toxicity levels 📈
4. **Customization Galore** – Tailor Botditor’s moderation style to your subreddit’s unique personality! 😎

---

## 🔧 Installation & Setup
### 1️⃣ Prerequisites
- A Reddit account with **mod privileges** 👑
- A Reddit API key (grab one [here](https://www.reddit.com/prefs/apps)) 🔑
- An OpenAI API key for comment evaluation 🤓
- Node.js & npm installed (for running the bot) 🏗️

### 2️⃣ Installation
```sh
# Clone this repo
$ git clone https://github.com/KevinArce/botditor.git
$ cd botditor

# Install dependencies
$ npm install
```

### 3️⃣ Configuration
Create a `.env` file with your API credentials:
```
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_password
OPENAI_API_KEY=your_openai_api_key
```

### 4️⃣ Run Botditor!
```sh
$ npm start
```

Now sit back and let **Botditor** do the dirty work. 🛡️🤖

---

## 🎭 Customization & Commands
Want Botditor to go full **Judge Dredd**, or be a more chill, "let’s talk it out" kind of bot? You decide!

### 🛠️ Moderation Styles
- **Strict Mode**: If it even smells like toxicity, it’s **gone**. 🚷
- **Chill Mode**: Gives warnings first, bans later. ☮️
- **Comedy Mode**: Responds to hate with sarcasm & memes. 🎭

### 📝 Commands
| Command | Description |
|---------|-------------|
| `!botditor warn @user` | Sends a warning message. ⚠️ |
| `!botditor ban @user` | Bans a user with flair. 🚪🔨 |
| `!botditor stats` | Shows subreddit toxicity & engagement reports. 📊 |
| `!botditor summarize` | Summarizes an entire thread. 📝 |

---

## 🚀 Future Features
🔜 Sentiment tracking to see if your subreddit is getting nicer or meaner. 📉📈  
🔜 Meme-based responses to spice up moderation. 🌶️  
🔜 Integration with Discord to keep the vibes consistent across platforms. 🎙️  

---

## 🎉 Contribute to the Fun!
Got ideas? Bugs? AI-generated nightmares? Open a PR or an issue on our GitHub! Let’s make **Reddit moderation fun** (or at least tolerable). 🤝

🔗 [GitHub Repo](https://github.com/KevinArce/botditor)

---

🚀 **Botditor – Because moderating Reddit shouldn’t feel like herding cats.** 🐱

