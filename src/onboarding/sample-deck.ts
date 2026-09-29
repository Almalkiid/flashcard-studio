/** Where the sample deck is created. */
export const SAMPLE_DECK_PATH = "Cardwright/Getting started.md";

/**
 * A short deck that shows every card style, written the way a real study note would be.
 */
export function sampleDeckMarkdown(): string {
    return `#flashcards/getting-started

# Getting started with Cardwright

Each card below is written in plain Markdown. Edit this note freely: your changes show up the next time you review.

## One line cards

What does FSRS stand for::Free Spaced Repetition Scheduler

Capital of Japan:::Tokyo

## Multi-line cards

**Why does spaced repetition work?**
?
- Each review, just before you would forget, makes the memory **last longer**
- Reviews spread out over days beat the same time spent cramming
> [!tip] Rate honestly
> Choose **Again** when you forgot. The schedule adapts to how well you really know each card.

**What do the four buttons mean?**
?
- **Again**: you forgot, so you will see it again soon
- **Hard**: you remembered with real effort
- **Good**: you remembered after a moment
- **Easy**: you knew it at once

## Cloze cards

Highlight text to hide it: the ==forgetting curve== shows how memory fades without review.

Each highlight becomes its own card: Cardwright keeps a ==review history== so you can ==undo== an answer.

## Formulas and code

The area of a circle is::$A = \\pi r^2$
`;
}
