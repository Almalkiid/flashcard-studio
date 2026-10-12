# Reviewing cards

Start **Review flashcards from all notes**, choose a deck, then reveal each card and rate its recall. **Again** means you did not remember; **Hard**, **Good**, and **Easy** express increasing confidence. The buttons optionally show their next intervals.

## Keys and buttons

| Input                | Front             | Answer side             | Desktop/tablet notes                                   |
| -------------------- | ----------------- | ----------------------- | ------------------------------------------------------ |
| Space or Enter       | Reveal answer     | Good                    | Does not take over an active text field                |
| 1, 2, 3, 4           | —                 | Again, Hard, Good, Easy | Anki keys, the new-install default                     |
| 1, 2, 3, 0           | —                 | Hard, Good, Easy, Reset | Original keys, if selected                             |
| Cmd/Ctrl+Z or U      | —                 | Undo last answer        | Undo fails if the source note changed after the answer |
| -                    | —                 | Bury until tomorrow     | Current card                                           |
| @                    | —                 | Suspend                 | Current card                                           |
| Cmd/Ctrl+1 through 7 | —                 | Set flag colour         | Red, orange, green, blue, pink, turquoise, purple      |
| S                    | —                 | Skip                    | Leaves the card unscheduled                            |
| R                    | Read visible side | Read visible side       | Only where speech is available                         |

The card menu exposes the same management actions on phone. It also offers **Edit card**, card information, and a session-only typed-answer switch.

## Undo, bury, suspend, and flags

Undo restores the previous schedule and review-log state when the source note has not changed. Bury hides a card only until the next configured study day. Suspend removes it from normal review until you unsuspend it. Flags are colour markers for finding cards in custom study. A leech can be marked or automatically suspended; see [Scheduling](scheduling.md#leeches).

## Typed answers and read aloud

With **Type your answers** on, an eligible answer is one plain line of at most 120 characters, with no image, code, math, table, or list. Press Enter to check. Case, extra spaces, and one final full stop do not matter; accents do unless **Ignore accents** is enabled. Cloze cards use one field per blank. Multiple-choice and image-occlusion cards use their own controls.

The speaker button or `R` reads the side in view using device voices, offline. Code, images, and math are skipped; a cloze blank is spoken as “blank”. Automatic question/answer speech, voice, and speed are in Settings.

## Studio, Classic, desktop, and phone

Studio is the default. On desktop, **Desktop layout** opens a tab with a sidebar, dashboard, and card/session panels. Classic retains the simpler look. A narrow pane and phone use the mobile layout. A session is retained when you change tab or resize; on phone, actions live in the card menu.

## Session end

When the queue finishes, the summary shows cards, time, answers, retention, and streak. **Review mistakes** starts a follow-up session for cards missed in the completed session.
