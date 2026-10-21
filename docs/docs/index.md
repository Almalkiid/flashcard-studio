# Getting started

Flashcard Studio turns Markdown in your Obsidian vault into flashcards and schedules reviews. New installs use FSRS, Anki-style answer keys, and `#flashcards` as the card tag.

## Install

Requires **Obsidian 1.13.1 or later** on desktop or mobile.

1. Open **Settings → Community plugins → Browse**.
2. Search for **Flashcard Studio**, then choose **Install** and **Enable**.
3. Or open the [community directory listing](https://community.obsidian.md/plugins/flashcard-studio).

For beta releases only, use [BRAT](https://github.com/TfTHacker/obsidian42-brat) with `Almalkiid/flashcard-studio`.

Manual card creation and review are free and work offline. Optional AI generation sends your selected text to your configured provider and may incur provider fees. Directory listing does not imply manual review by Obsidian staff.

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

For a guided exercise with basic, cloze and multiple-choice cards, use [Your first study session](first-session.md).
