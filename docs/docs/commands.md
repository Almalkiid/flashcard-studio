# Commands

Commands are available from Obsidian’s command palette. Commands which operate on a card require an active, focused Flashcard Studio review; commands which operate on a note require an active Markdown note.

| Command                                                        | What it does                                                         | Available when              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| Review flashcards from all notes                               | Opens the deck picker and normal review.                             | Plugin initialised          |
| Cram flashcards                                                | Opens a deck picker for unscheduled cram study.                      | Plugin initialised          |
| Review flashcards in this note                                 | Reviews cards in the active note.                                    | Tagged active Markdown note |
| Cram flashcards in this note                                   | Cram-studies cards in the active note.                               | Tagged active Markdown note |
| Review a note                                                  | Opens the next note-review note, selecting a review tag when needed. | Note-review decks exist     |
| Open Notes Review Queue in sidebar                             | Opens the note queue pane.                                           | Plugin initialised          |
| Undo last answer                                               | Reverses the last flashcard answer when possible.                    | A reversible answer exists  |
| Suspend card / Bury until tomorrow                             | Removes the current card permanently/until the next study day.       | Focused card review         |
| Unsuspend cards in current note / Unbury cards in current note | Clears those markers in the active note.                             | Active Markdown note        |
| View Card Info                                                 | Shows state, history, and source for the current card.               | Focused card review         |
| Open statistics                                                | Opens Flashcard Studio statistics.                                   | Plugin initialised          |
| Custom study                                                   | Opens extra-study choices.                                           | Plugin initialised          |
| Postpone due reviews                                           | Moves due review cards by a chosen number of days.                   | Plugin initialised          |
| Export review log for the FSRS optimizer (CSV)                 | Writes review history as CSV.                                        | Plugin initialised          |
| Import Anki deck                                               | Opens the `.apkg`, `.colpkg`, or text import dialog.                 | Always                      |
| Export cards to Anki                                           | Opens export after synchronising the deck hierarchy.                 | Plugin initialised          |
| Take an exam                                                   | Opens exam setup.                                                    | Plugin initialised          |
| Generate cards with AI                                         | Generates from the active note or selected editor text.              | Active Markdown editor      |
| Show the welcome guide                                         | Reopens onboarding.                                                  | Always                      |
| Create a sample deck                                           | Creates the example deck.                                            | Plugin initialised          |

When **Custom hotkeys** is on, Obsidian also offers **Review card as Again**, **Hard**, **Good**, and **Easy**, plus **Show Answer**, **Skip**, **Reset card’s progress**, and **Open card in background**. They work only while the review has focus and no text field is active.
