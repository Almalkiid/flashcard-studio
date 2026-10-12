# FAQ and troubleshooting

## Why are no cards in my deck?

Add `#flashcards`, check **Sources**, and make sure the note is not skipped by tag or folder.

## Why did cards disappear after I changed `::`?

The parser reads the current separators only. Restore the old separator or update the notes.

## Why is my multi-line card missing?

It needs text on both sides of `?`. A blank line ends an ordinary card; use [card regions](card-regions.md) for blank lines.

## Why is a cloze larger than one line?

Clozes use the surrounding paragraph by default. Enable **One line per cloze card** if that is not wanted.

## Why is an inline card still found outside a card region?

Regions limit multi-line and cloze cards. Inline and callout cards remain valid outside them.

## Why is my callout not a card?

It needs a configured type, title, non-empty body, and no nested card syntax.

## Why is a checklist not multiple choice?

It must have at least two top-level task items and at least one checked item.

## Why cannot I type an answer?

Typing is limited to short plain answers. Lists, tables, math, code, images, and long answers are ineligible.

## Why does Undo say the note changed?

Undo protects you from overwriting edits made after the answer. Keep the edit and continue reviewing.

## Why is a card still hidden tomorrow?

“Tomorrow” uses **Next day starts at**, not necessarily midnight.

## Why are learning cards not limited by my daily limit?

Daily limits cap new and review cards; learning and relearning waits remain available.

## Why was my card suspended as a leech?

It reached the configured FSRS lapse threshold. Unsuspend it, then rewrite the prompt or answer.

## Why is my note absent from the review queue?

Check review tags, skipped tags/folders, and whether its `sr-due` is farther ahead than Days shown.

## Why is a note’s due date ignored?

An invalid `sr-due` value is treated as no schedule. Use a valid date format.

## Why does read aloud not appear?

The device must expose speech synthesis voices. The control is hidden when it does not.

## Why did the AI stop midway through a long note?

Your provider may have a context limit. Increase it on a local server or generate from a smaller selection.

## Why did Anki import not preserve my schedule?

Import brings card content, decks, tags, and compatible media; it deliberately does not import review schedules.

## Why is an image-occlusion card broken after moving its image?

Obsidian does not update links inside the occlusion code block. Edit its `image:` line to the new path.

## Why is an old scheduled image-occlusion block unsafe to edit manually?

Mask schedules follow mask positions. Use the editor so it can move the schedule with the mask.
