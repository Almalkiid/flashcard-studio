# Callout Cards

A [callout](https://help.obsidian.md/callouts) of a card type is a flashcard. The **callout title is the front** of the
card and the **callout body is the back**.

```text
> [!question]- What is the capital of France?
> Paris
```

!!! note "Displayed when reviewed"

    <div class="grid" markdown>

    !!! tip "Card Front"

        What is the capital of France?

    !!! tip "Card Back"

        Paris

    </div>

The `-` (folded) and `+` (unfolded) marks of a callout are allowed and make no difference to the card. Because a card
is a callout, it is easy to fold in your notes and it looks like a card in reading view.

The card types are `flashcard`, `question` and `card` (upper or lower case). They can be changed in the
`Callout card types` [setting](../user-options.md#card-syntax). Leave it empty to turn callout cards off.

## The Body

The body is everything in the callout after the title line, without its `> ` marks. It can have several lines and
paragraphs, lists, tables, code and images. A callout inside the body is part of the back.

```text
> [!card] List the layers of the OSI model
> 1. Physical
> 2. Data link
> 3. Network
>
> > [!tip] Remember
> > "Please Do Not Throw Sausage Pizza Away"
```

## Scheduling

The [scheduling comment](../data-storage.md) is written on the line **after** the callout, outside of it:

```text
> [!question]- What is the capital of France?
> Paris
<!--SR:!2026-10-04,4,270-->
```

This is also the case when the `Use callouts for scheduling comments` or `Save scheduling comment on the same line as
the flashcard's last line?` options are on: they apply to other cards, not to callout cards.

## Which Callouts Are Cards

A callout is a card when:

- its type is one of the card types,
- it has a title, and a body that is not empty,
- it starts at the start of a line (not indented, not in a list),
- **it does not hold another card syntax.**

The last point keeps notes that already work the way they did. A callout of a card type that has an inline separator
(`::`), a [cloze](cloze-cards.md) (`==text==`), or a `?` line directly below it is still an inline card, a cloze card, or
part of a multiline card, exactly as it was before callout cards existed. To put such text in a callout card, put it
in backticks (`` `std::vector` ``), or use a callout type that is not a card type.

A callout that comes after a [multiline card](q-and-a-cards.md#multi-line-basic) answer, without a blank line, is part of
that answer. Put a blank line between them to make it a card of its own.

Callout cards need no start and end marker, also when you use [cards with blank lines](cards-with-blank-lines.md#blank-lines-in-the-question-and-several-paragraphs-start-marker).

## Limitations

- The card has one front and one back. A cloze in a callout makes a [cloze card](cloze-cards.md), not a callout card.
- A deck tag can not be put on the callout itself. A tag on a line of its own before it sets the deck for the cards
  after it, as for other cards. See [Decks](decks.md).

The idea of callout cards is from upstream pull request #1283, which was never merged.
