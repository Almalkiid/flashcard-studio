# Golden vectors: cards, parser and storage

Inputs and outputs only. Every file was produced by running the code at commit `ebb4f803` (branch rebuild/settings,
`git archive` snapshot, so later edits do not matter) under jest with `TZ=UTC`, default settings except where an
entry's `options` says otherwise. `options` lists only keys that differ from the defaults. Line numbers are 0-based.
Card ids come from a deterministic stand-in for the random source (the bytes 0,1,2,3...), so an id is always the
base-36 digits of the running byte counter: `012345`, `6789ab`, `cdefgh`, ... The real ids are random 6-character
base-36 strings; compare them by pattern `^[0-9a-z]{6}$`, not by value. The counter restarts for every write case.
Types are the names of the `CardType` enum (numbers: SingleLineBasic 0, SingleLineReversed 1, MultiLineBasic 2,
MultiLineReversed 3, Cloze 4, Callout 5, ImageOcclusion 6).

| File | Entries | What each entry is |
|---|---|---|
| parse-expand.json | 411 | `input` text, `options`, then `cards[]`: `type`, `firstLine`, `lastLine`, `text` (what `parse` returned), `actualQuestion` (after topic tag, schedule comment and block id are split off), `blockId`, `topicTag`, `comment` (first schedule comment inside `text`), `sides[]` (front and back of each card made from `actualQuestion`, cloze spans shown as the plugin renders them). Sources: 194 written for this inventory, 14 written for the test suite (ids `own-`) (ids `sl-` single line, `ml-` multi-line, `em-` end marker, `cf-` code fence, `cz-` cloze, `at-` atomic cloze, `rg-` region, `co-` callout, `oc-` occlusion, `hc-` html comment, `lx-` latex, `x-` misc), the legacy corpus of the repo under 4 settings variants (200), the note of the e2e vault under 3 variants (3). `parse` is called on the text with frontmatter blanked when the id ends `@...` for corpus and vault entries (that is what the note parser does). |
| note-parse.json | 55 | A whole note through `NoteQuestionParser.createQuestionList` (tag filter on, folder path as given in `folderTopicPath`, the unit-test tag finder that reads `#tags` from every line and frontmatter `tags:` list items). `questions[]`: `type`, lines, `original` (the card text with its comment), `actualQuestion`, `blockId`, `questionTopic` (tag on the card line with its surrounding whitespace), `topics` (the deck path list used), `textHash`, `hasChanged` (true when loading alone means the note will be rewritten), `cards[]` with `idx`, `front`, `back`, `schedule` (the comment segment text, or null for a new card) and `meta` (id, suspended, buryUntil, flag, leech, extras). 48 written for this inventory, 6 written for the test suite (ids `own-n-`), 1 vault file (the e2e vault) with its folders as decks. |
| write-schedule.json | 66 | A note, the settings, `operations` (set SM-2 or FSRS schedule on card c of question q, clear it, or change meta), `writePath`, then `output` (the note text afterwards), `noteChanged`, `warnings` (console warnings that were raised) and `reparse` (what loading `output` gives back, per card). |
| delete-question.json | 14 | A note, the question index deleted, `output` after `DataStore.delete`, `written` (whether the file was written at all). |
| file-modifier.json | 4 groups | `removeSchedulesInCards` (12: the "delete card schedules" text rewrite), `removeTagsFromFile` (11: tag deletion in the body and frontmatter, with the tag list as it is after the call), `noteLevel` (2: frontmatter keys removed, and the two-file `deleteAllSchedulingData`), `migrateCommentsToCallouts` (18, each also run a second time to show idempotence). The vault and the frontmatter editor are simulated by in-memory stand-ins (`process(file, fn)` applies `fn` to the text; `processFrontMatter` applies `fn` to a plain object), so YAML formatting is not covered. |
| comment-read.json | 34 | A text with a comment: `schedules[]` read from it (position kept, null for a card without one), `meta[]` per segment, `removeScheduleInfo` (the text with the comment cut out), `warnings` count. |
| question-text.json | 25 | `QuestionText.create` on a text: the pieces and the hash. |
| format-comment.json | 16 | The segment written for one card in each state, under SM-2 and FSRS, and the id the card holds afterwards. |
| file-and-list.json | groups | `questionContext` (8: heading breadcrumbs from a fake heading list, and the headings left in the cache after), `noteSchedule` (10: `sr-due/sr-interval/sr-ease` frontmatter read at the snapshot commit), `noteIds`, `tagsFromText` (7), `textDirection` (6), `frontmatterMap`, `buriedCards` (add, remove, new day, same day). |
| performance.json | - | Timings in milliseconds on a Mac Mini M4 (best of N runs for parse; single runs for the note level). Machine dependent: use the ratios. |

Reproduce: recipe in section 14 of the behaviour inventory.
