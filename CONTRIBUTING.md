# Contributing to Flashcard Studio

Thanks for considering a contribution. Please discuss substantial changes in an issue before starting work.

## Development

Use Node.js and the package manager version declared in `package.json`.

```sh
pnpm install
pnpm build
```

Run the development build while working:

```sh
pnpm dev
```

## Checks

```sh
pnpm lint
pnpm test
pnpm test:e2e
```

`pnpm test:e2e` builds the plugin, stages it for the Obsidian end-to-end harness, and runs WebdriverIO. Run it on a machine that can start the test Obsidian app.

Use `pnpm format` only when you intend to format the affected source and tests. The complete local validation command is `pnpm validate`.

## Pull requests

Keep a pull request focused. Explain the user-visible change, include tests for changed behaviour, and update the new documentation where users need it. Never commit API keys, vault data, or generated plugin builds.
