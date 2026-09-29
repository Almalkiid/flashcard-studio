# Cloze Cards

With [Single & Multiline Cards](../flashcards/q-and-a-cards.md) the text of both the front and back of each card is specified.

With `cloze` cards a single text is specified, together with an identification of which parts of the text should be obscured.

The front of the card is displayed as the text with (one or more) `cloze deletions` obscured.

## Cloze Deletions

A part of the card text is identified as a cloze deletion by surrounding it with the `cloze delimiter`.

### Single Cloze Deletion

By default, the cloze delimiter is `==`, and a simple cloze card would be:

```
The first female prime minister of Australia was ==Julia Gillard==
```

!!! note "Displayed when reviewed"

    <div class="grid" markdown>

    !!! tip "Initial View"

        The first female prime minister of Australia was [...]

    !!! tip "After `Show Answer` Clicked"

        The first female prime minister of Australia was Julia Gillard

    </div>

### Multiple Cloze Deletions

If the card text identifies multiple parts as cloze deletions, then multiple cards will be shown for review, each one occluding one deletion, while leaving the other deletions visible.

For instance, the following note:

```markdown
The first female ==prime minister== of Australia was ==Julia Gillard==
```

!!! note ""

    <div class="grid" markdown>

    !!! tip "Card 1 Initial View"

        The first female [...] of Australia was Julia Gillard

    !!! tip "Card 2 Initial View"

        The first female prime minister of Australia was [...]

    </div>

!!! tip "After `Show Answer` Clicked (same for both cards)"

    The first female prime minister of Australia was Julia Gillard

These two cards are considered sibling cards. See [sibling cards](flashcards-overview.md#sibling-cards) regarding the
[Bury sibling cards until the next day](../user-options.md#flashcard-review) scheduling option.

## Atomic Clozes (Only the Line with the Cloze)

By default a cloze card is the whole paragraph around the cloze, up to the next blank line:

```
The solar system
Mercury is the ==closest== planet to the sun
Venus is the ==hottest== planet
```

is one flashcard text, so both cards show all three lines. This is what you want when the lines belong together, and not
when a list of facts is written without blank lines between them.

Turn on `Cloze card is only the line with the cloze` in the [settings](../user-options.md#card-syntax) and each line
with a cloze is a flashcard of its own: `Mercury is the ==closest== planet to the sun` and `Venus is the ==hottest== planet`.
The line `The solar system` is not part of either.

- A [scheduling comment](../data-storage.md) is written on the line under the cloze line it belongs to.
- Several clozes in one line are several sibling cards, as always.
- A `$$ ... $$` block of display math is one piece: if the cloze is in it, the whole block is the card.
- A multiline card whose question contains a cloze stays a multiline card.
- A paragraph that has already been reviewed, and has one scheduling comment for the whole paragraph, stays one card
  for as long as that comment is there. Splitting it would leave its schedule without a card, and the schedule would be lost.
- It has no effect while a [start marker](cards-with-blank-lines.md#blank-lines-in-the-question-and-several-paragraphs-start-marker) is set.

The idea of atomic clozes is from upstream pull request #797, which was never merged.

## Clozes in Math (LaTeX)

The other cloze delimiters are unsuitable inside math: `==` and `**` change how the formula is rendered, and `{{...}}`
collides with the braces of LaTeX. Inside inline (`$...$`) or block (`$$...$$`) math, use the `\cloze{answer}{hint}`
macro instead, after turning on `Clozes in LaTeX math` in the [settings](../user-options.md#card-syntax).

The hint is the second argument. Leave it empty (`{}`) when you don't need one.

When you **read** a note, `\cloze{answer}{hint}` shows just the `answer`, so the formula looks normal. When you
**review**, the answer is hidden on the front (shown as `[hint]`, or `[…]` with no hint) and shown on the back.

For instance, the following note:

```
$$
\cloze{c^2}{} = \cloze{a^2 + b^2}{Pythagoras}
$$
```

Generates two sibling cards, with the following fronts:

!!! note ""

    <div class="grid" markdown>

    !!! tip "Card 1 Initial View"

        $$ [\ldots] = a^2 + b^2 $$

    !!! tip "Card 2 Initial View"

        $$ c^2 = [\text{Pythagoras}] $$

    </div>

!!! tip "After `Show Answer` Clicked (same for both cards)"

    $$ c^2 = a^2 + b^2 $$

The answer may contain braces, fractions, roots and other nested LaTeX, for example
`\cloze{\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}}{}`.

- `\cloze` works whatever [cloze patterns](#custom-cloze-patterns) are set.
- A card can also have `==highlight==` clozes. They make cards of their own, listed before the cards of the math clozes.
  In a card of a math cloze, a highlight shows its text without the marks.
- A `$$` in an answer is kept as it is (a bug in the cloze library used to turn it into `$`).
- A `\cloze` that is not inside math is a normal cloze: the answer is hidden and shown, without any math formatting.

!!! note

    The macro is taught to Obsidian's math renderer when the plugin starts with the setting on, and removed when the
    setting is turned off or the plugin unloads. A note that is already open may show `\cloze` unrendered until you
    switch to another note and back. If another plugin already defines `\cloze`, that definition is left alone.

The `\cloze` macro is from upstream pull request #1584.

## Cloze Types

### Simplified Clozes

Simplified Clozes are the Cloze Type we have been using so far. They keep working as before, but now you can add hints to them. That means each card will occlude one deletion, showing its hint if available, while leaving the other deletions visible.

For instance, the following note:

```
This ==note== doesn't need to have ==number==^[hint] on clozes
```

Will generate two cards, with the following fronts:

1. `This [...] doesn't need to have number on clozes`
2. `This note doesn't need to have [hint] on clozes`

And both will have the same back:

```
This note doesn't need to have number on clozes
```

### Classic Clozes

Classic Clozes are the same as Simplified Clozes, but they also have a sequence number used to sort and group deletions.

For instance, the following note:

```
This is a ==cloze==^[a hint][^1]. This is ==too, but without hint==[^2]. And this one is asked ==together with the first cloze==[^1].
```

Will generate two cards, with the following fronts:

1. `This is a [a hint]. This is too, but without hint. And this one is asked [...].`
2. `This is a cloze. This [...]. And this one is asked together with the first cloze.`

And both will have the same back:

```
This is a cloze. This is too, but without hint. And this one is asked together with the first cloze.
```

### Generalized Cloze Overlapping

The Cloze Overlapping Generalization allows you to dictate the behavior of each deletion individually. Each deletion has its own set of actions that indicate how it will behave on each card:

- `a` for ask (hide the deletion answer in the front of the card while showing it in the back).
- `h` for hide (hide the deletion answer both in the front and back of the card).
- `s` for show (show the deletion answer both in the front and back of the card).

For instance, the following note:

```
==Some context for items 2 and 4, but that could spoil items 1 and 3. Note that this doesn't even need to be asked==[^hshs]
.
- ==Item 1==[^ashh]
- ==Item 2==[^hash]
- ==Item 3==[^hhas]
- ==Item 4==[^hhha]
```

In this example, 4 cards will be generated, where items 1 to 4 will be asked sequentially. When asking Item 1, all other text will be hidden. When asking Item 2, just the Item 1 and the context will be displayed. When asking Item 3, only the Item 2 will be displayed. Finally, when asking Item 4, both the Item 3 and the context text will be displayed.

## Custom Cloze Patterns

You can now create your own Cloze Patterns. For instance, to emulate Anki-like clozes (e.g., `{{1::text::hint}}`), simply add the following pattern to your settings:

```
{{[123::]answer[::hint]}}
```

Brackets `[]` delineate where the sequence number and hint will be placed, along with any additional characters of your choice (e.g., the `::` in the example above). Clozecraft automatically generates a regex pattern based on your custom pattern. Sequence numbers are identified by finding numbers between brackets, hints by finding the word `hint` in brackets, and the deleted text by finding the word `answer`.

Here are some examples of custom patterns:

| Explanation                                               | Pattern in the Settings               | Simplified Cloze Usage                                                                                  | Numbered Cloze Usage                                                                                            | Generalized Cloze Overlapping Usage                                                                             |
| --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Anki-Like Pattern                                         | `{{[123::]answer[::hint]}}`           | `Brazilians speak {{Portuguese}}`<br><br>Or, with hint:<br>`Brazilians speak {{Portuguese::language}}`  | `Brazilians speak {{1::Portuguese}}`<br><br>Or, with hint:<br>`Brazilians speak {{1::Portuguese::language}}`    | `Brazilians speak {{a::Portuguese}}`<br><br>Or, with hint:<br>`Brazilians speak {{a::Portuguese::language}}`    |
| Highlighted pattern with hint and sequencer in footnotes. | `==answer==[^\\[hint\\]][\\[^123\\]]` | `Brazilians speak ==Portuguese==`<br><br>Or, with hint:<br>`Brazilians speak ==Portuguese==^[language]` | `Brazilians speak ==Portuguese==[^1]`<br><br>Or, with hint:<br>`Brazilians speak ==Portuguese==^[language][^1]` | `Brazilians speak ==Portuguese==[^a]`<br><br>Or, with hint:<br>`Brazilians speak ==Portuguese==^[language][^a]` |

!!! warning

    Make sure that your custom cloze patterns do not conflict with other flashcard separators.<br/>
    For instance, the Anki-Like pattern `{{[123::]answer[::hint]}}` conflicts with the default single line flashcard separator `::`.

!!! warning

    You can use brackets as part of your pattern, but you need to [escape](https://en.wikipedia.org/wiki/Escape_character) them with `\\`.<br/>
    For instance, in the pattern `==answer==[^\\[hint\\]][\\[^123\\]]`, the brackets _inside_ the outer brackets are escaped (`^\\[hint\\]` & `\\[^123\\]`).

In your settings, you can add multiple patterns at once, separating them with a new line:

```
{{[123::]answer[::hint]}}
==answer==[^\\[hint\\]][\\[^123\\]]
```

Then, you can use them in your notes:

```
This note has both ==highlighted clozes==[^1] and {{2::anki like clozes}}

And this note has both ==highlighted clozes==^[footnote hint][^1] and {{2::anki like clozes::anki like hint}}
```

!!! warning

    Remember, deletions must be of the same Cloze Type. You can't mix, for instance, a Classic Cloze with a Simplified Cloze in the same note, as they employ different ways to sort and identify the cards.
