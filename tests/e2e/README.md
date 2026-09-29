# End-to-end tests

Runs the real plugin inside a real Obsidian app with
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service) (WebdriverIO).
Unit tests stay in `tests/unit` (Jest); `jest.config.js` only looks in `src/` and `tests/unit/`, so
`pnpm jest` never picks these up.

## Run

```bash
pnpm test:e2e
```

The first run downloads Obsidian and a matching chromedriver into `.obsidian-cache/` (gitignored),
so it needs network and takes a few minutes. Later runs reuse the cache.

`pnpm test:e2e` does three things:

1. `node esbuild.config.mjs production` builds the plugin to `build/main.js`.
2. `node tests/e2e/stage-plugin.mjs` copies `build/main.js`, `manifest.json` and `styles.css` into
   `.e2e-plugin/` (gitignored). The service only loads a plugin from a directory that has
   `manifest.json` and `main.js` side by side.
3. `wdio run ./wdio.conf.mts` starts Obsidian and runs `tests/e2e/specs/**/*.e2e.ts`.

## How it works

- `wdio.conf.mts` (repo root) defines two capabilities, both on the latest Obsidian, resolved to a
  concrete version at start-up: **desktop**, and **emulated mobile** (`emulateMobile: true` with a
  390x844 window, which uses Obsidian's `app.emulateMobile`). Every spec runs under both, each in
  its own sandboxed Obsidian and its own copy of the vault.
- The service copies `tests/e2e/vault/` for each session and enables the plugin itself, so the
  fixture vault has no `.obsidian/` folder. Edits made by tests never touch the fixture.
- `tests/e2e/vault/CIA/Part1/Deck.md` holds the fixture cards: three multi-line cards and one cloze
  line, under a `#flashcards` tag (which makes the deck "flashcards").
- Specs use `obsidianPage.resetVault()` in `beforeEach` to restore the fixture notes without
  restarting Obsidian.
- The plugin id is read from `manifest.json` at runtime; do not hard-code it in specs.
- Selectors are the plugin's `sr-` classes. Review opens as a modal by default or as a tab when
  `openViewInNewTab` is set, and both wrap the deck list in `.sr-view`.

## Options

- `OBSIDIAN_VERSIONS="1.13.7/latest"` tests a specific `app/installer` version (space separate several).
  The default `latest/latest` resolved to Obsidian 1.13.7 on 2026-09-29.
- `WDIO_MAX_INSTANCES=1` runs desktop and mobile one after the other instead of in parallel.

## Disabling and enabling the plugin in a spec

`obsidianPage.resetVault()` also removes the plugin's files from the vault, so a spec cannot disable and enable the
plugin again after it has called it. A spec that reloads the plugin has to do that first, and it should be its own
spec file, because each spec file gets a fresh Obsidian (see `specs/card-syntax-latex.e2e.ts`).

## Writing more specs

Add `tests/e2e/specs/<name>.e2e.ts`. `smoke.e2e.ts` shows the pattern: wait for the plugin to
finish initialising, `resetVault()`, drive the UI with `browser.$(...)`, then assert on the note
file read from disk (`obsidianPage.getVaultPath()`). Type-check with
`pnpm tsc -p tests/e2e/tsconfig.json`. The root `tsconfig.json` excludes `tests/e2e` because it
loads Jest's globals, which clash with the WebdriverIO and Mocha ones.
