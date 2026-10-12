# Golden test vectors for the Flashcard Studio scheduling rewrite

Inputs and outputs of the inherited scheduling code, captured so a rewrite built without seeing that code can prove it
produces identical stored text and identical schedules. The JSON files hold data only: no old source code is in them or
in this file, only inputs, outputs and the names of public functions. The behaviour inventory
(`docs/superpowers/specs/2026-10-12-scheduling-behaviour-inventory.md` in the repo) says what the numbers mean; section
numbers below refer to it.

## What was captured from

| Item               | Value                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot           | commit `16cf7852` (`16cf78521c668e84fbb4f05ea04aa355e78d8ce0`), the last commit with the inherited scheduling code and the old date helpers intact                                                                                                                                        |
| Snapshot made with | `git -C "/Users/idrisalmalki/Projects Apps/flashcard-studio" archive 16cf7852 \| tar -x -C <golden>/snapshot`, then `ln -s "/Users/idrisalmalki/Projects Apps/flashcard-studio/node_modules" <golden>/snapshot/node_modules`                                                              |
| Repo working tree  | not touched (all work is under the scratchpad `golden/` directory)                                                                                                                                                                                                                        |
| Runtime            | node v22.23.1, esbuild 0.28.1, ts-fsrs 5.4.1, moment 2.30.1, pagerank.js 1.0.2 (the repo's own `node_modules`)                                                                                                                                                                            |
| Time zone          | `TZ=UTC` for everything, except the `dst` section of `histogram.json`, which a child process computes under `TZ=America/New_York`                                                                                                                                                         |
| Clock              | the repo's static date provider, set with its own helper `setupStaticDateProvider("2023-09-06")` (so the instant is 2023-09-06T00:00:00.000Z). A time of day is set by replacing the instant the static provider holds; every row that uses another instant says so (`clock` field or id) |
| Obsidian           | the `obsidian` module is aliased to a 20-line stub (the real `moment`, a recording `Notice`, `Platform`); the stub is `gen/obsidian-stub.cjs`                                                                                                                                             |

## How to regenerate

The generator scripts (kept outside the repo, in the session scratchpad) are in `gen/` (TypeScript drivers that call only public functions of the snapshot, plus the stub):

```
cd <golden>/gen
./run-all.sh            # all seven files, in order
./build.sh sm2-grid     # one file; also: comments frontmatter fsrs display histogram reviewSession
```

`build.sh <name>` bundles `gen/<name>.ts` with esbuild (`--bundle --platform=node --format=cjs`, tsconfig `paths` mapping
`src/*` and `tests/*` to the snapshot, `--alias:obsidian=./obsidian-stub.cjs`), then runs the bundle from the snapshot
directory with `TZ=UTC node`. Output goes to `out/`. Two complete runs at different times were compared byte for byte:
all seven files are identical (random values come from seeded generators; card ids from a seeded `crypto`; values that
would come from the real wall clock are replaced by the marker `@wall-clock-now`).

Seeds (mulberry32): comments `20231006` (card-id crypto `20231007`), frontmatter `20231007`, sm2-grid `20231008`,
fsrs `20231009`, histogram `20231010` (crypto too), reviewSession `20231011` (crypto only; ids are normalised anyway).
Each file that uses randomness records its seed in `meta.seed` (`display.json` has none: it is a fixed list).

## Reading the files

- Every file is `{ meta, knownBugs, ...sections }`. `meta` has the inventory sections covered, seed, clock, snapshot commit
  and notes on the row shapes. Rows have a unique `id`; `knownBugs[].entries` refers to those ids.
- JSON cannot hold some values, so they are strings that start with `@`: `@NaN`, `@Infinity`, `@-Infinity`, `@-0`,
  `@undefined` (property or argument is `undefined`), `@invalid` (an invalid moment), `@wall-clock-now`,
  `@throws: <message>` (the call raised that error), `@skipped (...)` (not applicable). Where a call can throw, a row
  may also have `{ "throws": "<message>" }` instead of an output.
- A "schedule view" has: `algorithm`, `dueIso` (UTC ISO or `@invalid`), `dueDay` (the local `YYYY-MM-DD` the SM-2 writer
  prints), `interval`, `ease` (for FSRS: the derived pseudo-ease), `delayTicks`, for FSRS also `difficulty`, `stability`,
  `state` (0 New, 1 Learning, 2 Review, 3 Relearning), `reps`, `lapses`, `learningSteps`, `lastReviewIso`, then `isDue`
  (against the clock) and `text` (the comment segment the object writes).
- Page ranks and link totals (`sm2-grid.json` graphs, `histogram.json` vault runs) are raw doubles; compare with a relative
  tolerance of 1e-9 if the arithmetic is reproduced rather than reused. Everything else is exact.
- `knownBugs`: each item is `{ bug, title, entries, fixedValue | fixedValues, statedByInventory }`. `bug` is the number in
  inventory section 14 (`null` = found while capturing and **not** in the inventory). `entries` are the ids a deliberate
  fix will change. `fixedValue(s)` is what the fixed code should give, **only** where the inventory states it or where it
  follows mechanically from the stated rule; `statedByInventory` says which. A rewrite that reproduces the old behaviour
  must match every row; a rewrite that fixes bug N must match every row except the ids listed under N, which take the fixed
  value instead.
- Card ids in `review-session.json` are normalised: in each scenario the first id seen becomes `c1`, the next `c2`, and so on,
  scanning the note text of a snapshot first and then the log entries. Apply the same renumbering to the rewrite's output
  (replace `,id=<anything>` in the note text and the `c` field of log entries) before comparing.

## Files, coverage, entry counts

| File                      | Covers (inventory)                                                                                                                                                                                                                                             | Entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out/comments.json`       | 4.2 SM-2 segment, 4.3 FSRS segment, 4.4 placeholders and the metadata tail, 4.5 how a comment is read (every odd/legacy shape in its table, no-bang, bare triples, date formats, extra tokens), 5.3-5.5 fields of the schedule objects, FSRS timestamp helpers | 954 rows: 330 random SM-2 schedules and 330 random FSRS schedules (written text, parsed fields, round trip), 16 number-formatting edge cases, 65 placeholder/metadata cases (both algorithms, four base eases), 140 multi-card comments, 57 legacy/odd inputs, 16 timestamp helper cases                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `out/frontmatter.json`    | 4.6 note frontmatter, 5.4 delay sign for notes, 7.3 note flows                                                                                                                                                                                                 | 208 rows: 129 writes (schedule to `sr-due`/`sr-interval`/`sr-ease`, existing keys kept, read back), 31 reads of cache shapes (strings, numbers, lists, empty, null, bad dates and numbers), 48 review flows (read, calculate, write; both algorithm settings)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `out/sm2-grid.json`       | 7.1 `sm2Step`, 7.2 card algorithm, 7.3 note algorithm and ease list, 7.4 link graph and page ranks, 5.4 schedule class, 14 #1 and #6                                                                                                                           | 12,369 rows (7,817 pure `sm2Step` over intervals x eases x delays x responses for load balancing on/off, no histogram, fractional delays, easy bonus, hard multiplier, maximum interval and base ease variations, seven histogram states; 2,264 card updates read from comments with the sign fix computed per row; 240 constructed-schedule rows with the intended sign; 360 new-card answers; 684 new-note and 768 updated-note rows over 11 link graphs and `maxLinkFactor` 0, 0.5, 1; 89 flashcard-average-ease rows; 16 `noteOnLoadedNote` rows; 43 schedule-class rows; 73 cross-checks against numbers printed in the inventory, all matching)                                                               |
| `out/fsrs.json`           | 4.3, 4.8, 5.5, 6.1-6.5                                                                                                                                                                                                                                         | 5,535 rows (28 parameter objects incl. custom 17/19/21-number weights and invalid ones; 336 new-card first answers at three clocks; 3,800 review-card answers over stability x difficulty x elapsed days x grade, plus fuzz on with repeat-equality checks, retention, maximum-interval caps, weights, steps variants; 480 learning/relearning answers; 15 reset rows; 18 twenty-five-step sequences; frozen-parameter/`updateParameters`; 142 SM-2 to FSRS card conversions; 108 ease/difficulty/clamp rows; grade mapping; 440 SM-2 schedules answered under FSRS; 72 FSRS schedules answered under SM-2; FSRS schedule class; notes under the FSRS setting; 26 cross-checks against the inventory, all matching) |
| `out/display.json`        | 8.1 `textInterval`, `formatScheduleInterval`, `formatPendingDueTime`                                                                                                                                                                                           | 531 rows (302 `textInterval`, 224 `formatScheduleInterval` for both algorithms at two clocks, 5 `formatPendingDueTime` marked dead)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `out/histogram.json`      | 8.2 histogram class and `findLeastUsedIntervalOverRange`, the fuzz window half-width table, `NoteDueDateHistogram` and `CardDueDateHistogram` calculations, vault runs through the core, 7.1 load balancing, 14 #15, #18                                       | 949 rows (8 operation scripts, 410 searches, 420 half-width probes for intervals 1-420, 6 note-histogram builds, 7 card-histogram builds, 84 vault runs on the repo's unit-test vaults, 14 daylight-saving rows)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `out/review-session.json` | 10.1-10.11 (answer order of operations, cram, skip/delete/edit, pending cards and wake-up, learn-ahead, leeches, daily limits, deck stats, undo, suspend/bury/flag), 4.4                                                                                       | 89 scenarios, 314 step snapshots (note text, review log, current card, queue order, `DeckStats`, pending list, undo availability, card histogram, buried-cards list, button previews)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`review-session.json` snapshots are taken after every step with these fields: `noteText`, `reviewLog`, `current`, `queue`
(what iterating the remaining tree from the current deck would show, as `[front, schedule text or "new"]`), `deckStats`
(the nine numbers by name), `pending` (`[front, due instant]` in list order), `hasPendingCards`, `hasDuePendingCards`,
`nextPendingDueIso`, `canUndo`, `cardHistogram`, `buriedCards`, `previews` (the schedule and button label for every
response, from `determineCardSchedule`), and `dailyLimits`, `notices`, `console` when present. Scenarios run through
`tests/unit/helpers/review-session-context.ts` of the snapshot (review log, undo history and optional daily limits wired
as in the app) with the order `DueFirstSequential` / `PrevDeckComplete_Sequential` that the repo's own tests use.

## Not captured (and why)

- `ReminderManager` (section 9): driven by the Obsidian window, timers and notices; the inventory itself marks it read only.
- Random card/deck orders (`PickOrder`/`DeckOrder` random variants): need the random-number provider; the inventory pins
  them only as "stays selectable".
- The private method that queues a pending card (named by one test): its effect is visible in the `pending` lists.
- `ScheduleStateFactory`, `RepetitionPhase`, the two serialized-schedule interfaces: dead code (inventory 1, 11).
- A non-midnight `startOfDay` boundary: the snapshot's static provider ignores it (inventory section 1, moving target note),
  so oddity 17 has no rows.
- `ObsidianVaultNoteLinkInfoFinder`: a one-line wrapper over Obsidian's cache; the scripted finder interface stands in.

## Things found while capturing that the inventory does not list

- An SM-2 card that is not yet due, whose interval is shorter than the days left until it is due, makes ts-fsrs throw
  (`Invalid delta_t "-3"` in the example) when it is scheduled under FSRS, because the SM-2 conversion puts the last review
  in the future. Rows: `fsrs.json` `sm2SchedulesAnsweredUnderFsrs` (16 ids, listed in `knownBugs`) and
  `review-session.json` scenario `fsrs/sm2-card-early-small-interval-throws` (button previews).
- With `burySiblingCards` on, undoing an answer leaves the question on the buried-cards list: scenario
  `sm2/undo-restores-buried-cards-and-histogram` (`buriedCards.size` stays 1 after the undo).

Both are listed in the files' `knownBugs` with `bug: null`.
