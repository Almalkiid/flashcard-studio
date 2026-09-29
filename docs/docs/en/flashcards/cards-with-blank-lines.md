# Including Blank Lines in Flashcards

By default, [Multi-line Basic](q-and-a-cards.md#multi-line-basic), [Multi-line Bidirectional](q-and-a-cards.md#multi-line-bidirectional)
and [Cloze](cloze-cards.md) type flashcards recognize a blank line as the end of the flashcard text.
This means that blank lines can not be included within the text.

If blank lines need to be included (e.g. on a card containing a markdown table), there are two settings, both on the
flashcards page of the plugin [settings](../user-options.md#flashcard-separators):

| Setting                                                            | What it does                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `Characters denoting the end of clozes and multiline flashcards`   | A card runs until this line. Blank lines are then allowed in the **answer** of a multiline card.  |
| `Characters denoting the start of clozes and multiline flashcards` | Optional. Also allows blank lines, tables and several paragraphs in the **question** (see below). |

For example, either of them could be set to `+++`.

!!! warning "Global Edit Required"

    Note that after changing these you have to manually edit any flashcards you already have: add the end marker
    (and, if you use it, the start marker) to every multiline and cloze card.

    Cards that already have a [scheduling comment](../data-storage.md) end at that comment, even when an end
    marker is set. So turning the end marker on does not merge two reviewed cards into one, and does not delete
    the schedule of one of them.

## Including a Table in the Flashcard Answer

!!! note "Obsidian requires a blank line before a table for it to be displayed correctly."

    Without it, Obsidian displays it just as text and not correctly formatted.

    ![table-with-no-preceding-blank-line](https://github.com/user-attachments/assets/daed1309-3b38-4d14-bb42-b302efda96df)

    And with a blank line after the `?` and before the table, it is displays correctly.
    ![table-with-preceding-blank-line](https://github.com/user-attachments/assets/beef90b7-324e-4876-b10b-055a4d23d41f)

However, by default a blank line signifies the end of the multiline card.

To include the blank line, the
`Characters denoting the end of clozes and multiline flashcards` [setting](../user-options.md#flashcard-separators)
needs to be changed. Then that character sequence added as a line after the end of the flashcard text. For example:

![table-with-preceding-blank-line+++](https://github.com/user-attachments/assets/954fd7fc-6d5f-4315-b40e-2192664c3962)

Now the card is displayed correctly during a review.

![table-with-preceding-blank-line-review](https://github.com/user-attachments/assets/3bff8d25-f91f-4bc0-b922-7471d6b60869)

## Including Blank Lines in a Cloze Flashcard

With `Convert ==highlights== to clozes` enabled in [settings](../user-options.md#flashcard-separators)
and the `Characters denoting the end of clozes and multiline flashcards` set to `+++`,
we can have blank lines in a cloze flashcard. E.g.

![cloze-with-blank-lines](https://github.com/user-attachments/assets/f9d6f123-3378-41cb-9c93-2b061856c81d)

As there are 3 clozes defined, three separate cards will be generated for review.
One card, for example is:

![cloze-with-blank-lines-front1](https://github.com/user-attachments/assets/6b939d46-b93a-4a67-96d4-6985ccafb76e)

And after `Show Answer` is clicked, the following is displayed:

![cloze-with-blank-lines-answer](https://github.com/user-attachments/assets/225abd90-20a4-4e29-abb3-36beb61388d7)

## Blank Lines in the Question, and Several Paragraphs (Start Marker)

With only an end marker, a blank line **before** the `?` line still starts the card over, so blank lines are only
supported in the answer side of a multiline flashcard, and a cloze card cannot start with a paragraph
before its cloze.

Set the `Characters denoting the start of clozes and multiline flashcards` setting as well, and wrap the card in
the two markers. Everything between them is one card, with its blank lines, tables and lists. The start and end
marker may be the same characters, for example `+++`.

```md
+++
help sb (to) do sth

| verb | pattern     | example            |
| ---- | ----------- | ------------------ |
| help | to optional | help me (to) write |

> Can you ==help me (to) write== a newspaper ad?
+++
```

Or a multiline question and answer with a table on the question side:

```md
+++
Patterns:

| verb | pattern         |
| ---- | --------------- |
| help | help sb (to) do |

Prompt: Can you ______ a newspaper ad?
?
Can you help me (to) write a newspaper ad?

It is a request.
+++
```

The card's [scheduling comment](../data-storage.md) is written at the end of the card, just before the end marker,
so it stays inside the card.

While a start marker is set:

- Multiline and cloze cards are only found between a start marker and an end marker. Wrap the ones you already have.
  Their text and their schedules are not touched if you don't; they are just not reviewed until you wrap them.
- [Single-line cards](q-and-a-cards.md#single-line-basic) (`::`, `:::`) and [callout cards](callout-cards.md) need no markers.
- A region that is never closed runs to the end of the note.
- With different start and end markers, a start marker inside a region ends it and starts the next one.
- [Cloze cards that are only the cloze line](cloze-cards.md#atomic-clozes-only-the-line-with-the-cloze) have no effect: the region is the card.

!!! note "One card per region"

    Put every card in a region of its own. If two cards that were reviewed before are wrapped in one region they become
    one card, and only the first schedule belongs to it. The second schedule is kept in the note, but not used.
