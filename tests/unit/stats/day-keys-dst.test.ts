/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "America/New_York"}
 */
import { makeDayKeyFn } from "src/stats/day-keys";
import { StaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// The statistics' study day and the review screen's "today" must be the same day, also on the two days a year when
// the clocks change. These tests run in America/New_York (see zone-environment.cjs).

const HOUR = 3600 * 1000;
const at = (iso: string): number => new Date(iso).getTime();

test("the environment really is New York, with daylight saving", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(240);
});

describe("a day that starts at 04:00", () => {
    test.each([
        // spring forward: 02:00 EST becomes 03:00 EDT on Sunday 8 March 2026
        ["2026-03-08T01:59:59-05:00", "2026-03-07"],
        ["2026-03-08T03:00:00-04:00", "2026-03-07"],
        ["2026-03-08T03:59:59-04:00", "2026-03-07"],
        ["2026-03-08T04:00:00-04:00", "2026-03-08"],
        ["2026-03-08T04:59:59-04:00", "2026-03-08"],
        ["2026-03-09T03:59:59-04:00", "2026-03-08"],
        ["2026-03-09T04:00:00-04:00", "2026-03-09"],
        // fall back: 02:00 EDT becomes 01:00 EST on Sunday 1 November 2026
        ["2026-11-01T00:30:00-04:00", "2026-10-31"],
        ["2026-11-01T01:30:00-04:00", "2026-10-31"],
        ["2026-11-01T01:30:00-05:00", "2026-10-31"],
        ["2026-11-01T03:00:00-05:00", "2026-10-31"],
        ["2026-11-01T03:59:59-05:00", "2026-10-31"],
        ["2026-11-01T04:00:00-05:00", "2026-11-01"],
        ["2026-11-02T03:59:59-05:00", "2026-11-01"],
        ["2026-11-02T04:00:00-05:00", "2026-11-02"],
    ])("at %s the study day is %s", (iso, expected) => {
        expect(makeDayKeyFn(4 * HOUR)(at(iso))).toBe(expected);
    });
});

describe("a day that starts at midnight", () => {
    test.each([
        ["2026-03-07T23:59:59-05:00", "2026-03-07"],
        ["2026-03-08T00:00:00-05:00", "2026-03-08"],
        ["2026-03-08T23:59:59-04:00", "2026-03-08"],
        ["2026-03-09T00:00:00-04:00", "2026-03-09"],
        ["2026-10-31T23:59:59-04:00", "2026-10-31"],
        ["2026-11-01T00:00:00-04:00", "2026-11-01"],
        ["2026-11-01T23:59:59-05:00", "2026-11-01"],
        ["2026-11-02T00:00:00-05:00", "2026-11-02"],
    ])("at %s the study day is %s", (iso, expected) => {
        expect(makeDayKeyFn(0)(at(iso))).toBe(expected);
    });
});

describe("it names the day the review screen calls today", () => {
    const startsOfDay = [0, 1 * HOUR, 4 * HOUR, 4 * HOUR + 30 * 60000, 23 * HOUR + 59 * 60000];
    const stretches = [
        [at("2026-03-06T00:00:00-05:00"), at("2026-03-11T00:00:00-04:00")],
        [at("2026-10-30T00:00:00-04:00"), at("2026-11-04T00:00:00-05:00")],
    ];

    const todayOf = (epochMs: number, startOfDayMs: number): string => {
        const provider = new StaticDateProvider(moment(epochMs));
        provider.setDayBoundary({
            hour: Math.floor(startOfDayMs / HOUR),
            minute: Math.floor((startOfDayMs % HOUR) / 60000),
            second: 0,
        });
        return provider.today.format("YYYY-MM-DD");
    };

    test.each(startsOfDay)(
        "for a start of day of %i ms, every quarter hour, going forward",
        (ms) => {
            const dayKey = makeDayKeyFn(ms);
            for (const [from, to] of stretches) {
                for (let t = from; t < to; t += 15 * 60000) {
                    expect(dayKey(t)).toBe(todayOf(t, ms));
                }
            }
        },
    );

    test.each(startsOfDay)("for a start of day of %i ms, every quarter hour, going back", (ms) => {
        const dayKey = makeDayKeyFn(ms);
        for (const [from, to] of stretches) {
            for (let t = to - 15 * 60000; t >= from; t -= 15 * 60000) {
                expect(dayKey(t)).toBe(todayOf(t, ms));
            }
        }
    });
});
