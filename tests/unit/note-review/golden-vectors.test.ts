import fs from "fs";

import { GOLDEN_DIR } from "./helpers/parity";

// Every golden file is held to by one parity test; this keeps a new file from being added without one.
const HELD_BY: Record<string, string> = {
    "deck-order": "queue-parity",
    "next-note-deck": "queue-parity",
    "next-note-handler": "handler-sidebar",
    "note-ease-list": "queue-parity",
    "note-question-parser": "parser-parity",
    "ordering-scan": "queue-parity",
    "pane-active-file-expansion": "pane-parity",
    "pane-boundary": "pane-parity",
    "pane-boundary-america-new_york": "pane-parity-new-york",
    "pane-boundary-asia-beirut": "pane-parity-beirut",
    "pane-dst": "pane-parity",
    "pane-dst-america-new_york": "pane-parity-new-york",
    "pane-dst-asia-beirut": "pane-parity-beirut",
    "pane-groups": "pane-parity",
    "pane-groups-america-new_york": "pane-parity-new-york",
    "pane-groups-asia-beirut": "pane-parity-beirut",
    "pane-interactions": "pane-parity",
    "pane-user-flow": "pane-parity",
    "queue-build": "queue-parity",
    "queue-day-boundary": "queue-parity",
    "queue-ops": "queue-parity",
    rating: "queue-parity",
    "sidebar-manager-traces": "handler-sidebar",
    "sort-vectors": "queue-parity",
    timings: "performance",
};

describe("golden vectors of the note review", () => {
    const files = fs
        .readdirSync(GOLDEN_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();

    test("there are 25 JSON files and each one is held by a parity test", () => {
        expect(files).toEqual(Object.keys(HELD_BY).sort());
    });

    test.each(files)("%s names a parity test that exists", (name) => {
        expect(fs.existsSync(`${__dirname}/${HELD_BY[name]}.test.ts`)).toBe(true);
    });
});
