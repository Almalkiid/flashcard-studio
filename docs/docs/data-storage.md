# Data and storage

Flashcard Studio writes schedules into the vault. Back up before using migration or deletion tools.

## Flashcard comments

After a card is reviewed, its schedule is stored in an HTML comment immediately after it:

```markdown
Capital of France::Paris
<!--SR:!fsrs,...,id=k3f9a2-->
```

The comment is parsed as schedule metadata; its exact FSRS/SM-2 fields are internal and may change. It can also carry `susp`, `bury=`, `flag=`, and `leech` markers. **Schedule on the card’s last line** puts the comment after the card’s last text instead. **Hide schedules in a callout** places new schedule metadata in a folded callout. Callout-card schedules stay after the callout, and image-occlusion masks share one comment after their block.

## Note-review frontmatter

Whole-note review uses this frontmatter shape:

```yaml
sr-due: 2026-10-13
sr-interval: 1
sr-ease: 250
sr-id: 2fd85af1-0a53-4ad5-8663-9c8a6afbee85
```

The plugin also reads `tags` from Obsidian frontmatter. Use `#flashcards` or `#review` in frontmatter or note text; both are recognised.

## Review logs, exams, and `data.json`

- **Review log:** `Flashcard Studio/Review log/` by default. Each device writes one Markdown file per month; each answer is one JSON line, avoiding multiple devices writing the same log.
- **Completed exams:** `Flashcard Studio/Exams/`, one Markdown file per exam with a summary and JSON lines for questions.
- **Exam drafts:** plugin storage under `exam-drafts/`, separated by device, until submitted or discarded.
- **`data.json`:** plugin settings, including scheduler, display, card-format, reminders, source, and AI-provider choices. It stores the selected secret name, not the API key itself.

Use **Delete schedules** only when you want to discard scheduling state. Its optional tag removal affects flashcard and review tags as well.
