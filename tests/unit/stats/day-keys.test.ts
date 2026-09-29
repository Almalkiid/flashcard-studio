import {
    addDays,
    boundaryToMs,
    dayKeyRange,
    diffDays,
    makeDayKeyFn,
    weekdayOf,
} from "src/stats/day-keys";

const HOUR = 3600 * 1000;
const at = (iso: string): number => new Date(iso).getTime();

describe("makeDayKeyFn", () => {
    test("uses the calendar date when the day starts at midnight", () => {
        const dayKey = makeDayKeyFn(0);
        expect(dayKey(at("2026-09-29T00:00:00Z"))).toEqual("2026-09-29");
        expect(dayKey(at("2026-09-29T23:59:59Z"))).toEqual("2026-09-29");
        expect(dayKey(at("2026-09-30T00:00:00Z"))).toEqual("2026-09-30");
    });

    test("a day that starts at 04:00 keeps 03:59 in the previous day", () => {
        const dayKey = makeDayKeyFn(4 * HOUR);
        expect(dayKey(at("2026-09-29T03:59:59Z"))).toEqual("2026-09-28");
        expect(dayKey(at("2026-09-29T04:00:00Z"))).toEqual("2026-09-29");
        expect(dayKey(at("2026-09-30T03:59:59Z"))).toEqual("2026-09-29");
    });

    test("crosses month and year boundaries", () => {
        const dayKey = makeDayKeyFn(4 * HOUR);
        expect(dayKey(at("2026-01-01T02:00:00Z"))).toEqual("2025-12-31");
        expect(dayKey(at("2026-03-01T01:00:00Z"))).toEqual("2026-02-28");
    });

    test("gives the same key for many calls on the same day (cached range)", () => {
        const dayKey = makeDayKeyFn(0);
        const base = at("2026-09-29T00:00:00Z");
        for (let i = 0; i < 24; i++) expect(dayKey(base + i * HOUR)).toEqual("2026-09-29");
        // going backwards in time still works
        expect(dayKey(base - 1)).toEqual("2026-09-28");
    });
});

describe("boundaryToMs", () => {
    test("converts a day boundary to milliseconds", () => {
        expect(boundaryToMs({ hour: 4, minute: 30, second: 15 })).toEqual(
            4 * HOUR + 30 * 60000 + 15000,
        );
    });

    test("no boundary means midnight", () => {
        expect(boundaryToMs(null)).toEqual(0);
    });
});

describe("day key arithmetic", () => {
    test("addDays crosses months, years and leap days", () => {
        expect(addDays("2026-09-29", 1)).toEqual("2026-09-30");
        expect(addDays("2026-09-30", 1)).toEqual("2026-10-01");
        expect(addDays("2026-01-01", -1)).toEqual("2025-12-31");
        expect(addDays("2028-02-28", 1)).toEqual("2028-02-29");
        expect(addDays("2026-09-29", 0)).toEqual("2026-09-29");
    });

    test("diffDays counts calendar days", () => {
        expect(diffDays("2026-09-29", "2026-09-30")).toEqual(1);
        expect(diffDays("2026-09-30", "2026-09-29")).toEqual(-1);
        expect(diffDays("2025-12-31", "2026-01-01")).toEqual(1);
        expect(diffDays("2026-09-29", "2026-09-29")).toEqual(0);
    });

    test("weekdayOf returns 0 for Sunday", () => {
        expect(weekdayOf("2026-09-27")).toEqual(0);
        expect(weekdayOf("2026-09-29")).toEqual(2);
        expect(weekdayOf("2026-10-03")).toEqual(6);
    });

    test("dayKeyRange is inclusive and empty when reversed", () => {
        expect(dayKeyRange("2026-09-28", "2026-09-30")).toEqual([
            "2026-09-28",
            "2026-09-29",
            "2026-09-30",
        ]);
        expect(dayKeyRange("2026-09-30", "2026-09-28")).toEqual([]);
    });
});
