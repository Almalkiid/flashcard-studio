/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "Asia/Beirut"}
 */
import { StaticDateProvider, wallClockMs } from "src/utils/clock";
import { moment } from "src/utils/moment-en";
import { makeStudyDayNumberFn } from "src/utils/start-of-day";

// In Beirut the clocks go forward AT midnight (2026-03-29 00:00 becomes 01:00), so that day has no 00:00 and its
// first instant is 01:00. Step back to the previous day's start, never to "this day's start minus a day": that is
// 01:00 on the 28th, which is an hour too late.

const START = { hour: 4, minute: 30, second: 0 };
const FORMAT = "YYYY-MM-DD HH:mm";

function todayAt(local: string): StaticDateProvider["today"] {
    const provider = new StaticDateProvider(moment(local, "YYYY-MM-DD HH:mm:ss"));
    provider.setDayBoundary(START);
    return provider.today;
}

test("the environment really is Beirut, with daylight saving", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(-180);
    expect(new Date(2026, 2, 29, 0, 30).getHours()).toBe(1); // 00:30 does not exist that day
});

test.each([
    ["2026-03-28 23:59:59", "2026-03-28 00:00"],
    ["2026-03-29 01:00:00", "2026-03-28 00:00"],
    ["2026-03-29 03:00:00", "2026-03-28 00:00"],
    ["2026-03-29 04:29:59", "2026-03-28 00:00"],
    ["2026-03-29 04:30:00", "2026-03-29 01:00"],
    ["2026-03-29 23:59:59", "2026-03-29 01:00"],
    ["2026-03-30 04:29:59", "2026-03-29 01:00"],
    ["2026-03-30 04:30:00", "2026-03-30 00:00"],
])("at %s the study day starts at %s", (local, expected) => {
    expect(todayAt(local).format(FORMAT)).toBe(expected);
});

test("the day before the missing midnight starts at its real midnight, the skipped day at its first instant", () => {
    expect(todayAt("2026-03-29 03:00:00").valueOf()).toBe(Date.UTC(2026, 2, 27, 22)); // 00:00 on the 28th
    expect(todayAt("2026-03-29 12:00:00").valueOf()).toBe(Date.UTC(2026, 2, 28, 22)); // 01:00 on the 29th
});

test("makeStudyDayNumberFn names the day the provider calls today, also on the day with no midnight", () => {
    const dateOfDay = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);
    const stretches = [
        [Date.UTC(2026, 2, 26), Date.UTC(2026, 2, 31)], // 2026-03-29 has no 00:00
        [Date.UTC(2026, 9, 22), Date.UTC(2026, 9, 27)], // 2026-10-25 repeats 23:00 to 00:00
    ];
    for (const boundary of [
        { hour: 0, minute: 0, second: 0 },
        { hour: 0, minute: 30, second: 0 },
        START,
    ]) {
        const dayOf = makeStudyDayNumberFn(boundary);
        for (const [from, to] of stretches) {
            for (let t = from; t < to; t += 15 * 60000) {
                const provider = new StaticDateProvider(moment(t));
                provider.setDayBoundary(boundary);
                expect(dateOfDay(dayOf(t))).toBe(provider.today.format("YYYY-MM-DD"));
            }
        }
    }
});

describe("wallClockMs", () => {
    const DAY = 86_400_000;
    const start = (year: number, month: number, date: number) =>
        new Date(year, month - 1, date).getTime();

    test("the first instant of the date without a midnight reads as that date's midnight", () => {
        expect(new Date(start(2026, 3, 29)).getHours()).toBe(1);
        expect(wallClockMs(start(2026, 3, 29))).toBe(Date.UTC(2026, 2, 29));
        // later that date the wall clock reads as it does
        expect(wallClockMs(start(2026, 3, 29) + 30 * 60_000)).toBe(Date.UTC(2026, 2, 29, 1, 30));
    });

    test("dates are whole days apart across the missing midnight", () => {
        expect(wallClockMs(start(2026, 3, 29)) - wallClockMs(start(2026, 3, 28))).toBe(DAY);
        expect(wallClockMs(start(2026, 3, 30)) - wallClockMs(start(2026, 3, 29))).toBe(DAY);
        expect(wallClockMs(start(2026, 3, 31)) - wallClockMs(start(2026, 3, 26))).toBe(5 * DAY);
    });

    test("dates are whole days apart across the night the clocks go back (the hour 23:00 to 00:00 repeats)", () => {
        expect(wallClockMs(start(2026, 10, 26)) - wallClockMs(start(2026, 10, 23))).toBe(3 * DAY);
        expect(wallClockMs(start(2026, 10, 25)) - wallClockMs(start(2026, 10, 24))).toBe(DAY);
    });

    test("an instant that is not a number stays not a number", () => {
        expect(wallClockMs(NaN)).toBeNaN();
    });
});
