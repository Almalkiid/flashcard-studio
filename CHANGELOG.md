# Changelog

All notable changes to Flashcard Studio are listed here. Versions follow [semantic versioning](https://semver.org).
Changes made before the fork are in the [Spaced Repetition changelog](docs/docs/changelog.md).

## [0.10.0] - 2026-09-30

Requires Obsidian 1.11.4 or later. That version added the secret storage that keeps the API key of your AI provider out of the plugin's settings file.

### Added

**A desktop interface**

- On a computer the Studio opens as a full tab with a sidebar, and a pane at least 900 px wide draws the desktop layout. The sidebar has **Home**, **Study** (with the number of cards due), **Exams**, **Browse cards**, **Statistics** and **Create with AI**, the deck tree with the cards due and the total of each deck (click a deck to study it), and **Settings**.
- A dashboard home: a greeting with the number of cards due and about how long they take, **Take an exam** and **Study all**, the daily goal, the streak, the cards learned and the retention, the deck that needs focus, your last exam with **Retake**, a table of decks with their retention against your target, the activity heatmap and the next seven days.
- A study screen that shrinks the sidebar to an icon rail. The card is up to 780 px wide, with the rating tiles and their keys under it, and a side panel with **This card** (state, last seen, stability, recall now, lapses, your last five answers), **This session** (your answers, the time, the cards left) and **Keys**. A session keeps its screen when you switch tabs or resize the window.
- **Desktop layout** in the settings (**UI preferences**, on by default) turns it on and off. On a computer, with the Studio look, it always opens the Studio as a tab with the desktop interface, whatever **Open in new tab** says, and it never changes the phone. Turn it off for the window (or the tab) with the layout of the phone. A pane narrower than 900 px, the Classic look and the phone keep the layout they had.

**Study**

- Multiple choice cards. A card whose answer is a task list with at least two items and at least one checked shows its options as tiles. Choosing one shows the answer with the right and wrong options marked and the explanation, and suggests a rating. Several right answers take a selection and a Check button. The number keys 1 to 9 choose. No new syntax, and the original plugin reads such a card as an ordinary one.
- Typed answers. With **Type the answer** on, or for one session from the card menu, a card with a short plain answer shows a field, compares your answer letter by letter and suggests Good or Again. Cloze blanks become fields too. Case, spacing and a final full stop do not count; accents can be ignored. Image occlusion cards ask for the label of the mask, when it is short plain text.
- The rating that an answer suggests is outlined on the answer tiles.
- Read aloud with the device's voices: a speaker button and the R key, optional reading of the question or the answer when it shows, a voice and a speed.
- Exams. **Take an exam** (a command, a button on the home screen, **Exams** in the desktop sidebar) sets up an exam from the decks you choose: how many questions, a time limit, multiple choice cards only or all cards (short answers typed, others marked by you), with presets for a Quick check (20 questions) and a CIA simulation (125 questions, 150 minutes). The exam has a question map, flags, a countdown that submits at zero, and the keys 1 to 9, the arrows, F and Enter (read by place, so they work on an Arabic or an AZERTY layout). Image occlusion cards are asked too, typed when their label is short plain text. The results show the score against a pass mark (75% by default, in **Settings, Exams**), the score of each deck and every question with the right answer and the explanation. **Study the ones I missed** reviews exactly those cards. Exams never change a schedule, and each one is saved as a plain file in `Flashcard Studio/Exams/`.
- An exam in progress is saved as you go, in a small file of its own in the plugin's folder, one for each exam and device, and only when something changed. Close the tab or quit Obsidian and **Resume exam** is offered when Obsidian starts and in **Exams**; a timed exam keeps its deadline. The file stays on the device that started the exam, so it never touches your settings and never travels with them.

**AI cards**

- **Generate cards with AI** (a command, the editor menu, and **Create with AI** in the desktop sidebar, which asks for a note first) writes flashcards from a note or a selection with your own provider: Anthropic, OpenAI, or any OpenAI-compatible server such as Ollama, LM Studio or OpenRouter. Choose how many cards, which kinds (basic, reversed, cloze, multiple choice), extra instructions and where they go, look them over, untick or edit the ones you do not want, and add the rest. The plugin writes the cards in your notes' own syntax and reads each one back with its own parser before adding it.
- The API key is kept in Obsidian's secret storage, never in the plugin's settings. Nothing is sent until you choose **Generate**, and it works on a phone.

**Cards**

- Image occlusion: hide parts of a picture and guess what is under them. **Add image occlusion** (command palette, and the editor menu on an image) opens an editor where you draw rectangles and ellipses with a mouse or a finger, move and resize them, and give each one an answer. The result is a fenced `image-occlusion` block in the note, one card per mask, with one schedule comment after it. Editing the block keeps each mask's schedule with its mask. Hide all or hide one, a picture as wide as the card that scrolls to the mask being asked about, zoom on the back (click, tap or the corner button), and the block in a note shows every answer on its mask with a button to edit it. **Edit card** in the study screen opens the editor with the masks locked. The original Spaced Repetition plugin sees a code block and no card.
- Anki export writes an image occlusion card as one basic note per mask, with the question and the whole picture on the front and the answer on the back. The masks are not drawn there.

### Changed

- Cloze blanks typed into fields (**Convert cloze patterns to input fields**) are checked the way typed answers are: case, extra spaces and punctuation at the end do not count, and the rating that fits is suggested. It is more forgiving than before, never stricter.

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
