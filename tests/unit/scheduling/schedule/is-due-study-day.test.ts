import { State } from "ts-fsrs";

import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { globalDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// P3-R6 (D2 #17): an SM-2 card is due on its date, which starts with the study day of that date, not at the midnight
// before a later day boundary. An FSRS card is due at its instant, as its learning steps need.

const FOUR_AM = { hour: 4, minute: 0, second: 0 };

/** The global clock at a local time, with the given day boundary. */
function clockAt(at: string, boundary: typeof FOUR_AM | null): void {
    setupStaticDateProvider("2023-09-06");
    Object.defineProperty(globalDateProvider, "now", {
        get: () => moment(at, "YYYY-MM-DD HH:mm"),
        configurable: true,
    });
    globalDateProvider.setDayBoundary(boundary);
}

const sm2DueOn = (day: string) => Sm2State.fromDueDateStr(day, 4, 250);

function fsrsDueAt(at: string): FsrsState {
    return new FsrsState(moment(at, "YYYY-MM-DD HH:mm"), 0, 5, 1, State.Learning, 1, 0, 1, null);
}

describe("an SM-2 card is due from the start of its study day", () => {
    test.each([
        ["2023-09-07 01:00", FOUR_AM, false], // still the study day of 6 September
        ["2023-09-07 03:59", FOUR_AM, false],
        ["2023-09-07 04:00", FOUR_AM, true],
        ["2023-09-07 00:00", null, true], // a midnight boundary: due at midnight, as before
        ["2023-09-06 23:59", null, false],
    ])("due 2023-09-07, at %s with boundary %j: %s", (at, boundary, due) => {
        clockAt(at, boundary);
        expect(sm2DueOn("2023-09-07").isDue()).toBe(due);
    });

    test("a card due on an earlier date stays due", () => {
        clockAt("2023-09-07 01:00", FOUR_AM);
        expect(sm2DueOn("2023-09-06").isDue()).toBe(true);
        expect(sm2DueOn("2023-09-01").isDue()).toBe(true);
    });
});

describe("an FSRS card is due at its instant, whatever the boundary", () => {
    test.each([
        ["2023-09-07 00:59", false],
        ["2023-09-07 01:00", true],
    ])("due 2023-09-07 01:00, at %s: %s", (at, due) => {
        clockAt(at, FOUR_AM);
        expect(fsrsDueAt("2023-09-07 01:00").isDue()).toBe(due);
    });
});

test("a schedule without a valid due date is never due", () => {
    clockAt("2023-09-07 12:00", null);
    expect(new Sm2State(moment("garbage", "YYYY-MM-DD"), 4, 250, 0).isDue()).toBe(false);
    expect(new Sm2State(null, 4, 250, 0).isDue()).toBe(false);
});
