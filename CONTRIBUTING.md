# Contributing

Thanks for helping improve Feishu Bot.

## Local Setup

1. Install Node.js 20+ and pnpm 10.23.0.
2. Install Xcode or Xcode Command Line Tools if you need the macOS app.
3. Install dependencies:

```bash
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install
```

4. Copy the sample environment file and fill only local credentials:

```bash
cp .env.example .env
```

Never commit `.env`, local SQLite data, generated app bundles, or packaged DMGs.

## Development Checks

Run the checks that match your change:

```bash
pnpm test
pnpm build
pnpm test:mac
```

Use `pnpm package:mac` only when validating the native macOS package. Build outputs stay under `dist/native-macos` and are ignored by Git.

## Pull Requests

- Keep changes focused and explain the user-facing behavior.
- Update `README.md` or `docs/` when commands, environment variables, or bridge contracts change.
- Add or adjust tests for parser, capability, session, desktop bridge, and bot orchestration changes.
- Do not include real Feishu app credentials, bridge tokens, model API keys, logs, or customer data in examples.
