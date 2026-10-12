# Note review

Note review schedules whole notes, independently of flashcards. A note joins when it has a configured review tag, `#review` by default, and does not have a configured exclusion tag or sit in a skipped folder.

## Create and rate a note

```markdown
---
tags: [review]
---

# Quarterly controls review

Read this note, then choose a note-review rating from the file menu.
```

You may use `#review` in body text instead of frontmatter. Open **Notes Review Queue** in the sidebar, select a review-tag deck if prompted, open a due note, then choose a rating from the file menu. Turn on **Open the next note** to continue automatically.

## Stored frontmatter

After a note is rated, Flashcard Studio writes these SM-2 fields:

```yaml
---
tags: [review]
sr-due: 2026-10-13
sr-interval: 1
sr-ease: 250
sr-id: 2fd85af1-0a53-4ad5-8663-9c8a6afbee85
---
```

`sr-due`, `sr-interval`, and `sr-ease` form the note schedule. `sr-id` is created when a stable note identity is needed. Do not edit a date into an invalid format: an unreadable due date is treated as unscheduled.

## Queue order

Due notes are selected before new notes. Normally, earlier dates come first; notes with the same date are ordered by their link importance. New notes use that importance order too. **Random order** chooses randomly from the relevant group instead. The pane groups items by review tag, New, Today, and formatted future dates; **Days shown in the pane** limits how far ahead it lists.

Use separate review tags for separate queues. See [Settings](settings.md#note-review) for tags, date format, pane startup, and order controls.
