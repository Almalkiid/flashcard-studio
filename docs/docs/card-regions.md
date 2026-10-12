# Cards with blank lines

Ordinary multi-line cards end at a blank line. Card regions let their questions and answers contain blank lines, tables, and several paragraphs.

Set a start and end marker in **Settings → Card formats → Card regions**. For example, set both markers to `+++`:

```markdown
+++
What is a control objective?

Give a practical definition.
?
A statement of the result a control should achieve.

It should be testable.
+++
```

With the same start and end marker, cards are read between pairs of marker lines. With different markers, the start opens a region and the end closes it. With no end marker, the region continues to the end of the note. While a start marker is set, multi-line and cloze cards outside a region are not found; inline and callout cards still are.

```markdown
+++
First ==cloze==
+++

+++
Second ==cloze==
+++
```

These are two separate cloze cards. A region with only ordinary prose is rejected. With no start marker, an end marker can preserve blank lines in an answer but does not allow blank lines in the question. A scheduling comment ends a scheduled card even when an end marker is configured.
