/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "America/New_York"}
 */
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { buildCardHistories, dayNumber } from "src/scheduling/optimizer/training-set";

// The optimizer counts whole study days between reviews. The study day is the same one the statistics and the review
// screen use, also on the two days a year when the clocks change. These tests run in America/New_York.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const at = (iso: string): number => new Date(iso).getTime();
const numberOf = (year: number, month: number, day: number): number =>
    Date.UTC(year, month - 1, day) / DAY;

function entry(t: number): ReviewLogEntry {
    return { t, c: "aaaaaa", r: 3, k: 1, ivl: 1, li: 1, ms: 1000, dk: "CIA", f: "n.md" };
}

test("the environment really is New York, with daylight saving", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(240);
});

describe("dayNumber with a day that starts at 04:00", () => {
    test.each([
        ["2026-03-08T03:59:59-04:00", numberOf(2026, 3, 7)],
        ["2026-03-08T04:00:00-04:00", numberOf(2026, 3, 8)],
        ["2026-03-08T04:59:59-04:00", numberOf(2026, 3, 8)],
        ["2026-03-09T03:59:59-04:00", numberOf(2026, 3, 8)],
        ["2026-11-01T03:00:00-05:00", numberOf(2026, 10, 31)],
        ["2026-11-01T03:59:59-05:00", numberOf(2026, 10, 31)],
        ["2026-11-01T04:00:00-05:00", numberOf(2026, 11, 1)],
        ["2026-11-02T03:59:59-05:00", numberOf(2026, 11, 1)],
    ])("at %s it is day %i", (iso, expected) => {
        expect(dayNumber(at(iso), 4 * HOUR)).toBe(expected);
    });

    test("with a day that starts at midnight it is the calendar date", () => {
        expect(dayNumber(at("2026-03-08T00:00:00-05:00"), 0)).toBe(numberOf(2026, 3, 8));
        expect(dayNumber(at("2026-03-07T23:59:59-05:00"), 0)).toBe(numberOf(2026, 3, 7));
        expect(dayNumber(at("2026-11-01T00:00:00-04:00"), 0)).toBe(numberOf(2026, 11, 1));
        expect(dayNumber(at("2026-10-31T23:59:59-04:00"), 0)).toBe(numberOf(2026, 10, 31));
    });
});

describe("buildCardHistories across a clock change, with a day that starts at 04:00", () => {
    test("04:10 after the clocks went forward is the next day", () => {
        const entries = [
            entry(at("2026-03-07T22:00:00-05:00")),
            entry(at("2026-03-08T04:10:00-04:00")),
        ];
        const [history] = buildCardHistories(entries, { dayStartOffsetMs: 4 * HOUR });
        expect(history.reviews.map((r) => r.deltaT)).toEqual([0, 1]);
    });

    test("03:30 after the clocks went back is still the day before", () => {
        const entries = [
            entry(at("2026-10-31T22:00:00-04:00")),
            entry(at("2026-11-01T03:30:00-05:00")),
        ];
        const [history] = buildCardHistories(entries, { dayStartOffsetMs: 4 * HOUR });
        expect(history.reviews).toHaveLength(1);
    });

    test("04:10 after the clocks went back is the next day", () => {
        const entries = [
            entry(at("2026-10-31T22:00:00-04:00")),
            entry(at("2026-11-01T04:10:00-05:00")),
        ];
        const [history] = buildCardHistories(entries, { dayStartOffsetMs: 4 * HOUR });
        expect(history.reviews.map((r) => r.deltaT)).toEqual([0, 1]);
    });
});
