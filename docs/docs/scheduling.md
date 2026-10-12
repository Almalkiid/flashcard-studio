# Scheduling

Flashcard Studio uses FSRS for new installs and can use SM-2. A schedule is updated only when you answer a card; [Data and storage](data-storage.md) shows where it is written.

## FSRS in plain words

FSRS estimates how likely you are to recall a card. **Desired retention** is the chance it targets when it next shows the card. At the default 90%, a card predicted to be remembered for ten days is scheduled near that point; changing the target to 95% brings it back sooner and increases workload. The exact interval depends on your history and FSRS parameters, so do not treat a displayed number as a guarantee.

New cards normally use `1m 10m`: answer through those learning waits before graduation. After a lapse, `10m` is the default relearning wait. **Learn ahead** can show a learning card early when the queue is otherwise empty. **Next day starts at** defines when daily limits and “tomorrow” change; at `04:00`, a card buried at 02:00 remains buried until 04:00.

## SM-2 in plain words

SM-2 stores an ease and interval for note review and optional flashcard scheduling. With the default 250% starting ease, an Easy bonus of 130%, and a Good interval of 10 days, Easy is configured to be longer than Good; Hard applies its configured 50% multiplier. These settings do not affect FSRS cards. Switching algorithms keeps due dates until a card is answered again, then rewrites its stored schedule in the selected format.

## Daily limits and review order

Daily limits default to 20 new cards and 200 reviews across all decks. Learning and relearning steps do not count against either cap. **Card order** can put due cards or new cards first, sequentially or shuffled; the any-deck option ignores deck order. Otherwise deck order finishes one deck at a time, sequentially or shuffled. **Bury related cards** hides sibling cards until the next study day.

## Leeches

An FSRS card becomes a leech after eight lapses by default. Set the threshold to 0 to disable leeches. The default action marks and suspends it; the alternative only marks it. Rewording an unclear card is usually more useful than repeatedly reviewing it.

## Useful tools

**Custom study** can raise today’s limit, review forgotten cards, review ahead, preview new cards, or filter by deck, flag, state, and leech. **Postpone due reviews** moves due/overdue review cards without adding review history. The FSRS optimiser needs enough review history before it can fit custom parameters.
