# Cloze cards and math clozes

A cloze hides part of a paragraph. The default pattern is `==answer==`.

```markdown
The forgetting curve describes how ==memory== fades over time.
```

Each unnumbered deletion makes a card. Deletions can use sequence numbers and overlap according to the configured cloze pattern. Add, remove, or change patterns in **Settings → Card formats → Cloze patterns**.

## One line per cloze

By default, the entire paragraph around a deletion is the card. Turn on **One line per cloze card** to make each line containing a cloze its own card. This does not apply while card regions are active.

## Math clozes

Turn on **Clozes in math**. Inside `$…$` or `$$…$$`, use `\cloze{answer}{hint}`.

```markdown
$$
\cloze{c^2}{} = \cloze{a^2 + b^2}{Pythagoras}
$$
```

The hint is optional. Use `\cloze[1]{answer}{hint}` to put deletions with the same sequence number on one card. When math clozes are enabled, normal cloze patterns are ignored inside math, so LaTeX braces stay ordinary math.

## More accepted and rejected forms

```markdown
Mercury is the ==closest== planet to the Sun.

Two facts: ==one== and ==two==.

$$\cloze{c^2}{} = a^2+b^2$$
```

The first and third are cards under their respective settings; the second produces sibling deletions. With math clozes on, `==text==` inside `$…$` is not a math cloze. An existing schedule comment keeps a reviewed paragraph together, so changing to one-line clozes does not silently split its schedule.
