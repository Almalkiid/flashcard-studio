# Changelog

All notable changes to Flashcard Studio are listed here. Versions follow [semantic versioning](https://semver.org).

## [0.12.0]

### Changed

- Flashcard Studio has its own command ids and view names. Custom hotkeys for Flashcard Studio commands need to be bound again once.
- Open Flashcard Studio tabs are reopened after a restart.
- The CSS classes of the plugin start with `fs-` now, not `sr-`. CSS snippets and themes that target the old `sr-*` classes must use the `fs-*` ones.

### Fixed

- Undo restores the note in one step, so an edit made at the same moment is not lost.
- Reading a note no longer rewrites it to delete schedule segments it has too many of; they stay in the note.
- Settings changed on disk by a sync service are applied without a restart.
- Removing a card from a question with several cards says that the whole question goes, and a note that changed in the meantime is reported instead of silently losing the card.
- Asking for the decks while a scan runs gives the state after the request, so a note written during the scan is not missed.
- Delete scheduling data only writes notes it changes, and leaves tags in code blocks and inside words alone.
- Moving schedules into callouts leaves code blocks, tables and lists intact and says how many it left.
- Postpone moves only the cards it counted.
- A warning when an OpenAI-compatible server is reached over plain http://.

## [0.11.2] - 2026-10-10

### Fixed

- The 0.11.1 fix gave a card the schedule of another card when both asked the same answer with the same hint: one inside math, which 0.11 no longer makes a card for, and one outside (`$==a==$ and ==a==`), or a `\cloze{a}` with the same answer as a highlight in another formula. The two are now told apart by where they are in the note, so each card gets its own schedule back. A note that 0.11.0 or 0.11.1 has already saved keeps the schedules it was saved with: restore it with File recovery, or from a backup, to get the old ones back.

## [0.11.1] - 2026-10-10

### Fixed

- A note reviewed before 0.11 with **Clozes in LaTeX math** on, with a cloze pattern inside math (`$==a==$ and ==b==`, or the `{{a}}` of `$\frac{{a}}{b}$`), keeps each schedule with its card. 0.11 no longer makes a card for the cloze inside math, and schedules are matched to cards by position, so the card after it took its schedule. Each card now gets its own schedule and card information back, and only the schedule of the card that is gone is dropped.
- On a phone, a review that is closed and opened again at once stays a review, so card info and the other review commands work. The window that closed slides away first, and when it finished it ended the new review.

## [0.11.0] - 2026-10-10

### Added

Clozes in LaTeX math (`\cloze`, with **Clozes in LaTeX math** on), as asked in [#2](https://github.com/Almalkiid/flashcard-studio/issues/2):

- Sequence numbers and overlapping, as for the other clozes: `\cloze[2]{answer}{hint}` asks the deletions with the same number on one card, and `\cloze[ash]{answer}{hint}` asks, hides or shows the deletion on each card. Sequence numbers are shared with the other cloze syntaxes, so `\cloze[1]{mc^2}{}` and `==1;;1905==` are asked on the same card.
- The hint is optional: `\cloze{answer}` works, in reviews and when reading a note (`$\cloze{a} + b$` shows `a + b`).

### Changed

- With **Clozes in LaTeX math** on, braces inside `$...$` and `$$...$$` belong to LaTeX: cloze patterns are not looked for there, so `\frac{{a}}{b}` or `{{n} \choose {k}}` stay formulas instead of becoming clozes. Inside math, `\cloze` is the only cloze. A `==highlight==` inside math is not a cloze any more either. With the setting off, nothing changes.
- A `\cloze` and the other clozes of a card are expanded together, with one set of rules. A card that has only unnumbered clozes keeps its cards in the same order (the other clozes first, then the math ones), so their schedules stay with them. An unnumbered `\cloze` in a card with sequence numbers is shown as its answer, as an unnumbered `==highlight==` is.

### Fixed

- The colour of a math cloze stays on it: in `$6=\cloze{1}{?} + \cloze{2}{?} + \cloze{3}{?}$` the `+ 3` is no longer coloured when the second deletion is asked.
- A math cloze shown as its answer no longer runs into the command before it: `\le\cloze{c_0}{}` shows `\le c_0`, not the undefined `\lec_0`.

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
- An exam in progress is saved as you go, in a small file of its own in the plugin's folder, one for each exam and device, and only when something changed. Close the tab or quit Obsidian and **Resume exam** is offered when Obsidian starts and in **Exams**; a timed exam keeps its deadline. The file is named after the device that started the exam, and only that device offers it, so it never touches your settings; a synced vault copies it to your other devices, which ignore it.

**AI cards**

- **Generate cards with AI** (a command, the editor menu, and **Create with AI** in the desktop sidebar, which asks for a note first) writes flashcards from a note or a selection with your own provider: Anthropic, OpenAI, or any OpenAI-compatible server such as Ollama, LM Studio or OpenRouter. Choose how many cards, which kinds (basic, reversed, cloze, multiple choice), extra instructions and where they go, look them over, untick or edit the ones you do not want, and add the rest. The plugin writes the cards in your notes' own syntax and reads each one back with its own parser before adding it.
- The API key is kept in Obsidian's secret storage, never in the plugin's settings. Nothing is sent until you choose **Generate**, and it works on a phone.

**Cards**

- Image occlusion: hide parts of a picture and guess what is under them. **Add image occlusion** (command palette, and the editor menu on an image) opens an editor where you draw rectangles and ellipses with a mouse or a finger, move and resize them, and give each one an answer. The result is a fenced `image-occlusion` block in the note, one card per mask, with one schedule comment after it. Editing the block keeps each mask's schedule with its mask. Hide all or hide one, a picture as wide as the card that scrolls to the mask being asked about, zoom on the back (click, tap or the corner button), and the block in a note shows every answer on its mask with a button to edit it. **Edit card** in the study screen opens the editor with the masks locked. The original Spaced Repetition plugin sees a code block and no card.
- Anki export writes an image occlusion card as one basic note per mask, with the question and the whole picture on the front and the answer on the back. The masks are not drawn there.

### Changed

- Cloze blanks typed into fields (**Convert cloze patterns to input fields**) are checked the way typed answers are: case, extra spaces and punctuation at the end do not count, and the rating that fits is suggested. It is more forgiving than before, never stricter.

## [0.9.0] - 2026-09-29

First preview of Flashcard Studio, reading and writing the same note format as Spaced Repetition 1.15.4.

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
- "Again" on a new card brings it back in the same session (#1568).
- Cards after HTML comments, and multi-line answers containing `::`, are no longer lost.
- Short-term FSRS steps come back during a session.
- FSRS settings apply without a reload, and sibling placeholders use the FSRS format.
- Faster parsing with `cachedRead`. A duplicate setting is removed. The review modal no longer shows two close buttons.
- Reviews no longer open with no decks after a note changed, and `$$` in a cloze answer is kept.
- Resetting settings no longer changes the defaults; frontmatter without tags no longer breaks card tag removal; resizing the review window no longer rewrites `data.json` on every frame.
