import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { isDeepStrictEqual } from "util";

import { loadGolden } from "../golden/load-golden";
import { replay, Scenario, Snapshot } from "./golden-replay";

// Every scenario of golden/review-session.json replayed through the new reviewSession: note text, review log, current card,
// queue, deck stats, pending cards, undo, card histogram, buried-cards list, button previews, limits, notices and
// results, after every step. A snapshot may differ only where a decision changes it; those are listed below and the
// new values are pinned in review-session-fixes.test.ts.

const golden = loadGolden<{ scenarios: Scenario[] }>("review-session");

/** Scenarios a deliberate change makes different from the step named on (that step and every later one). */
const CHANGED: Record<string, { from: number; rule: string }> = {
    "sm2/overdue-card-easy": { from: 1, rule: "D2 #1 overdue SM-2 bonus: interval 30, not 15" },
    "sm2/overdue-card-good": { from: 1, rule: "D2 #1 overdue SM-2 bonus: interval 16, not 11" },
    "sm2/overdue-card-hard": { from: 1, rule: "D2 #1 overdue SM-2 bonus: interval 3, not 2" },
    "sm2/stats-multilevel-sample": {
        from: 5,
        rule: "D2 #1 overdue Q4 answered Hard: 3 days, not 2",
    },
    "sm2/overdue-card-again": {
        from: 1,
        rule: "D3 #9 the card just answered Again waits behind Q1",
    },
    "fsrs/cram-new-and-due": { from: 1, rule: "D3 #9 the card just crammed waits behind Q2" },
    "fsrs/equal-due-times-wake-in-reverse": {
        from: 5,
        rule: "D2 #13 equal due times wake A, B, C",
    },
    "fsrs/pending-no-bury-siblings": {
        from: 5,
        rule: "D2 #13 siblings due together wake in answer order",
    },
    "fsrs/failed-note-write-is-silent": {
        from: 2,
        rule: "D2 #2 nothing logged, counted or undoable; notice",
    },
    "fsrs/pending-deleted-question-returns": {
        from: 2,
        rule: "D2 #7 the deleted question's card never returns",
    },
    "sm2/limits-repeated-again-spends-review-allowance": {
        from: 2,
        rule: "D2 #4 a repeated Again counts once",
    },
    "fsrs/limits-reset-card-escapes-both-allowances": {
        from: 2,
        rule: "D2 #4 a reset card's answer is new",
    },
    "fsrs/reset-due-card": {
        from: 3,
        rule: "D2 #4 a reset card's answer is logged as new (n = 1)",
    },
    "sm2/update-text-cloze-count-changes": {
        from: 1,
        rule: "D2 #22 refused before writing; localized notice",
    },
    "sm2/undo-restores-buried-cards-and-histogram": {
        from: 2,
        rule: "D5b undo takes the question off the list",
    },
    "fsrs/sm2-card-early-small-interval-throws": {
        from: 0,
        rule: "D5a (Task 2) previews schedule, no throw",
    },
};

/**
 * Field-level rules that apply wherever they meet, and the one representation difference:
 * - D2 #9 (Task 3): the SM-2 Again button reads "Today", not "1 min".
 * - D2 #1 (Task 1): the Hard, Good and Easy previews of an SM-2 card that is overdue or early change with the bonus
 *   (sm2-grid.json pins those numbers; the answers are pinned in review-session-fixes.test.ts), so they are not compared.
 * - The pending list is compared in the order the cards wake (the old list was kept in answer order and sorted on
 *   waking; the new one is a heap).
 */
function comparable(snapshot: Snapshot): Snapshot {
    const copy: Snapshot = { ...snapshot };
    const previews = copy.previews as Record<string, { text?: string; label?: string }> | null;
    const current = copy.current as { schedule: string | null } | null;
    if (previews) {
        const fixed = { ...previews };
        if (fixed.Again?.label === "1 min" && !fixed.Again.text.startsWith("!fsrs")) {
            fixed.Again = { ...fixed.Again, label: "Today" };
        }
        const sm2Due = current?.schedule?.match(/^!(\d{4}-\d{2}-\d{2}),/)?.[1];
        if (sm2Due !== undefined && sm2Due !== (copy.clock as string).slice(0, 10)) {
            delete fixed.Hard;
            delete fixed.Good;
            delete fixed.Easy;
        }
        copy.previews = fixed;
    }
    if (Array.isArray(copy.pending)) {
        copy.pending = [...(copy.pending as [string, string][])].sort(
            (a, b) => Date.parse(a[1]) - Date.parse(b[1]),
        );
    }
    return copy;
}

const replays = new Map<string, Snapshot[]>();

beforeAll(async () => {
    for (const scenario of golden.scenarios) replays.set(scenario.id, await replay(scenario));
}, 60_000);

test("the golden file holds 89 scenarios and 314 snapshots, and every listed change names one of them", () => {
    expect(golden.scenarios).toHaveLength(89);
    expect(golden.scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0)).toBe(314);
    const ids = new Set(golden.scenarios.map((scenario) => scenario.id));
    expect(Object.keys(CHANGED).filter((id) => !ids.has(id))).toEqual([]);
});

test.each(golden.scenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s replays as captured",
    (id, scenario) => {
        const actual = replays.get(id);
        const until = CHANGED[id]?.from ?? scenario.steps.length;
        expect(actual).toHaveLength(scenario.steps.length);
        for (let i = 0; i < until; i++) {
            expect(comparable(actual[i])).toEqual(comparable(scenario.steps[i]));
        }
    },
);

/**
 * The snapshots the listed changes give, pinned: `expected-changes.json` holds them as the comparison sees them.
 * Regenerate with UPDATE_EXPECTED_CHANGES=1 after checking every difference against its rule.
 */
const EXPECTED_CHANGES = path.join(__dirname, "expected-changes.json");
const plain = (snapshot: Snapshot): unknown => JSON.parse(JSON.stringify(comparable(snapshot)));

test("the changed snapshots are the pinned ones", () => {
    const actual: Record<string, unknown[]> = {};
    for (const [id, { from }] of Object.entries(CHANGED)) {
        actual[id] = replays.get(id).slice(from).map(plain);
    }
    if (process.env.UPDATE_EXPECTED_CHANGES === "1") {
        writeFileSync(EXPECTED_CHANGES, JSON.stringify(actual, null, 1) + "\n");
    }
    const pinned = JSON.parse(readFileSync(EXPECTED_CHANGES, "utf8")) as Record<string, unknown[]>;
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(CHANGED).sort());
    for (const id of Object.keys(CHANGED)) expect([id, actual[id]]).toEqual([id, pinned[id]]);
});

test.each(Object.entries(CHANGED))("%s changes from its step on: %j", (id, { from }) => {
    const scenario = golden.scenarios.find((candidate) => candidate.id === id);
    const actual = replays.get(id);
    // Through JSON, so key order and undefined fields do not count as a difference
    const changed = scenario.steps
        .slice(from)
        .filter((expected, i) => !isDeepStrictEqual(plain(expected), plain(actual[from + i])));
    expect(changed.length).toBeGreaterThan(0);
});
