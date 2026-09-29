# Changelog

All notable changes to Flashcard Studio are listed here. Versions follow [semantic versioning](https://semver.org).
Changes made before the fork are in the [Spaced Repetition changelog](docs/docs/changelog.md).

## [0.9.0] - Unreleased

First preview of Flashcard Studio, forked from Spaced Repetition 1.15.4.

### Added

- Review history: every answer is recorded in `Flashcard Studio/Review log/`, one file per device per month, so syncing never conflicts. Log files render as a table.
- Stable card ids, stored in the existing schedule comment and ignored by the original plugin.
- Undo last answer (toast, menu, Ctrl/Cmd+Z or U), including after a deck is finished.
- Suspend, bury until tomorrow and seven flag colours, with Anki's shortcuts.
- Leech detection with a configurable threshold and action.
- Anki-style daily limits for new cards and reviews, shared across devices.
- Import settings from Spaced Repetition.
- Commands: undo, suspend, bury, unsuspend or unbury the cards in a note.

### Fixed

- Obsidian languages without a translation no longer stop the plugin from loading (#1644).
- A day boundary such as 03:00 is applied (#1423).
- The note review queue command no longer opens an empty pane (#1212).
- Dates written into notes stay in Latin digits whatever the Obsidian language.
- "Again" on a new card brings it back in the same session (#1568, fix by mayuriphad in #1629).
- Cards after HTML comments, and multi-line answers containing `::`, are no longer lost (fix by Rainbow-prince in #1631).
- Short-term FSRS steps come back during a session (fix by Gwyndolin in #1601).
- FSRS settings apply without a reload, and sibling placeholders use the FSRS format (fix by Kian Kyars in #1610).
- Faster parsing with `cachedRead` (by Lorite in #1587). Duplicate setting removed (by Sheldon Corkery in #1623). The review modal no longer shows two close buttons (by paulclrt in #1635).
- Resetting settings no longer changes the defaults; frontmatter without tags no longer breaks card tag removal; resizing the review window no longer rewrites `data.json` on every frame.
