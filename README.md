# Flashcard Studio

**Flashcards that live in your notes, with the scheduling and control you know from Anki, and a study screen made for focus.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero-dark.png">
  <img alt="Flashcard Studio on a phone: the home screen with the daily goal and a focus deck, a question, a session in progress with its answer-coloured progress bar, and the statistics" src="docs/media/hero-light.png">
</picture>

Flashcard Studio turns the Markdown you already write into spaced repetition flashcards, and schedules them with [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm), the modern algorithm Anki uses. It keeps a full review history, so you can undo an answer and see how your memory is doing. Every card and every review stays in plain files in your vault, and it works the same on desktop and on your phone.

> Flashcard Studio is a fork of [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) by Stephen Mwangi, maintained by Kyle Klus. It keeps that plugin's card syntax and schedule format, so your existing cards work unchanged, and you can switch back at any time. See [Credits](#credits).

## Highlights

- **A study screen made for focus.** One card at a time, with the deck and "4 / 17" at the top and a progress bar that fills with the colour of each answer you give. Tap to reveal, then answer with soft tiles that show when you will see the card again.
- **Know where you are weak.** The statistics rank your decks by how well you remembered them in the last 30 days, against your target, and the home screen puts the weakest one first with one tap to study it.
- **Fix mistakes while they are fresh.** At the end of a session, **Review mistakes** goes over exactly the cards you missed.
- **Anki's scheduling.** FSRS with learning steps, Anki's learn ahead limit, daily limits, custom study, and an optimizer that fits FSRS to your own reviews.
- **Full control.** Undo, suspend, bury, flags and leeches, and a card info screen with every review of a card.
- **Cards written for you.** Generate cards from a note with your own AI provider (Anthropic, OpenAI or a local model), look them over, and add only the ones you want.
- **Bring your Anki decks.** Import `.apkg` and text files with their media and decks, and export back to Anki.
- **Your data stays yours.** Cards and schedules are plain text in your notes, and the review history is plain files that sync between devices without conflicts.
- **Light and dark, desktop and phone.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/screenshots/statistics-desktop.png">
  <img alt="The statistics on the desktop: reviews today, retention, day streak and study time, and the reviews per day" src="docs/media/screenshots/statistics-desktop-light.png">
</picture>

## Compared with Spaced Repetition

|                                                      | Spaced Repetition | Flashcard Studio |
| ---------------------------------------------------- | ----------------- | ---------------- |
| Cards written in plain Markdown                      | ✓                 | ✓                |
| FSRS scheduling                                      | ✓                 | ✓                |
| Works on iPhone, iPad and Android                    | ✓                 | ✓                |
| Review history of every answer                       |                   | ✓                |
| Undo last answer                                     |                   | ✓                |
| Daily new card and review limits                     |                   | ✓                |
| Suspend, bury and flag cards; leech detection        |                   | ✓                |
| FSRS learning steps, learn ahead limit and optimizer |                   | ✓                |
| Custom study (forgotten, ahead, preview, by deck)    |                   | ✓                |
| Heatmap, true retention, study time and weak areas   |                   | ✓                |
| Review mistakes after a session                      |                   | ✓                |
| Import from and export to Anki                       |                   | ✓                |
| Sync without conflicts across devices                |                   | ✓                |

## Writing cards

Tag a note with `#flashcards`, or turn folders into decks in the settings. Then write cards in any of these styles:

```markdown
What is the capital of France::Paris

Question and answer both ways:::Reversed card

**What is the purpose of internal auditing?**
?

- Provide independent, objective assurance and consulting
- Add value and improve an organisation's operations

The CAE reports ==functionally== to the ==board==.

> [!question]- What is the capital of France?
> Paris
```

- `Question::Answer`: single-line card.
- `Question:::Answer`: single-line card, reviewed in both directions.
- `?` on its own line: multi-line card (`??` for both directions).
- `==highlight==`, `**bold**` or `{{curly braces}}`: cloze deletions.
- A callout of type `flashcard`, `question` or `card`: a card. The title is the front and the body is the back.
- With a start and an end marker set in the settings (for example `+++` on the line before and after a card), a card can
  have blank lines, tables and several paragraphs, also in its question.
- Two more options in the settings: a cloze card that is only the line with the cloze, and `\cloze{answer}{hint}` for
  clozes inside LaTeX math.

Images, audio, LaTeX, code and footnotes work inside cards, because Obsidian renders them.

## Reviewing

Run **Flashcard Studio: Review flashcards from all notes** from the command palette, or click the ribbon icon. Rate each card **Again**, **Hard**, **Good** or **Easy**. After an answer, a toast shows when you will see the card again, with an **Undo** button.

| Key                | Action                                                   |
| ------------------ | -------------------------------------------------------- |
| Space or Enter     | Show answer, then Good                                   |
| 1, 2, 3, 4         | Again, Hard, Good, Easy (Anki keys)                      |
| Ctrl/Cmd + Z, or U | Undo last answer                                         |
| -                  | Bury until tomorrow                                      |
| @                  | Suspend                                                  |
| Ctrl/Cmd + 1 to 7  | Flag (red, orange, green, blue, pink, turquoise, purple) |
| S                  | Skip                                                     |

The number keys follow **Answer keys** in the settings. **Anki** (1 Again, 2 Hard, 3 Good, 4 Easy) is the default for new installs. **Original** (1 Hard, 2 Good, 3 Easy, 0 Reset the card) is the layout of the original Spaced Repetition plugin, and existing installs keep it until you change the setting.

On a phone, the same actions are in the card menu.

## AI cards

Run **Flashcard Studio: Generate cards with AI** from the command palette, or choose it in the editor's context menu, on a note or on a selection. Choose how many cards (up to 50), which kinds (basic, reversed, cloze, multiple choice), any extra instructions, and whether the cards go into this note, under a **Flashcards** heading, or into a new note next to it. A preview lists the cards: untick the ones you do not want, edit any text, then choose **Add**. The plugin writes the cards in your notes' own syntax and reads each one back with its own parser before adding it. A card that would not read back as itself, for example one with `::` in its question, is shown unticked with the reason, until you edit it. A note without a flashcards tag gets one.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/screenshots/ai-preview-desktop.png">
  <img alt="The preview of generated cards: a basic, a reversed, a cloze and a multiple choice card, each with a checkbox and editable text" src="docs/media/screenshots/ai-preview-light-desktop.png">
</picture>

Set it up in **Settings, AI cards**: pick Anthropic, OpenAI or any OpenAI-compatible server such as Ollama, LM Studio or OpenRouter (enter its address, for example `http://localhost:11434/v1`), a model name and your API key. The key is kept in Obsidian's secret storage, not in the plugin's settings file. A local server needs no key. This needs Obsidian 1.11.4 or later.

Many local servers cut a long note short without saying so (Ollama's default context is 4096 tokens), so raise the context length there when you generate from long notes.

## Where your data lives

- **The schedule of each card** is an HTML comment after the card: `<!--SR:!fsrs,...,id=k3f9a2-->`. It is the same format the original plugin uses, plus a short card id and optional markers (`susp`, `bury=`, `flag=`, `leech`) that the original plugin ignores.
- **Your review history** is in `Flashcard Studio/Review log/`, with one Markdown file per device per month (for example `2026-09 iphone-81c2.md`). Each answer is one line of JSON. Because every device writes only its own files, syncing with Obsidian Sync, iCloud or any other service never creates conflicts.
- **Settings** are in the plugin's `data.json`.

These plain files make it easy for scripts or AI assistants to read your progress and add cards.

## Installing

Until Flashcard Studio is in the community plugin directory, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from the community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `Almalkiid/flashcard-studio`.
3. Enable **Flashcard Studio** in the community plugins.

**Coming from Spaced Repetition?** Disable it and enable Flashcard Studio. Your cards and schedules work as they are. To keep your settings, use **Settings, Data, Import settings from Spaced Repetition**.

## Network use

Flashcard Studio works offline. It makes a network request only in two cases:

- You turn on **Show update available status bar item** in the settings, which checks this repository's latest release on GitHub.
- You run **Generate cards with AI**, which sends the note or selection you chose, and your extra instructions, to the provider you set up in the settings. Nothing is sent until you choose **Generate**.

## Credits

Flashcard Studio is built on [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) by **Stephen Mwangi** (original author) and **Kyle Klus** (maintainer), and on the work of its many contributors and translators. Their plugin's history is kept in this repository.

It includes fixes that community members contributed to the original plugin but that were not merged yet:

- #1629 by mayuriphad
- #1631 by Rainbow-prince
- #1601 by Gwyndolin
- #1610 by Kian Kyars
- #1587 by Lorite
- #1623 by Sheldon Corkery
- #1635 by paulclrt

The card syntax owes the following to pull requests that were not merged into the original plugin:

- #1652 by xiang2x: card regions with a start marker.
- #1584 by ievlevpn: `\cloze{answer}{hint}` in LaTeX math.
- #797 by Stefanuk12: a cloze card that is only the line with the cloze.
- #1283: the idea of callout cards.

The prompt of **Generate cards with AI** is adapted from [obsidian-flashcards-llm](https://github.com/crybot/obsidian-flashcards-llm) by crybot (MIT).

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) by the Open Spaced Repetition project.

## License

MIT. See [LICENSE](LICENSE).
