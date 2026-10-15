# Your first study session

This short exercise uses manually written cards. No AI account or API key is needed.

1. Install and enable Flashcard Studio in Obsidian 1.13.1 or later.
2. Create a new note named `Starter cards` and paste the example below.
3. Run **Flashcard Studio: Review flashcards from all notes** in the command palette.
4. Reveal an answer, then select Again, Hard, Good or Easy based on your recall. Do not press Space twice accidentally: after revealing, Space selects Good.
5. Open Statistics to inspect your own review activity. A new vault will not have the history shown in promotional screenshots.

```text
#flashcards

What does FSRS stand for::Free Spaced Repetition Scheduler

A triangle has ==three== sides.

Which file format are these notes written in?
?
- [x] Markdown
- [ ] JPEG
- [ ] MP3
      Explanation: this note is a Markdown text file.
```

Keep each question focused on one answer. A blank line ends an ordinary multi-line card; do not insert one immediately after `?`. Cloze patterns can be changed in settings.

## If no cards appear

- Check the note contains `#flashcards`, and that you have not changed the configured flashcard tag.
- Use `::` for a one-line card and `?` alone for a multi-line card.
- Make sure Flashcard Studio is enabled and another scheduling plugin is not also reviewing the note.
- Check [decks](decks.md) and [FAQ](faq.md), then report the smallest failing example without personal notes.

## Trying an existing collection

Back up first. Import a small Anki deck before a large collection. Card content and compatible media can transfer, but review schedules/history do not. Image occlusion exports as basic cards, not interactive Anki masks. See [import/export](import-export.md).

Let vault sync complete before changing devices. Separate review logs reduce competing writes, but schedules in shared notes still require care.
