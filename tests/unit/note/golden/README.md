# Golden vectors: note review (spec side)

Produced by running the real code of repo commit ebb4f8039f63c56066b963e8917c6905eff2d6cb (snapshot via `git archive`, in ../snap)
with the generators in ../tests (jest config ../jest.config.cjs; run from ../snap:
`npx --no-install jest --config ../jest.config.cjs`; `INV_TZ=America/New_York` for another zone).
Obsidian is replaced by ../tests/obsidian-mock.js (DOM helpers, ItemView, Menu, Notice, Array.contains). Not run in live Obsidian.
Clocks are frozen with jest fake timers; "local" dates are in the stated TZ (UTC unless the file name carries a zone).
Vault scans use the repo's own FakeVault (tests/unit/scheduling/sm2/fake-vault.ts); scan order = path order (Obsidian's order is unspecified).
The folder/history skip loop of DataManager.loadVault is replicated from the same helper functions.

| file | what |
|---|---|
| queue-build.json | one 18-file vault x 7 settings: decks, new/scheduled lists, due counts, skipped files, note ease list |
| deck-order.json | deck creation order vs settings order |
| queue-ops.json | addNoteToQueue / updateScheduleInfo / calcDueNotesCount step by step (multi-deck behaviour) |
| sort-vectors.json | sortNotesByDateAndImportance cases (ranks, ties, missing ranks) |
| ordering-scan.json | page ranks and resulting order from a scan with links |
| queue-day-boundary.json | due counts under start-of-day 04:00 / 23:00 |
| rating.json | 13 ratings: frontmatter before/after, queue after rating and after a rescan |
| next-note-deck.json | determineNextNote, plain and with a seeded provider (mulberry32 seeds 1-3, 12 draws, provider calls) |
| next-note-handler.json | NextNoteReviewHandler flows: notices, opened files, chooser |
| pane-groups*.json | pane DOM dump (groups, labels, fold state) for 15 cases; UTC, America/New_York, Asia/Beirut |
| pane-boundary*.json, pane-dst*.json | labels with a 04:00 study day, and around daylight-saving changes |
| pane-interactions.json | folder clicks, file click, context menu, events, view identity |
| pane-active-file-expansion.json, pane-user-flow.json | first redraw vs later redraw (the hidden-list bug) |
| sidebar-manager-traces.json | API calls made by SidebarManager against a fake workspace |
| note-question-parser.json | 23 notes: topic path lists, schedules, gate, folder mode |
| note-ease-list.json | NoteEaseList behaviour rows |
| timings.json | queue operation timings (pane timing only up to 5000 notes, jsdom) |
