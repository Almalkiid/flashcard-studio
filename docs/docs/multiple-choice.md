# Multiple-choice cards

A multi-line card becomes multiple choice when its answer is one checklist with at least two items and at least one checked item.

```markdown
Which body sets the internal audit charter?
?

- [ ] The CAE
- [x] The board
- [ ] External auditors
- [ ] Senior management
      Explanation: the board approves the charter.
```

Lines after the checklist are shown as an explanation. In review, choose an option or use keys 1–9. One correct option suggests **Good**; a wrong answer suggests **Again**. Multiple checked items require selecting all answers and then choosing **Check**.

**Shuffle choices** is on by default. A one-item list, a list with no checked item, nested items, or mixed plain bullets remains an ordinary card. `??` still creates the reverse card; its front is the checklist and its back is the question.

```markdown
One item?
?

- [x] Only answer

No checked answer?
?

- [ ] A
- [ ] B
```

Both examples are ordinary multi-line cards, not multiple choice. The accepted checklist remains the card body; its scheduling comment is written after the entire card, not after an individual option.
