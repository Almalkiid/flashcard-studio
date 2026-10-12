# Golden vectors for src/data (inputs and outputs only)

All produced by running the inherited code at commit ebb4f803 plus the working tree of 2026-10-12, with TZ=UTC and the
study date fixed to 2023-09-06. `{"$undefined":true}` marks a value that is undefined (JSON would drop it);
`{"$absent":true}` marks a missing key; `{"throws":"..."}` an exception message; `{"ok":...}` a returned value.

| File | Inputs | Outputs |
|---|---|---|
| topic-path.json | tags, card texts, path arrays, file path + file tags + settings | topic paths (arrays of names) or error messages |
| deck-lists.json | in-memory vaults (file paths and texts) + settings | deck hierarchies (name, new list, due list, subdecks), counts, remaining tree in review and cram mode |
| deck-ops.json | Deck method calls on small trees | results, listed per operation |
| walker-orders.json | one fixture tree; every card order x deck order x scripted random answers x two start decks | order cards are returned in, deck each came from, every random request (lower, upper, answer) |
| walker-ops.json | stateful call sequences on the iterator | state after each call |
| core-pipeline.json | vaults with notes and cards | note review decks, due count, deck hierarchies |
| start-of-day.json | startOfDay setting values | day boundary and warning count |
| settings-upgrade.json | settings blocks as parsed from data.json; tag and path inputs for SettingsUtil | changed keys; SettingsUtil results |
| settings-key-readers.json | every key | files outside settings code that read it |
| plugin-data.json | data.json contents (many shapes), review-log folder inputs | loaded plugin data as a diff against defaults, first-run flag, save count; SettingsManager and DebugLogger behaviour |
| data-manager.json | fake vault + settings | files processed in order, concurrency and waiting behaviour |
| constants.json | schedule comment texts, tag texts | every regex's matches and replacements |
| perf-measurements.json | synthetic vault 1000 notes x 50 cards | timings in ms (jest/jsdom, Mac Mini M4) |

Order setting strings: PickOrder = NewFirstSequential 0, NewFirstRandom 1, DueFirstSequential 2, DueFirstRandom 3,
EveryCardRandomDeckAndCard 4. DeckOrder = PrevDeckComplete_Sequential 0, PrevDeckComplete_Random 1. The setting stores
the names; the loader maps by name and falls back to DueFirstSequential / PrevDeckComplete_Sequential for an unknown name
(the shipped default card order is DueFirstRandom).
