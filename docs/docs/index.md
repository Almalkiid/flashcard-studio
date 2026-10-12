# Getting started

Flashcard Studio turns Markdown in your Obsidian vault into flashcards and schedules reviews. New installs use FSRS, Anki-style answer keys, and `#flashcards` as the card tag.

## Install

Once Flashcard Studio is listed in Obsidian’s community plugin directory, install it from **Settings → Community plugins**, search for **Flashcard Studio**, then enable it.

Until then, use BRAT:

Until Flashcard Studio is listed in Obsidian's community plugin directory, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable BRAT from Community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `Almalkiid/flashcard-studio`.
3. Enable **Flashcard Studio**.

## Your first deck in five minutes

Create a note with this content:

```markdown
#flashcards

What does FSRS stand for::Free Spaced Repetition Scheduler
```

Open **Flashcard Studio: Review flashcards from all notes** from the command palette, or use the ribbon icon. Reveal the answer, choose a rating, and the plugin writes the schedule into your note.

Add two more cards, then select the `#flashcards` deck from the picker. Use `?` on a line alone for a longer answer, and see [Writing cards](writing-cards.md) for the complete syntax.

## Move from Spaced Repetition

Disable the Spaced Repetition plugin, then enable Flashcard Studio. Existing card syntax and schedules remain usable. To copy settings, open **Settings → Data → Import from Spaced Repetition**.

Next: learn the [card formats](writing-cards.md), then set up [decks](decks.md) and [scheduling](scheduling.md).
