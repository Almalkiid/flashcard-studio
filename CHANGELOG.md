# Changelog

All notable changes to Flashcard Studio are listed here. Versions follow [semantic versioning](https://semver.org).
Changes made before the fork are in the [Spaced Repetition changelog](docs/docs/changelog.md).

## [Unreleased]

### Added

**Cards**

- Image occlusion: hide parts of a picture and guess what is under them. **Add image occlusion** (command palette and editor menu) opens an editor where you draw rectangles and ellipses with a mouse or a finger, move and resize them, and give each one an answer. The result is a fenced `image-occlusion` block in the note, one card per mask, with one schedule comment after it. Editing the block keeps each mask's schedule with its mask. Hide all or hide one, a picture as wide as the card that scrolls to the mask being asked about, click or tap to zoom, and the block in a note shows every answer on its mask with a button to edit it. **Edit card** in the study screen opens the editor with the masks locked. The original Spaced Repetition plugin sees a code block and no card.
- Anki export writes an image occlusion card as one basic note per mask, with the question and the whole picture on the front and the answer on the back. The masks are not drawn there.

## [0.9.0] - 2026-09-29

First preview of Flashcard Studio, forked from Spaced Repetition 1.15.4.

### Added

**Study**

- The Studio look: a new design for the home screen, the study screen, the statistics, card info and the session summary, in light and dark, on desktop and phone. The original look stays available as Classic.
- A home screen with today's goal, the streak, cards learned and retention, the deck that needs focus, and the decks to continue.
- A study screen with the deck and "4 / 17" at the top, a progress bar coloured by each answer, a star, tap to reveal, and answer tiles that show the next interval.
- Review mistakes: at the end of a session, study again exactly the cards answered Again.
- Undo last answer (toast, menu, Ctrl/Cmd+Z or U), including after a deck is finished.
- Suspend, bury until tomorrow and seven flag colours, with Anki's shortcuts. Leech detection with a configurable threshold and action.
- Anki's answer keys (1 Again, 2 Hard, 3 Good, 4 Easy) for new installs.
- Custom study: forgotten cards, review ahead, preview new cards, and cards by deck, state, flag or leech mark.
- A welcome guide and a sample deck on first run.

**Scheduling**

- FSRS for new installs, with learning and relearning steps, fuzz, and Anki's learn ahead limit.
- An FSRS optimizer that fits the parameters to your own review history, checked against the reference implementation.
- Anki-style daily limits for new cards and reviews, shared across devices.
- Postponing cards.

**History and statistics**

- Review history: every answer is recorded in `Flashcard Studio/Review log/`, one file per device per month, so syncing never conflicts. Log files render as a table.
- Stable card ids, stored in the existing schedule comment and ignored by the original plugin.
- Statistics for any deck and time range: today, streak, a calendar heatmap, reviews per day, true retention, study time, card maturity, forecast, intervals, stability, difficulty, retrievability, answer buttons, the hours you study, and weak areas.
- Card info with the full review history of a card, and a summary at the end of each session.

**Cards and Anki**

- Callout cards, card regions between a start and an end marker (with blank lines, tables and several paragraphs), clozes that are only their line, and `\cloze{answer}{hint}` in LaTeX math.
- Import Anki packages (`.apkg`) and text files with their media and decks. Export all decks or one deck to an Anki package or a text file.
- Import settings from Spaced Repetition.
- Commands: undo, suspend, bury, and unsuspend or unbury the cards in a note.

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
- Reviews no longer open with no decks after a note changed, and `$$` in a cloze answer is kept.
- Resetting settings no longer changes the defaults; frontmatter without tags no longer breaks card tag removal; resizing the review window no longer rewrites `data.json` on every frame.
