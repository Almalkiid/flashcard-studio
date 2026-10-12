import type { Moment } from "moment";

import { formatScheduleInterval, textInterval } from "src/scheduling/display";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

import { clockAt, DEFAULT_CLOCK } from "./fsrs/clock-at";
import { loadGolden } from "./golden/load-golden";
import { ids, mismatches } from "./schedule/golden-views";

interface ScheduleView {
    algorithm: string;
    dueIso: string | null;
    interval: number;
    ease: number;
    difficulty?: number;
    stability?: number;
    state?: number;
    reps?: number;
    lapses?: number;
    learningSteps?: number;
    lastReviewIso?: string | null;
}
interface FormatRow {
    id: string;
    clock: string;
    input: { case: string; isMobile: boolean; schedule: ScheduleView | null | "@undefined" };
    out: string;
}
const golden = loadGolden<{
    textInterval: {
        id: string;
        input: { interval: number | string | null; isMobile: boolean };
        out: string;
    }[];
    formatScheduleInterval: FormatRow[];
    knownBugs: { bug: number; entries: string[] }[];
}>("display");

const decode = (value: number | string | null): number | null | undefined => {
    if (value === "@undefined") return undefined;
    if (value === "@NaN") return NaN;
    return value as number | null;
};

/** The schedule a golden view describes. */
function scheduleOf(view: ScheduleView): ScheduleState {
    const due = view.dueIso === null ? (null as unknown as Moment) : moment(view.dueIso);
    if (view.algorithm === "SM-2-OSR") return new Sm2State(due, view.interval, view.ease);
    return new FsrsState(
        due,
        view.interval,
        view.difficulty,
        view.stability,
        view.state,
        view.reps,
        view.lapses,
        view.learningSteps,
        view.lastReviewIso ? moment(view.lastReviewIso) : null,
    );
}

const run = (row: FormatRow): string => {
    clockAt(row.clock);
    const raw = row.input.schedule;
    const schedule = raw === "@undefined" ? undefined : raw === null ? null : scheduleOf(raw);
    return formatScheduleInterval(schedule, row.input.isMobile);
};

beforeEach(() => {
    clockAt(DEFAULT_CLOCK);
});

describe("textInterval", () => {
    test("days, months or years with one decimal, desktop and mobile (302 rows)", () => {
        const bad = mismatches(golden.textInterval, (row) => ({
            expected: row.out,
            actual: textInterval(decode(row.input.interval), row.input.isMobile),
        }));
        expect(golden.textInterval).toHaveLength(302);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test.each([
        [27, "27 day(s)", "27d"],
        [29, "1 month(s)", "1m"],
        [41, "1.3 month(s)", "1.3m"],
        [347, "1 year(s)", "1y"],
        [1000, "2.7 year(s)", "2.7y"],
        [36525, "100 year(s)", "100y"],
    ])("the inventory's %d", (interval, desktop, mobile) => {
        expect(textInterval(interval, false)).toBe(desktop);
        expect(textInterval(interval, true)).toBe(mobile);
    });

    test("no interval reads New", () => {
        expect(textInterval(null, false)).toBe("New");
        expect(textInterval(undefined, true)).toBe("New");
    });
});

describe("formatScheduleInterval", () => {
    // D2 #9: an SM-2 Again (interval below a day, due today or earlier) read "1 min", which it never is: the card comes
    // back later in the same session. It reads "Today" now. The other rows listed under the bug are SM-2 schedules due
    // tomorrow, whose hours until the day turns are true, so they keep their text.
    const listed = new Set(golden.knownBugs.find((bug) => bug.bug === 9).entries);
    const isBecomingToday = (row: FormatRow): boolean =>
        listed.has(row.id) && row.out === (row.input.isMobile ? "1m" : "1 min");

    test("every row of the answer-button labels (224 rows) except those D2 #9 changes", () => {
        const kept = golden.formatScheduleInterval.filter((row) => !isBecomingToday(row));
        const bad = mismatches(kept, (row) => ({ expected: row.out, actual: run(row) }));
        expect(kept).toHaveLength(212);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("D2 #9: the 12 SM-2 Again previews that read 1 min read Today", () => {
        const changed = golden.formatScheduleInterval.filter(isBecomingToday);
        const bad = mismatches(changed, (row) => ({ expected: "Today", actual: run(row) }));
        expect(changed).toHaveLength(12);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
        // 3 schedules x 2 forms x 2 clocks: interval 0 and 0.4 due the start of today, and the Again case
        expect(new Set(changed.map((row) => row.input.case))).toEqual(
            new Set([
                "sm2-interval-0-due-today-start",
                "sm2-interval-0.4-due-today-start",
                "sm2-again-interval0-due-start-of-today",
            ]),
        );
    });

    test("the 8 listed rows that are due tomorrow keep their hours (24 hr, or 16 hr at 08:30)", () => {
        const kept = golden.formatScheduleInterval.filter(
            (row) => listed.has(row.id) && !isBecomingToday(row),
        );
        expect(kept).toHaveLength(8);
        expect(ids(mismatches(kept, (row) => ({ expected: row.out, actual: run(row) })))).toEqual(
            [],
        );
    });

    test("a learning step that is already due still reads 1 min, an SM-2 Again does not", () => {
        clockAt(DEFAULT_CLOCK);
        const step = new FsrsState(moment(DEFAULT_CLOCK), 0, 5.5, 0.4, 1, 1, 0, 1, null);
        const again = new Sm2State(moment("2023-09-06"), 0, 230);
        expect(formatScheduleInterval(step, false)).toBe("1 min");
        expect(formatScheduleInterval(again, false)).toBe("Today");
        expect(formatScheduleInterval(again, true)).toBe("Today");
    });

    test("it does not exist for the dead pending-time helper", async () => {
        const module = await import("src/scheduling/display");
        expect(Object.keys(module).sort()).toEqual(["formatScheduleInterval", "textInterval"]);
    });
});
