# Contributing to Botditor

Thanks for helping make Reddit moderation less painful. This guide gets you from a fresh clone to a merged pull request.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pipeline works today, and [docs/BACKLOG.md](docs/BACKLOG.md) for what's planned. Backlog IDs (`OPS-3`, `COR-2`, …) and story numbers are the shared vocabulary in issues and PRs.
- For anything bigger than a bug fix, open an issue first so we can agree on the approach. That matters most for changes that alter moderation behavior on live subreddits.

## Local setup

### Prerequisites

- **Node.js 22.2 or newer** (24.x recommended) and npm.
- A Reddit account that moderates a **test subreddit** you control. Never playtest on a real community.
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) if you want real AI scores. Without one, analysis falls back to zero scores and no moderation actions fire.

### Install

```sh
git clone https://github.com/KevinArce/botditor.git
cd botditor
npm install
```

`npm install` also installs the Devvit CLI locally (`devvit@0.12.20`, pinned to match `@devvit/public-api`), so the npm scripts work without a global install. To call the CLI directly, use `npx devvit …`.

### Log in and configure secrets

```sh
npx devvit login
npx devvit settings set geminiApiKey     # stored encrypted by Devvit
```

Never put keys in source, tests, or screenshots. See [SECURITY.md](SECURITY.md#handling-secrets).

## Development loop

| Command | What it does |
|---|---|
| `npm test` | Runs every Vitest suite once (`src/**/*.test.ts`). |
| `npm run test:watch` | Re-runs tests on save. |
| `npm run type-check` | `tsc --noEmit`. Must exit 0. |
| `npm run dev` | `devvit playtest` against your test subreddit, with hot reload. |
| `npm run bench` | Offline Gemini-vs-TypeSafe-Jev comparison on a local corpus (see below). |

**Both `npm test` and `npm run type-check` must pass before you open a PR.** CI isn't set up yet, so reviewers run them locally.

> ⚠️ Never run plain `tsc` or `tsc --build`. They emit `.js` files next to the sources, and both the Devvit bundler and Vitest then pick up the stale `.js` instead of your `.ts`. If it happens, delete the emitted files from `src/`.

### Playtesting

1. Use a **private test subreddit** where you are a moderator.
2. Run `npm run dev` and open the URL it prints.
3. Start with **Dry-run mode** on (app settings on `developers.reddit.com/r/<sub>/apps/botditor`). Botditor then logs `DRY RUN: Would remove…` instead of acting.
4. Post comments that should and shouldn't trigger each rule, and watch the playtest logs for `[ai]`, `[moderation]` and `[ingestion]` lines.
5. Turn dry-run off only once the logs look right.

Don't paste real users' comments into issues or PRs. Write your own test text.

### Benchmarking AI providers

The app calls only Gemini, because Devvit permits only OpenAI and Gemini as AI providers. To compare TypeSafe Jev (or another Gemini model) with it, run the benchmark on your machine:

1. Put development keys in `.env`: `GEMINI_API_KEY=…` and `JEV_API_KEY=…`. Optionally set `GEMINI_MODEL` / `JEV_MODEL`.
2. Run `npm run bench`, or pass your own corpus: `npm run bench -- corpus.jsonl --concurrency 4`.
3. Read the terminal report. The full rows are in `bench/results/` (git-ignored).

Corpus lines look like `{"id":"…","text":"…","subreddit":"…","expected":{"toxic":true}}`. Use synthetic text or comments from your own test subreddit, and don't commit real users' content. Never add a non-approved AI domain to `Devvit.configure({ http })`; `main.test.ts` will fail.

## Code standards

- **TypeScript strict mode.** No `any` in source files. Tests may cast mocks with `as unknown as TriggerContext`.
- **Fail safe.** Every stage catches its own errors and returns a safe value (`"none"`, zero scores, `{ success: false }`). One bad comment must never crash the trigger, and an AI failure must never cause a removal.
- **Idempotent side effects.** Anything that removes, reports, bans, or messages needs a Redis dedup key so re-delivered events are harmless.
- **Give new Redis keys a TTL** (or a written reason why not), add the builder to `REDIS_KEYS` in `src/types.ts`, and add the key to the data-model table in `docs/ARCHITECTURE.md`.
- **New settings:** register them in `src/settings.ts`, add the name to `SETTINGS`, give thresholds an `onValidate`, and document them in the README settings table.
- **Logging:** use a `[module]` prefix. Never log comment bodies, raw model output, or keys.
- **Tests:** every behavior change comes with tests. Mocks should mirror the real Devvit API, including return values. For example, `redis.set(..., { nx: true })` returns `""` when the key exists. Don't mock APIs Devvit no longer has.
- **Match the surrounding style:** the public wrapper catches errors and `…Inner` holds the logic; JSDoc on exported functions; story or backlog IDs in comments where they explain *why*.

## Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <summary in the imperative, ≤ 72 chars>

<optional body: what and why, wrapped at 72>

<optional footer: Refs #123, BREAKING CHANGE: …>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`. Common scopes: `ai`, `bench`, `moderation`, `spam`, `bans`, `storage`, `settings`, `docs`.

Examples from this repo's history:

```
fix(ai): replace retired gemini-1.5-flash default and harden Gemini requests
feat(ai): integrate TypeSafe Jev decision model with multi-provider routing
```

## Pull requests

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep each PR to one concern. Large refactors and behavior changes go in separate PRs.
3. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md), including the moderation-impact section.
4. Update the docs in the same PR: README settings table, `docs/ARCHITECTURE.md`, and the story or backlog status.
5. Bump versions only in release PRs, and keep `package.json` and `devvit.yaml` in sync. `devvit upload` may bump `devvit.yaml` itself; never lower it.
6. A maintainer reviews, and may playtest on a test subreddit before merging.

Only maintainers run `devvit upload` or `devvit publish`.

## License

By contributing, you agree that your contributions are licensed under the [BSD 3-Clause License](LICENSE).
