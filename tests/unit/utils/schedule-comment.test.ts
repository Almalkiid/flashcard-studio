import type { Moment } from "moment";
import { moment as obsidianMoment } from "obsidian";

import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { setupStaticDateProvider } from "src/utils/clock";
import { CommentParser } from "src/utils/schedule-comment";

// moment warns on stderr when it falls back to Date for text that is not ISO; the unreadable inputs below do exactly that
(
    obsidianMoment as unknown as { suppressDeprecationWarnings: boolean }
).suppressDeprecationWarnings = true;

const DAY = 86_400_000;

// The reader warns about every segment it drops, and many inputs below are meant to be dropped
let warn: jest.SpyInstance;

beforeEach(() => {
    // 2023-09-06 00:00 UTC (the suite runs with TZ=UTC)
    setupStaticDateProvider("2023-09-06");
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    warn.mockRestore();
});

// #region -> A plain-data view of a schedule, the shape the golden file uses

type Slot = Record<string, unknown>;

const num = (n: number): number | string => (Number.isNaN(n) ? "@NaN" : n);
const iso = (m: Moment): string => (m.isValid() ? m.toDate().toISOString() : "@invalid");

function view(schedule: ScheduleState | null): Slot | null {
    if (schedule === null) return null;
    const slot: Slot = {
        algorithm: schedule.algorithmType,
        dueIso: iso(schedule.dueDate),
        interval: num(schedule.interval),
        ease: num(schedule.latestEase),
        delayTicks: num(schedule.delayedBeforeReviewTicks),
    };
    if (schedule instanceof FsrsState) {
        Object.assign(slot, {
            difficulty: num(schedule.difficulty),
            stability: num(schedule.stability),
            state: num(schedule.state),
            reps: num(schedule.reps),
            lapses: num(schedule.lapses),
            learningSteps: num(schedule.learningSteps),
            lastReviewIso: schedule.lastReview === null ? null : iso(schedule.lastReview),
        });
    }
    return slot;
}

const parse = (comment: string): (Slot | null)[] =>
    CommentParser.parseMultiScheduleComment(comment).map(view);

// #endregion

describe("parseMultiScheduleComment", () => {
    test("one SM-2 card", () => {
        expect(parse("!2023-09-10,4,270")).toEqual([
            {
                algorithm: SchedulerKind.SM2,
                dueIso: "2023-09-10T00:00:00.000Z",
                interval: 4,
                ease: 270,
                delayTicks: -4 * DAY,
            },
        ]);
    });

    test("cards keep their positions, an unreviewed one is a null", () => {
        const slots = parse("!2023-09-10,4,270!2000-01-01,1,250!2023-09-12,6,260");
        expect(slots.map((slot) => slot?.dueIso ?? null)).toEqual([
            "2023-09-10T00:00:00.000Z",
            null,
            "2023-09-12T00:00:00.000Z",
        ]);
    });

    test.each([[""], ["!"], ["!!"], [" "]])("%j has no cards", (comment) => {
        expect(CommentParser.parseMultiScheduleComment(comment)).toEqual([]);
    });

    test("the leading bang is optional and spaces around a card are ignored", () => {
        expect(parse("2023-09-10,4,270")).toEqual(parse("!2023-09-10,4,270"));
        expect(parse(" !2023-09-10,4,270 ! 2023-09-11,5,260 ")).toHaveLength(2);
    });

    test("the tokens after the three numbers (id, susp, flag...) are not part of the schedule", () => {
        expect(parse("!2023-09-10,4,270,id=abc123,susp,flag=2")).toEqual(
            parse("!2023-09-10,4,270"),
        );
    });

    test.each([["10-09-2023"], ["Sun Sep 10 2023"], ["2023-09-10"]])(
        "reads the due date %s",
        (date) => {
            expect(parse(`!${date},4,270`)[0]?.dueIso).toBe("2023-09-10T00:00:00.000Z");
        },
    );

    test("an interval is read as written, fraction included; an ease is a whole number", () => {
        const slot = parse("!2023-09-17,10.8,273.4")[0];
        expect([slot?.interval, slot?.ease]).toEqual([10.8, 273]);
    });

    test("an FSRS card: stability comes before difficulty in the text", () => {
        const slot = parse(
            "!fsrs,2023-09-10T08:00:00.000Z,7,7.21,5.1,2,3,0,0,2023-09-03T08:00:00.000Z",
        )[0];
        expect(slot).toMatchObject({
            algorithm: SchedulerKind.FSRS,
            dueIso: "2023-09-10T08:00:00.000Z",
            interval: 7,
            stability: 7.21,
            difficulty: 5.1,
            state: 2,
            reps: 3,
            lapses: 0,
            learningSteps: 0,
            lastReviewIso: "2023-09-03T08:00:00.000Z",
        });
    });

    test("an FSRS card with a dash for the last review has none", () => {
        expect(
            parse("!fsrs,2023-09-10T08:00:00.000Z,7,7.21,5.1,2,3,0,0,-")[0]?.lastReviewIso,
        ).toBeNull();
    });

    test("an FSRS card cut short before the last review has none, not 'now'", () => {
        const slot = parse("!fsrs,2023-09-10T08:00:00.000Z,7,7.21,5.1,2,3,0,0")[0];
        expect(slot?.dueIso).toBe("2023-09-10T08:00:00.000Z");
        expect(slot?.lastReviewIso).toBeNull();
    });

    test("an FSRS card with a date-only due reads as midnight", () => {
        expect(parse("!fsrs,2023-09-10,7,7.2,5.1,2,3,0,0,-")[0]?.dueIso).toBe(
            "2023-09-10T00:00:00.000Z",
        );
    });

    test("an FSRS placeholder is no schedule", () => {
        expect(parse("!fsrs,-,0,0,0,0,0,0,0,-")).toEqual([null]);
    });

    test("'fsrs' not followed by a comma is the start of an SM-2 date", () => {
        expect(parse("!fsrs2023-09-10,4,270")[0]).toMatchObject({
            algorithm: SchedulerKind.SM2,
            dueIso: "2023-09-10T00:00:00.000Z",
            interval: 4,
            ease: 270,
        });
    });

    describe("text that cannot be a schedule is no schedule, in the card's place", () => {
        test.each([
            ["a date that is not a date", "!garbage,4,270"],
            ["numbers that are not numbers", "!2023-09-10,x,y"],
            ["only a date", "!2023-09-10"],
            ["a date and an interval", "!2023-09-10,4"],
            ["a word", "!garbage"],
            ["FSRS with nothing after the comma", "!fsrs,"],
            ["FSRS cut after four fields", "!fsrs,2023-09-10T08:00:00.000Z,7,7.21"],
            ["FSRS with an unreadable due", "!fsrs,garbage,7,7.21,5.1,2,3,0,0,-"],
            ["FSRS with a number that is not one", "!fsrs,2023-09-10,7,abc,5.1,2,3,0,0,-"],
            ["FSRS with a state beyond 3", "!fsrs,2023-09-10,7,7.2,5.1,9,3,0,0,-"],
            ["FSRS with a negative state", "!fsrs,2023-09-10,7,7.2,5.1,-1,3,0,0,-"],
            ["upper-case FSRS", "!FSRS,2023-09-10T08:00:00.000Z,7,7.21,5.1,2,3,0,0,-"],
        ])("%s", (_name, comment) => {
            expect(parse(comment)).toEqual([null]);
            expect(
                parse(`!2023-09-10,4,270${comment}!2023-09-12,6,260`).map((s) => s === null),
            ).toEqual([false, true, false]);
        });
    });

    test("an unreadable last review is dropped and the rest of the card is kept", () => {
        const slot = parse("!fsrs,2023-09-10,7,7.2,5.1,2,3,0,0,garbage")[0];
        expect(slot).toMatchObject({ dueIso: "2023-09-10T00:00:00.000Z", interval: 7, state: 2 });
        expect(slot?.lastReviewIso).toBeNull();
    });

    test("numbers in odd notation: an interval is a number (1e3 is 1000), an ease is its whole part (2e2 is 2)", () => {
        expect(parse("!2023-09-02,1e3,2e2")[0]).toMatchObject({ interval: 1000, ease: 2 });
        expect(parse("!2023-09-02,-3,0")[0]).toMatchObject({ interval: -3, ease: 0 });
    });

    test("FSRS fields that are fractions where whole numbers belong are cut to the whole part", () => {
        expect(parse("!fsrs,2023-09-10,0,0.4,5.5,2.7,1.9,0.5,1.5,-")[0]).toMatchObject({
            state: 2,
            reps: 1,
            lapses: 0,
            learningSteps: 1,
        });
    });
});

describe("parseScheduleSegment", () => {
    test("reads one segment", () => {
        const schedule = CommentParser.parseScheduleSegment("2023-09-10,4,270");
        expect(schedule).toBeInstanceOf(Sm2State);
        expect(view(schedule)).toMatchObject({ interval: 4, ease: 270 });
    });

    test("an empty segment is no schedule", () => {
        expect(CommentParser.parseScheduleSegment("")).toBeNull();
    });

    test("an FSRS segment is read as FSRS", () => {
        const segment = "fsrs,2023-09-10T08:00:00.000Z,7,7.21,5.1,2,3,0,0,-";
        expect(CommentParser.parseScheduleSegment(segment)).toBeInstanceOf(FsrsState);
    });
});

describe("parseSM2Schedule", () => {
    test("the delay is the start of today minus the due date: positive when overdue", () => {
        expect(CommentParser.parseSM2Schedule("2023-09-10", 4, 270)?.delayedBeforeReviewTicks).toBe(
            -4 * DAY,
        );
        expect(CommentParser.parseSM2Schedule("2023-09-01", 4, 270)?.delayedBeforeReviewTicks).toBe(
            5 * DAY,
        );
    });

    test.each([["2000-01-01"], ["01-01-2000"], ["Sat Jan 01 2000"]])(
        "the never-reviewed date %s is no schedule",
        (date) => {
            expect(CommentParser.parseSM2Schedule(date, 1, 250)).toBeNull();
        },
    );

    test.each([
        ["a date that is not one", "garbage", 4, 270],
        ["an interval that is not a number", "2023-09-10", NaN, 270],
        ["an ease that is not a number", "2023-09-10", 4, NaN],
        ["an infinite interval", "2023-09-10", Infinity, 270],
    ])("%s is no schedule", (_name, date, interval, ease) => {
        expect(CommentParser.parseSM2Schedule(date, interval, ease)).toBeNull();
    });

    test("impossible days roll over, as notes written by older versions rely on", () => {
        expect(iso(CommentParser.parseSM2Schedule("2023-13-45", 4, 270)?.dueDate)).toBe(
            "2023-01-20T00:00:00.000Z",
        );
    });
});
