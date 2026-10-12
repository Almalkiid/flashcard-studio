# Basic, reversed, and multi-line cards

Put `#flashcards` anywhere in a note, unless you use folders as decks. The default separators are shown below. Obsidian renders Markdown inside a card, so links, images, code, math, and footnotes can be used.

## One-line card

```markdown
What is the capital of France::Paris
```

`::` separates the front and back. It must not appear as ordinary text in the same card.

## Reversed one-line card

```markdown
France:::Paris
```

`:::` creates two cards: France → Paris and Paris → France.

## Multi-line card

Put `?` on a line by itself.

```markdown
What are the purposes of internal auditing?
?

- Provide independent, objective assurance and consulting.
- Add value and improve an organisation's operations.
```

Use `??` instead of `?` to create the reverse card as well. A blank line ends an ordinary multi-line card. Use [card regions](card-regions.md) when either side needs blank lines.

## Change separators

In **Settings → Card formats**, you can change all four separators. Each separator must be different. Changing one does not rewrite existing notes; cards written with the old separator stop being found until you change them back.

## Parser edge cases

```markdown
Question::Answer::with a second separator
```

This is still an inline card; the parser uses the configured separator in the line. Put literal syntax in inline code when it is prose:

```markdown
What does `std::vector` store?::A resizable sequence
```

An empty multi-line answer is rejected:

```markdown
Question
?
```

The parser does not make a card from it. Scheduling comments belong immediately after the card, for example `<!--SR:!fsrs,...,id=abc123-->`; do not create them by hand.
