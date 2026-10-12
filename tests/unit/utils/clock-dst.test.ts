/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "America/New_York"}
 */
import { StaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";
import { makeStudyDayNumberFn } from "src/utils/start-of-day";

// Days when the clocks change are where "subtract the day start from now" gives the wrong day: moment subtracts
// real minutes, so on the 23-hour spring-forward day 04:30 is only 3.5 hours after midnight. These tests run in
// America/New_York (see zone-environment.cjs) with the day starting at 04:30, and pin the wall-clock answer.

const START = { hour: 4, minute: 30, second: 0 };

function studyDay(local: string): string {
    const provider = new StaticDateProvider(moment(local, "YYYY-MM-DD HH:mm:ss"));
    provider.setDayBoundary(START);
    return provider.today.format("YYYY-MM-DD");
}

test("the environment really is New York, with daylight saving", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(240);
});

describe("spring forward: Sunday 8 March 2026 (02:00 becomes 03:00)", () => {
    test.each([
        ["2026-03-08 00:00:00", "2026-03-07"],
        ["2026-03-08 01:59:59", "2026-03-07"],
        ["2026-03-08 03:00:00", "2026-03-07"],
        ["2026-03-08 04:29:59", "2026-03-07"],
        ["2026-03-08 04:30:00", "2026-03-08"],
        ["2026-03-08 23:59:59", "2026-03-08"],
        ["2026-03-09 04:29:59", "2026-03-08"],
        ["2026-03-09 04:30:00", "2026-03-09"],
    ])("at %s the study day is %s", (local, expected) => {
        expect(studyDay(local)).toBe(expected);
    });

    test("today is that day's real local midnight, 23 hours before the next", () => {
        const provider = new StaticDateProvider(
            moment("2026-03-08 12:00:00", "YYYY-MM-DD HH:mm:ss"),
        );
        expect(provider.today.valueOf()).toBe(Date.UTC(2026, 2, 8, 5)); // 00:00 EST
        const next = new StaticDateProvider(moment("2026-03-09 12:00:00", "YYYY-MM-DD HH:mm:ss"));
        expect(next.today.valueOf()).toBe(Date.UTC(2026, 2, 9, 4)); // 00:00 EDT
    });

    test("a day start inside the skipped hour begins when that wall-clock time next occurs", () => {
        const at = (local: string) => {
            const provider = new StaticDateProvider(moment(local, "YYYY-MM-DD HH:mm:ss"));
            provider.setDayBoundary({ hour: 2, minute: 30, second: 0 }); // 02:30 does not exist that day
            return provider.today.format("YYYY-MM-DD");
        };
        expect(at("2026-03-08 01:59:59")).toBe("2026-03-07");
        expect(at("2026-03-08 03:29:59")).toBe("2026-03-07");
        expect(at("2026-03-08 03:30:00")).toBe("2026-03-08");
    });
});

describe("fall back: Sunday 1 November 2026 (02:00 becomes 01:00)", () => {
    test.each([
        ["2026-11-01 00:00:00", "2026-10-31"],
        ["2026-11-01 03:30:00", "2026-10-31"],
        ["2026-11-01 04:29:59", "2026-10-31"],
        ["2026-11-01 04:30:00", "2026-11-01"],
        ["2026-11-01 23:59:59", "2026-11-01"],
        ["2026-11-02 04:29:59", "2026-11-01"],
        ["2026-11-02 04:30:00", "2026-11-02"],
    ])("at %s the study day is %s", (local, expected) => {
        expect(studyDay(local)).toBe(expected);
    });

    test("both passes through the repeated 01:30 are still the day before", () => {
        for (const utcHour of [5, 6]) {
            const provider = new StaticDateProvider(moment(Date.UTC(2026, 10, 1, utcHour, 30)));
            provider.setDayBoundary(START);
            expect(provider.today.format("YYYY-MM-DD HH:mm")).toBe("2026-10-31 00:00");
        }
    });

    test("today is that day's real local midnight, 25 hours before the next", () => {
        const first = new StaticDateProvider(moment("2026-11-01 12:00:00", "YYYY-MM-DD HH:mm:ss"));
        expect(first.today.valueOf()).toBe(Date.UTC(2026, 10, 1, 4)); // 00:00 EDT
        const next = new StaticDateProvider(moment("2026-11-02 12:00:00", "YYYY-MM-DD HH:mm:ss"));
        expect(next.today.valueOf()).toBe(Date.UTC(2026, 10, 2, 5)); // 00:00 EST
    });
});

// The statistics and the optimizer count study days with makeStudyDayNumberFn (src/utils/start-of-day.ts), which reads
// the local date straight from Date so it stays fast. It has to name the very day that provider.today names.
describe("makeStudyDayNumberFn names the day the provider calls today", () => {
    const at = (iso: string): number => new Date(iso).getTime();
    const dateOfDay = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);
    const todayOf = (epochMs: number, boundary: typeof START): string => {
        const provider = new StaticDateProvider(moment(epochMs));
        provider.setDayBoundary(boundary);
        return provider.today.format("YYYY-MM-DD");
    };

    const boundaries = [
        { hour: 0, minute: 0, second: 0 },
        { hour: 1, minute: 0, second: 0 }, // 01:00 happens twice on the autumn change
        { hour: 1, minute: 30, second: 0 },
        { hour: 2, minute: 30, second: 0 }, // 02:30 does not exist on the spring change
        { hour: 4, minute: 0, second: 0 },
        START,
        { hour: 23, minute: 59, second: 59 },
    ];
    const stretches = [
        [at("2026-03-06T00:00:00-05:00"), at("2026-03-11T00:00:00-04:00")],
        [at("2026-10-30T00:00:00-04:00"), at("2026-11-04T00:00:00-05:00")],
    ];

    test.each(boundaries)("for a start of day of %p, every quarter hour, in order", (boundary) => {
        const dayOf = makeStudyDayNumberFn(boundary);
        for (const [from, to] of stretches) {
            for (let t = from; t < to; t += 15 * 60000) {
                expect(dateOfDay(dayOf(t))).toBe(todayOf(t, boundary));
            }
        }
    });

    test.each(boundaries)(
        "for a start of day of %p, every quarter hour, going back",
        (boundary) => {
            const dayOf = makeStudyDayNumberFn(boundary);
            for (const [from, to] of stretches) {
                for (let t = to - 15 * 60000; t >= from; t -= 15 * 60000) {
                    expect(dateOfDay(dayOf(t))).toBe(todayOf(t, boundary));
                }
            }
        },
    );

    test("with no start of day it is the calendar day", () => {
        const dayOf = makeStudyDayNumberFn(null);
        for (const [from, to] of stretches) {
            for (let t = from; t < to; t += 15 * 60000) {
                expect(dateOfDay(dayOf(t))).toBe(todayOf(t, { hour: 0, minute: 0, second: 0 }));
            }
        }
    });
});
