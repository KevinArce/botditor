# Botditor Privacy Policy

**Effective date:** October 18, 2026

Botditor is an open-source moderation app for Reddit, built on Reddit's Developer Platform (Devvit). It's maintained by Kevin Arce (Reddit: [u/CallMeKev1](https://www.reddit.com/user/CallMeKev1)). This policy explains what data Botditor handles when a subreddit's moderators install it, why, where the data goes, and how long it's kept.

Botditor runs entirely on Reddit's infrastructure. It has no servers, databases, or analytics of its own.

## Who this affects

- **Moderators** of subreddits that install Botditor.
- **Reddit users** who comment in those subreddits.

## What Botditor processes, and why

When someone posts a comment in a subreddit where Botditor is installed and enabled, Botditor processes:

| Data | Why |
|---|---|
| Comment text, comment ID, post ID, subreddit name, creation time | To score the comment and act on it according to the moderators' settings |
| The comment author's username | To apply the moderators' allow-list, detect repeated identical comments, send warning messages, and record bans |
| The author's account age and karma (read from Reddit, not stored on their own) | As one spam signal (very new, low-karma accounts) |

Botditor skips comments from allow-listed users and from the app's own account. It doesn't process comments in subreddits where it isn't installed, and it doesn't read private messages or users' history elsewhere on Reddit.

### Automated decisions

Based on scores and moderator-configured thresholds, Botditor may automatically:

- **remove** a comment,
- **report** it to the subreddit's moderators for review, or
- **send its author a warning** by private message.

Moderators can also ban users through Botditor's "Ban User" form. Automated scores can be wrong, and moderators review reported content and can reverse any removal.

## Data shared with Google (Gemini API)

To score a comment for toxicity, spam, bot-likelihood and sentiment, Botditor sends **the comment text only** (up to 8,000 characters) to Google's Gemini API (`generativelanguage.googleapis.com`). Botditor does **not** send usernames, user IDs, comment IDs, or any other account data to Google.

Google processes this text under the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) and the [Google Privacy Policy](https://policies.google.com/privacy). Those terms describe how Google may retain or use submitted content, which depends on the type of API access used.

Botditor shares data with no other third party. It doesn't sell data, show ads, or use tracking or cookies.

## Where data is stored and for how long

Botditor stores data in the Redis database Reddit provides to each installation. It's kept separately per subreddit, and only Botditor in that subreddit can access it.

| Data | Retention |
|---|---|
| Comment record: text (up to 4,000 characters), IDs, author username, timestamps, scores, action taken | 30 days |
| Cached analysis result for a comment | 1 hour |
| Fingerprint of a comment's text with the author's username (repeated-comment detection) | 10 minutes |
| Record that a comment was reported (score, reason, time) | 24 hours |
| Record that a user was sent a warning (comment ID, reason, time) | 48 hours |
| Record that a comment was removed | 7 days |
| Ban record: username, reason, duration, acting moderator, comment ID, time | Until deleted (no automatic expiry) |
| Allow-list entries (usernames added by moderators) | Until a moderator removes them |
| Totals of comments processed and bans issued in the subreddit | Until deleted (no automatic expiry) |

Reddit also keeps:

- The **operational logs** Devvit collects from the app, which include usernames, comment IDs, scores and reasons, but never comment text. Reddit retains these under its own policies.
- The **reports, removal notes, ban notes and private messages** Botditor creates. They live in Reddit's normal moderation tools and inbox, and follow Reddit's retention.

Reddit's own handling of all data is covered by the [Reddit Privacy Policy](https://www.reddit.com/policies/privacy-policy).

## Your choices

- **Moderators** can turn Botditor off, use dry-run mode (no actions taken), allow-list users, or uninstall it at any time from the subreddit's app settings.
- **Reddit users** who want their data removed from a subreddit's Botditor storage, or who have questions, can contact the maintainer (below) or that subreddit's moderators. Data you've deleted from Reddit itself is handled by Reddit.

## Children

Botditor is a tool for Reddit communities and is subject to Reddit's age requirements. It doesn't knowingly collect data about anyone under the minimum age to use Reddit.

## Changes

If this policy changes, the updated version will be published at this address with a new effective date. Material changes will also be noted in the project's release notes.

## Contact

- Reddit: [u/CallMeKev1](https://www.reddit.com/user/CallMeKev1)
- GitHub: [open an issue](https://github.com/KevinArce/botditor/issues). For anything sensitive, use a [private security report](https://github.com/KevinArce/botditor/security/advisories/new) instead.
