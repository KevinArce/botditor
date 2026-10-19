# Security Policy

Botditor runs with moderator permissions on Reddit communities and handles API keys for third-party AI services, so we take security reports seriously.

## Supported versions

Only the latest release (the `main` branch and the newest version published to the Reddit App Directory) receives security fixes.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/KevinArce/botditor/security/advisories/new)). Include:

- what an attacker could do, and under what conditions,
- steps to reproduce, or a proof of concept,
- the version or commit you tested.

What to expect:

| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment | within 7 business days |
| Fix or mitigation plan | depends on severity; critical issues first |

We'll credit you in the advisory unless you ask us not to. Please give us a reasonable chance to fix the issue before disclosing it publicly.

### In scope

- Ways to make Botditor remove, report, ban, or message on behalf of a moderator without their intent (including prompt injection that reliably flips a moderation decision).
- Leaks of API keys, comment content, or user data beyond what the README documents.
- Bypasses of the moderator-only menu actions or their permission checks.

### Out of scope

- Vulnerabilities in Reddit, Devvit, Google Gemini, or TypeSafe themselves — report those to the vendor.
- AI scoring that is merely inaccurate. Open a regular issue for false positives and negatives.

## Handling secrets

**Never commit credentials to git.** That includes Reddit tokens, Gemini API keys, and TypeSafe API keys, in any file, test fixture, screenshot, or log excerpt.

The app's secret, the Gemini key, lives in **Devvit's encrypted app settings**, never in source:

```sh
devvit settings set geminiApiKey   # Google Gemini API key
```

It's declared in `src/settings.ts` with `isSecret: true` and `scope: SettingScope.App`, so Devvit stores it encrypted. It's readable only by the app at runtime, and subreddit moderators never see it.

The offline benchmark (`npm run bench`) reads `GEMINI_API_KEY` and `JEV_API_KEY` from your environment or the git-ignored `.env`. Use separate, low-quota development keys there, not the production Gemini key.

Guidelines for contributors:

- `.env` is git-ignored. It's only for local overrides and benchmark keys. Never commit it, and keep production keys out of it.
- Never log an API key, a full request header, or a raw comment body. The existing code logs scores and reasons only; keep it that way.
- Gemini keys travel in the `x-goog-api-key` header, and Jev keys in `Authorization: Bearer`. Never put keys in URLs.
- Use obviously fake values (`"test-key"`) in tests.
- If a key is ever committed, **rotate it immediately** at the provider (Google AI Studio or the TypeSafe dashboard). Removing it from git history doesn't revoke it.

## Data handling

For every new comment that isn't allow-listed, the app sends the comment text (capped at 8,000 characters) to Google Gemini. Usernames and comment IDs aren't sent. The app never contacts TypeSafe. Only the local benchmark does, sending the corpus text and subreddit name from your machine. Results and comment records are stored in the installation's Devvit Redis for up to 30 days. See the README's **Fetch Domains** section for the full list of outbound domains.
