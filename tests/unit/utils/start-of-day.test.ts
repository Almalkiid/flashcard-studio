import { dayBoundaryFromMs, makeStudyDayNumberFn, parseStartOfDay } from "src/utils/start-of-day";

// Older versions saved start-of-day text such as "4:0:0", so the parser reads every shape they could write. The
// settings screen stays strict about what a person types (validators.test.ts).
describe("parseStartOfDay", () => {
    test.each([
        ["04:00:00", { hour: 4, minute: 0, second: 0 }],
        ["00:00:00", { hour: 0, minute: 0, second: 0 }],
        ["23:59:59", { hour: 23, minute: 59, second: 59 }],
        ["04:30:15", { hour: 4, minute: 30, second: 15 }],
        ["4:00:00", { hour: 4, minute: 0, second: 0 }],
        ["4:0:0", { hour: 4, minute: 0, second: 0 }],
        ["04:0:0", { hour: 4, minute: 0, second: 0 }],
        ["4:30:5", { hour: 4, minute: 30, second: 5 }],
        ["4:5:6", { hour: 4, minute: 5, second: 6 }],
        ["004:00:00", { hour: 4, minute: 0, second: 0 }],
        ["04:00:000", { hour: 4, minute: 0, second: 0 }],
        ["04:30", { hour: 4, minute: 30, second: 0 }],
        ["4:5", { hour: 4, minute: 5, second: 0 }],
        [" 04:00:00 ", { hour: 4, minute: 0, second: 0 }],
        ["\t04:00\n", { hour: 4, minute: 0, second: 0 }],
    ])("reads %j", (text, expected) => {
        expect(parseStartOfDay(text)).toEqual(expected);
    });

    test.each([
        "",
        "   ",
        "4",
        "24:00:00",
        "23:60:00",
        "23:59:60",
        "99999999999999999999:00",
        "-1:00:00",
        "+4:00",
        "+5:00:00",
        "4.5:00:00",
        "04:30.5",
        "0x10:00:00",
        "1e1:00:00",
        "ab:00:00",
        "04:xx:00",
        "04::00",
        ":30",
        "04:00:",
        "04:00:00:00",
        "04-00-00",
        "04:00 PM",
        "٤:00:00", // an Arabic-Indic digit is not an ASCII digit
        "garbage",
    ])("rejects %j", (text) => {
        expect(parseStartOfDay(text)).toBeNull();
    });

    test.each([null, undefined, 4, 4.5, NaN, true, {}, [], ["04:00:00"], () => "04:00:00"])(
        "rejects the non-text value %p without throwing",
        (value) => {
            expect(parseStartOfDay(value)).toBeNull();
        },
    );

    test("each call returns a new object", () => {
        expect(parseStartOfDay("04:00")).not.toBe(parseStartOfDay("04:00"));
    });
});

describe("dayBoundaryFromMs", () => {
    const HOUR = 3600 * 1000;

    test.each([
        [0, { hour: 0, minute: 0, second: 0 }],
        [4 * HOUR, { hour: 4, minute: 0, second: 0 }],
        [4 * HOUR + 30 * 60000 + 15000, { hour: 4, minute: 30, second: 15 }],
        [24 * HOUR - 1000, { hour: 23, minute: 59, second: 59 }],
        [4 * HOUR + 999, { hour: 4, minute: 0, second: 0 }],
    ])("%i ms after midnight is %p", (ms, expected) => {
        expect(dayBoundaryFromMs(ms)).toEqual(expected);
    });

    test.each([-1, 24 * HOUR, 25 * HOUR, NaN, Infinity])("%p is not a time of day", (ms) => {
        expect(dayBoundaryFromMs(ms)).toBeNull();
    });
});

describe("makeStudyDayNumberFn", () => {
    const HOUR = 3600 * 1000;
    const DAY = 24 * HOUR;
    const FOUR = { hour: 4, minute: 0, second: 0 };
    // The unit tests run in UTC, so the study day is a whole number of days after shifting back by the start of day
    const reference = (epochMs: number, startMs: number): number =>
        Math.floor((epochMs - startMs) / DAY);

    test("it counts days since 1970-01-01, cut at the start of day", () => {
        const dayOf = makeStudyDayNumberFn(FOUR);
        expect(dayOf(Date.UTC(1970, 0, 1, 12))).toBe(0);
        expect(dayOf(Date.UTC(2026, 8, 29, 3, 59, 59))).toBe(Date.UTC(2026, 8, 28) / DAY);
        expect(dayOf(Date.UTC(2026, 8, 29, 4))).toBe(Date.UTC(2026, 8, 29) / DAY);
        expect(dayOf(Date.UTC(2026, 0, 1, 2))).toBe(Date.UTC(2025, 11, 31) / DAY);
    });

    test("without a start of day it is the calendar day", () => {
        const dayOf = makeStudyDayNumberFn(null);
        expect(dayOf(Date.UTC(2026, 8, 29, 0))).toBe(Date.UTC(2026, 8, 29) / DAY);
        expect(dayOf(Date.UTC(2026, 8, 29, 23, 59, 59))).toBe(Date.UTC(2026, 8, 29) / DAY);
    });

    test("any order of asking, and asking again, gives the same answer", () => {
        const dayOf = makeStudyDayNumberFn({ hour: 4, minute: 30, second: 15 });
        const startMs = 4 * HOUR + 30 * 60000 + 15000;
        let seed = 7;
        for (let i = 0; i < 5000; i++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            const t = Date.UTC(2025, 0, 1) + (seed % (400 * DAY));
            expect(dayOf(t)).toBe(reference(t, startMs));
            expect(dayOf(t)).toBe(reference(t, startMs));
        }
    });

    test("an instant that is not a time gives NaN and spoils nothing after it", () => {
        const dayOf = makeStudyDayNumberFn(FOUR);
        expect(dayOf(NaN)).toBeNaN();
        expect(dayOf(Date.UTC(2026, 8, 29, 4))).toBe(Date.UTC(2026, 8, 29) / DAY);
        expect(dayOf(NaN)).toBeNaN();
        expect(dayOf(Date.UTC(2026, 8, 29, 3))).toBe(Date.UTC(2026, 8, 28) / DAY);
    });
});
