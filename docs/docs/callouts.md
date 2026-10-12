# Callout cards

A callout of a configured type is a card. Its title is the front and its body is the back. The default types are `flashcard`, `question`, and `card`.

```markdown
> [!question]- What is the capital of France?
> Paris
```

The `-` and `+` fold markers do not affect the card. The body can contain paragraphs, lists, tables, images, code, and nested callouts.

```markdown
> [!card] List the OSI layers
>
> 1. Physical
> 2. Data link
> 3. Network
```

A callout needs a title and non-empty body, must start at the beginning of a line, and cannot contain another card syntax. Its schedule is written on the line after the callout. Change the recognised types in **Settings → Card formats → Callout card types**; leave it empty to disable callout cards.

```markdown
> [!flashcard] Name a planet
> Mars

> [!question] Literal syntax
> Use `left::right` in code.

> [!question] This is not a callout card
> front::back
```

The first two are callout cards. The last contains inline-card syntax, so it follows the inline parser instead. A comment such as `<!--SR:!fsrs,...-->` is written after, never inside, a callout card.
