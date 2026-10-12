# Settings reference

Defaults are for a new install. “Shown when” names a condition that hides or disables the control.

## Sources

| Option               | What it does                                                | Default              | Shown when |
| -------------------- | ----------------------------------------------------------- | -------------------- | ---------- |
| Flashcard tags       | Notes with any listed tag supply cards.                     | `#flashcards`        | Always     |
| Use folders as decks | Uses the folder tree instead of tags for decks.             | Off                  | Always     |
| Tags to skip         | Excludes matching notes from flashcard scanning.            | Empty                | Always     |
| Skipped folders      | Excludes folders or glob patterns from card and note scans. | `**/*.excalidraw.md` | Always     |

## Studying

| Option                    | What it does                                                                       | Default             | Shown when         |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------- | ------------------ |
| Daily limits              | Caps new cards and reviews; learning steps are never capped.                       | On                  | Always             |
| New cards per day         | Shared new-card limit across decks.                                                | 20                  | Daily limits on    |
| Reviews per day           | Shared review limit across decks.                                                  | 200                 | Daily limits on    |
| Card order                | Chooses due/new priority and shuffled/sequential order, or any card from any deck. | Due first, shuffled | Always             |
| Deck order                | Chooses sequential or shuffled one-deck-at-a-time study.                           | Sequential          | Not any-deck order |
| Bury related cards        | Hides other cards from the same text until tomorrow after an answer.               | Off                 | Always             |
| Learn ahead (minutes)     | Includes a learning card due within this window when nothing else is due.          | 20                  | FSRS               |
| Answer keys               | Selects Anki `1/2/3/4` or Original `1/2/3/0` rating keys.                          | Anki                | Always             |
| Button delay              | Ignores repeated rating presses for this period.                                   | Off                 | Always             |
| Type your answers         | Shows inputs for eligible short answers and cloze blanks.                          | Off                 | Always             |
| Ignore accents            | Treats accented and unaccented typed answers as equal.                             | Off                 | Always             |
| Shuffle choices           | Randomises multiple-choice options each time.                                      | On                  | Always             |
| Blanks as input fields    | Makes cloze blanks editable without typed-answer checking.                         | Off                 | Typed answers off  |
| Show intervals on buttons | Shows each rating’s next interval.                                                 | On                  | Always             |
| Exam pass mark            | Practice-exam target percentage.                                                   | 75%                 | Always             |

### Answer button labels

| Option                     | What it does                                          | Default        | Shown when |
| -------------------------- | ----------------------------------------------------- | -------------- | ---------- |
| Again / Hard / Good / Easy | Changes wording used by buttons, menus, and commands. | English labels | Always     |

### Read aloud

| Option            | What it does                                             | Default   | Shown when              |
| ----------------- | -------------------------------------------------------- | --------- | ----------------------- |
| Read the question | Speaks the question when shown.                          | Off       | Device speech available |
| Read the answer   | Speaks the answer; pictures, code, and math are skipped. | Off       | Device speech available |
| Voice             | Uses Automatic or one installed device voice.            | Automatic | Device speech available |
| Speed             | Sets speech rate from 0.5× to 2.0×.                      | 1.0×      | Device speech available |

### Leeches

| Option                      | What it does                                                   | Default          | Shown when |
| --------------------------- | -------------------------------------------------------------- | ---------------- | ---------- |
| Lapses to become a leech    | Marks an FSRS card after this many lapses; 0 disables leeches. | 8                | Always     |
| When a card becomes a leech | Either marks it only or marks and suspends it.                 | Mark and suspend | Always     |

## Scheduling

| Option                  | What it does                                                  | Default    | Shown when |
| ----------------------- | ------------------------------------------------------------- | ---------- | ---------- |
| Algorithm               | Selects FSRS or SM-2; a card is rewritten on its next answer. | FSRS       | Always     |
| Desired retention       | FSRS recall target; higher means more reviews.                | 90%        | FSRS       |
| Expected workload       | Estimates daily FSRS work from loaded cards.                  | —          | FSRS       |
| Optimize parameters     | Fits FSRS parameters to review history.                       | Not set    | FSRS       |
| Next day starts at      | Defines the daily boundary in 24-hour time.                   | `00:00:00` | Always     |
| Maximum interval (days) | Prevents a card waiting longer than this.                     | 36,525     | Always     |

### Advanced FSRS

| Option               | What it does                                               | Default             | Shown when |
| -------------------- | ---------------------------------------------------------- | ------------------- | ---------- |
| Learning steps       | Waits before a new card graduates; empty lets FSRS decide. | `1m 10m`            | FSRS       |
| Relearning steps     | Waits after a forgotten card.                              | `10m`               | FSRS       |
| Spread out due dates | Varies longer due dates slightly.                          | On for new installs | FSRS       |
| Custom parameters    | Accepts 17, 19, or 21 numbers; empty uses FSRS defaults.   | Empty               | FSRS       |

### SM-2

| Option              | What it does                                     | Default | Shown when |
| ------------------- | ------------------------------------------------ | ------- | ---------- |
| Starting ease       | Ease assigned to a new SM-2 note.                | 250%    | SM-2       |
| Linked notes’ share | How much linked-note ease influences a new note. | 100%    | SM-2       |
| Hard interval       | Multiplier used by a Hard answer.                | 50%     | SM-2       |
| Easy bonus          | How much longer Easy is than Good.               | 130%    | SM-2       |

## Card formats

| Option                                              | What it does                                              | Default                     | Shown when      |
| --------------------------------------------------- | --------------------------------------------------------- | --------------------------- | --------------- |
| One-line separator / Two-way one-line separator     | Splits one-way and reversed inline cards.                 | `::` / `:::`                | Always          |
| Multi-line separator / Two-way multi-line separator | Separates one-way and reversed multi-line cards.          | `?` / `??`                  | Always          |
| Callout card types                                  | Comma-separated types whose title and body become a card. | `flashcard, question, card` | Always          |
| One line per cloze card                             | Restricts a cloze card to its line.                       | Off                         | No start marker |
| Clozes in math                                      | Enables `\cloze` inside math.                             | Off                         | Always          |
| Card regions                                        | Opens the start/end-marker editor.                        | Both empty                  | Always          |
| Cloze patterns                                      | Lists editable deletion patterns.                         | `==answer==`                | Always          |

## Note review

| Option                     | What it does                                                      | Default           | Shown when |
| -------------------------- | ----------------------------------------------------------------- | ----------------- | ---------- |
| Review tags / Tags to skip | Selects notes for review and excludes matching notes.             | `#review` / empty | Always     |
| Date format                | Moment.js due-date format in the queue.                           | `MMM DD YYYY`     | Always     |
| Open the next note         | Opens the next due note after rating.                             | Off               | Always     |
| Random order               | Picks due/new notes randomly instead of date and link importance. | Off               | Always     |
| Review pane at startup     | Opens the queue when Obsidian starts.                             | On                | Always     |
| Days shown in the pane     | Hides notes due later than this from the pane.                    | 365               | Always     |

## Display

| Option                                                       | What it does                                         | Default   | Shown when                               |
| ------------------------------------------------------------ | ---------------------------------------------------- | --------- | ---------------------------------------- |
| Look                                                         | Selects Studio or Classic review presentation.       | Studio    | Always                                   |
| Desktop layout                                               | Opens Studio as a tab with sidebar and dashboard.    | On        | Desktop, Studio                          |
| Your name                                                    | Adds a name to the home greeting.                    | Empty     | Always                                   |
| Open in a tab                                                | Uses a tab instead of a pop-up review.               | Off       | When desktop layout does not force a tab |
| Window height / width                                        | Sizes a pop-up review.                               | 60% / 60% | Pop-up review                            |
| Show where a card comes from                                 | Shows note title and headings above cards.           | On        | Always                                   |
| Expand decks                                                 | Starts deck hierarchies with subdecks open.          | On        | Always                                   |
| Custom hotkeys                                               | Enables review commands for Obsidian’s Hotkeys page. | Off       | Tab review                               |
| Rate notes from the file menu                                | Adds note ratings to file menus.                     | On        | Always                                   |
| Delete schedules from the file menu / Delete button on cards | Adds destructive schedule controls.                  | Off / Off | Always                                   |

### Status bar

| Option                | What it does                       | Default | Shown when          |
| --------------------- | ---------------------------------- | ------- | ------------------- |
| Status bar items      | Master switch for counters.        | On      | Always              |
| Due cards / Due notes | Shows the matching due counter.    | On / On | Status bar items on |
| Update notice         | Checks GitHub for a newer release. | Off     | Status bar items on |

## Reminders

| Option                              | What it does                                   | Default   | Shown when            |
| ----------------------------------- | ---------------------------------------------- | --------- | --------------------- |
| Review reminders                    | Enables periodic due-card checks.              | Off       | Always                |
| Check every                         | Check interval.                                | 5 minutes | Reminders on          |
| Check at startup                    | Checks when Obsidian starts.                   | Off       | Reminders on          |
| Reminder text                       | Overrides the built-in message; blank uses it. | Empty     | Reminders on          |
| Open the review / Show a notice     | Chooses reminder response.                     | On / On   | Reminders on          |
| Play a sound / Bounce the dock icon | Desktop reminder effects.                      | On / On   | Desktop, reminders on |

## AI cards

| Option         | What it does                                             | Default             | Shown when        |
| -------------- | -------------------------------------------------------- | ------------------- | ----------------- |
| Provider       | Chooses Anthropic, OpenAI, or compatible server.         | Anthropic           | Always            |
| Model          | Exact model name sent to the provider.                   | `claude-sonnet-5-5` | Always            |
| Server address | Base URL before `/chat/completions`.                     | Empty               | Compatible server |
| API key        | Selects an Obsidian secret-storage key.                  | None                | Always            |
| Privacy        | Explains that text is sent only after generation is run. | —                   | Always            |

## Data

| Option                                                         | What it does                                                | Default                       | Shown when |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- | ---------- |
| Review log folder                                              | Folder for per-device, per-month answer logs.               | `Flashcard Studio/Review log` | Always     |
| Schedule on the card’s last line / Hide schedules in a callout | Chooses schedule-comment placement.                         | Off / Off                     | Always     |
| Move existing schedules into callouts                          | Rewrites existing scheduled notes after confirmation.       | —                             | Always     |
| Import from Spaced Repetition                                  | Replaces settings from that plugin after confirmation.      | —                             | Always     |
| Also remove tags                                               | Includes flashcard/review tags when deleting schedules.     | Off                           | Always     |
| Delete all / note / card schedules                             | Deletes the selected schedule scope after confirmation.     | —                             | Always     |
| Reset all settings                                             | Restores defaults without changing cards or review history. | —                             | Always     |
| Log scheduling details / parser details                        | Writes diagnostics to the developer console.                | Off / Off                     | Always     |
| Documentation / Report a problem / Discussions / Release notes | Opens the corresponding web page.                           | —                             | Always     |

See [Scheduling](scheduling.md), [Writing cards](writing-cards.md), and [Data and storage](data-storage.md) for the effects of these choices.
