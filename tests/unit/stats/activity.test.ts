import { countToday } from "src/scheduling/daily-limits";
import {
    bucketDailyCounts,
    dailyCounts,
    heatmap,
    hourly,
    isReview,
    streaks,
    summarizeEntries,
    todaySummary,
} from "src/stats/activity";
import { makeDayKeyFn } from "src/stats/day-keys";

import { entry } from "./fixtures";

const dayKey = makeDayKeyFn(0);
const TODAY = "2026-09-29";

describe("isReview", () => {
    test("manual resets are not reviews, cram answers are", () => {
        expect(isReview(entry({ r: 0, k: 4 }))).toBe(false);
        expect(isReview(entry({ r: 0, k: 1 }))).toBe(false);
        expect(isReview(entry({ r: 3, k: 4 }))).toBe(false);
        expect(isReview(entry({ r: 3, k: 3 }))).toBe(true);
        expect(isReview(entry({ r: 1, k: 0 }))).toBe(true);
    });
});

describe("summarizeEntries and todaySummary", () => {
    const todays = [
        entry({ at: "2026-09-29T09:00:00Z", c: "a", r: 1, k: 1, ms: 4000 }),
        entry({ at: "2026-09-29T09:05:00Z", c: "b", r: 3, k: 1, ms: 6000 }),
        entry({ at: "2026-09-29T09:10:00Z", c: "c", r: 4, k: 0, n: 1, ms: 2000 }),
        entry({ at: "2026-09-29T09:11:00Z", c: "d", r: 2, k: 1, ms: 8000 }),
        entry({ at: "2026-09-29T09:12:00Z", c: "e", r: 0, k: 4, ms: 0 }),
        entry({ at: "2026-09-29T09:13:00Z", c: "f", r: 3, k: 3, ms: 1000 }),
    ];
    const yesterday = entry({ at: "2026-09-28T23:59:59Z", r: 3, k: 1 });

    test("counts reviews, time, new cards, agains and the rating split", () => {
        const summary = todaySummary([yesterday, ...todays], TODAY, dayKey);
        expect(summary.reviews).toEqual(5);
        expect(summary.newLearned).toEqual(1);
        expect(summary.timeMs).toEqual(21000);
        expect(summary.again).toEqual(1);
        expect(summary.ratings).toEqual([1, 1, 2, 1]);
    });

    test("retention is the share of review answers that were not Again", () => {
        const summary = todaySummary(todays, TODAY, dayKey);
        expect(summary.retention).toBeCloseTo(2 / 3, 10);
    });

    test("retention is null when there was no review answer", () => {
        const onlyLearning = [entry({ at: "2026-09-29T09:00:00Z", k: 0, n: 1 })];
        expect(todaySummary(onlyLearning, TODAY, dayKey).retention).toBeNull();
    });

    test("empty input gives zeros", () => {
        expect(todaySummary([], TODAY, dayKey)).toEqual({
            reviews: 0,
            newLearned: 0,
            timeMs: 0,
            again: 0,
            retention: null,
            ratings: [0, 0, 0, 0],
        });
    });

    test("the day boundary decides what is today", () => {
        const lateNight = entry({ at: "2026-09-29T02:30:00Z" });
        const fourAm = makeDayKeyFn(4 * 3600 * 1000);
        expect(todaySummary([lateNight], TODAY, fourAm).reviews).toEqual(0);
        expect(todaySummary([lateNight], "2026-09-28", fourAm).reviews).toEqual(1);
    });

    test("new cards agree with the daily limits definition", () => {
        const dayStart = new Date("2026-09-29T00:00:00Z").getTime();
        expect(summarizeEntries(todays).newLearned).toEqual(countToday(todays, dayStart).newDone);
    });
});

describe("streaks", () => {
    const day = (iso: string, extra = {}) => entry({ at: `${iso}T10:00:00Z`, ...extra });

    test("counts today when today has an answer", () => {
        const entries = [day("2026-09-27"), day("2026-09-28"), day("2026-09-29")];
        expect(streaks(entries, TODAY, dayKey)).toMatchObject({ current: 3, longest: 3 });
    });

    test("ends yesterday when today has no answer yet", () => {
        const entries = [day("2026-09-27"), day("2026-09-28")];
        expect(streaks(entries, TODAY, dayKey).current).toEqual(2);
    });

    test("is zero after a missed day", () => {
        const entries = [day("2026-09-25"), day("2026-09-26"), day("2026-09-27")];
        expect(streaks(entries, TODAY, dayKey).current).toEqual(0);
    });

    test("the longest streak can be an old one", () => {
        const entries = [
            day("2026-09-10"),
            day("2026-09-11"),
            day("2026-09-12"),
            day("2026-09-13"),
            day("2026-09-14"),
            day("2026-09-28"),
            day("2026-09-29"),
        ];
        expect(streaks(entries, TODAY, dayKey)).toMatchObject({
            current: 2,
            longest: 5,
            activeDays: 7,
        });
    });

    test("manual resets do not keep a streak alive", () => {
        const entries = [day("2026-09-28", { r: 0, k: 4 }), day("2026-09-29", { r: 3, k: 1 })];
        expect(streaks(entries, TODAY, dayKey)).toMatchObject({ current: 1, longest: 1 });
    });

    test("several answers on a day count as one day", () => {
        const entries = [day("2026-09-29"), day("2026-09-29"), day("2026-09-29")];
        expect(streaks(entries, TODAY, dayKey)).toMatchObject({ current: 1, activeDays: 1 });
    });

    test("empty input gives zeros", () => {
        expect(streaks([], TODAY, dayKey)).toEqual({ current: 0, longest: 0, activeDays: 0 });
    });

    test("the day boundary moves a late-night answer to the previous day", () => {
        const fourAm = makeDayKeyFn(4 * 3600 * 1000);
        // 02:00 on the 29th is still the 28th, so there is no answer on the 29th and the streak ends on the 28th
        const entries = [
            entry({ at: "2026-09-28T20:00:00Z" }),
            entry({ at: "2026-09-29T02:00:00Z" }),
        ];
        expect(streaks(entries, TODAY, fourAm)).toMatchObject({ current: 1, activeDays: 1 });
    });
});

describe("dailyCounts", () => {
    const entries = [
        entry({ at: "2026-09-27T10:00:00Z", k: 0, ms: 1000 }),
        entry({ at: "2026-09-27T11:00:00Z", k: 1, ms: 2000 }),
        entry({ at: "2026-09-27T12:00:00Z", k: 1, ms: 3000 }),
        entry({ at: "2026-09-29T10:00:00Z", k: 2, ms: 4000 }),
        entry({ at: "2026-09-29T11:00:00Z", k: 3, ms: 5000 }),
        entry({ at: "2026-09-29T12:00:00Z", r: 0, k: 4, ms: 0 }),
        entry({ at: "2026-09-20T12:00:00Z", k: 1 }),
    ];

    test("gives one row per day of the range, empty days included, split by kind", () => {
        const rows = dailyCounts(entries, "2026-09-27", TODAY, dayKey);
        expect(rows).toEqual([
            { day: "2026-09-27", learn: 1, review: 2, relearn: 0, cram: 0, total: 3, timeMs: 6000 },
            { day: "2026-09-28", learn: 0, review: 0, relearn: 0, cram: 0, total: 0, timeMs: 0 },
            { day: "2026-09-29", learn: 0, review: 0, relearn: 1, cram: 1, total: 2, timeMs: 9000 },
        ]);
    });

    test("empty input still gives the empty days", () => {
        const rows = dailyCounts([], "2026-09-28", TODAY, dayKey);
        expect(rows.map((row) => row.total)).toEqual([0, 0]);
    });
});

describe("bucketDailyCounts", () => {
    const rows = dailyCounts(
        [
            entry({ at: "2026-09-26T10:00:00Z", k: 0, ms: 1000 }),
            entry({ at: "2026-09-27T10:00:00Z", k: 1, ms: 2000 }),
            entry({ at: "2026-10-03T10:00:00Z", k: 1, ms: 3000 }),
            entry({ at: "2026-10-05T10:00:00Z", k: 2, ms: 4000 }),
        ],
        "2026-09-26",
        "2026-10-05",
        dayKey,
    );

    test("day keeps the rows", () => {
        expect(bucketDailyCounts(rows, "day", 0)).toBe(rows);
    });

    test("week groups by the first day of the week", () => {
        const weeks = bucketDailyCounts(rows, "week", 0);
        expect(weeks.map((row) => [row.day, row.total])).toEqual([
            ["2026-09-20", 1],
            ["2026-09-27", 2],
            ["2026-10-04", 1],
        ]);
        expect(weeks[1]).toMatchObject({ review: 2, timeMs: 5000 });
    });

    test("weeks can start on Monday", () => {
        const weeks = bucketDailyCounts(rows, "week", 1);
        expect(weeks.map((row) => [row.day, row.total])).toEqual([
            // Sunday 09-27 closes the week that started on Monday 09-21
            ["2026-09-21", 2],
            ["2026-09-28", 1],
            ["2026-10-05", 1],
        ]);
    });

    test("month groups by calendar month", () => {
        const months = bucketDailyCounts(rows, "month", 0);
        expect(months.map((row) => [row.day, row.total])).toEqual([
            ["2026-09-01", 2],
            ["2026-10-01", 2],
        ]);
    });
});

describe("heatmap", () => {
    // Today, Tuesday 2026-09-29, in a three week grid that starts on Sunday: 09-13 to 10-03 (future days omitted)
    const counts: Record<string, number> = {
        "2026-09-14": 2,
        "2026-09-20": 4,
        "2026-09-27": 6,
        "2026-09-28": 8,
        "2026-09-29": 10,
        "2026-01-01": 100,
    };
    const entries = Object.entries(counts).flatMap(([key, count]) =>
        Array.from({ length: count }, (_, i) =>
            entry({ at: `${key}T10:${String(i).padStart(2, "0")}:00Z` }),
        ),
    );

    test("lays days out in week columns and weekday rows, without future days", () => {
        const map = heatmap(entries, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.cells).toHaveLength(17);
        expect(map.cells[0]).toMatchObject({ day: "2026-09-13", week: 0, row: 0, count: 0 });
        expect(map.cells[16]).toMatchObject({ day: "2026-09-29", week: 2, row: 2, count: 10 });
    });

    test("quantile thresholds give five levels, from empty to strongest", () => {
        const map = heatmap(entries, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.thresholds).toEqual([4, 6, 8]);
        const level = (day: string) => map.cells.find((cell) => cell.day === day)?.level;
        expect(level("2026-09-13")).toEqual(0);
        expect(level("2026-09-14")).toEqual(1);
        expect(level("2026-09-20")).toEqual(2);
        expect(level("2026-09-27")).toEqual(3);
        expect(level("2026-09-28")).toEqual(4);
        expect(level("2026-09-29")).toEqual(4);
    });

    test("totals ignore days before the grid", () => {
        const map = heatmap(entries, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.total).toEqual(30);
        expect(map.maxCount).toEqual(10);
        expect(map.activeDays).toEqual(5);
    });

    test("the first weekday can be Monday", () => {
        const map = heatmap(entries, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 1 });
        // Weeks run Monday to Sunday, so the grid starts on 09-14 and today is in row 1
        expect(map.cells[0]).toMatchObject({ day: "2026-09-14", week: 0, row: 0, count: 2 });
        expect(map.cells[map.cells.length - 1]).toMatchObject({
            day: "2026-09-29",
            week: 2,
            row: 1,
        });
    });

    test("labels the column that holds the first day of a month", () => {
        // 2026-10-15 is a Thursday; the grid runs 09-20 to 10-15 and 10-01 falls in the second column
        const map = heatmap([], {
            todayKey: "2026-10-15",
            dayKeyOf: dayKey,
            weeks: 4,
            weekStart: 0,
        });
        expect(map.monthLabels).toEqual([{ week: 1, month: 9 }]);
    });

    test("labels the first column when no month starts near it", () => {
        // The grid ends today, so a first of the month in the future is not drawn or labelled
        const map = heatmap(entries, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.monthLabels).toEqual([{ week: 0, month: 8 }]);
    });

    test("a single active day is drawn at the strongest level", () => {
        const single = [entry({ at: "2026-09-29T10:00:00Z" })];
        const map = heatmap(single, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.cells[map.cells.length - 1].level).toEqual(4);
    });

    test("no history gives an all empty grid", () => {
        const map = heatmap([], { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.total).toEqual(0);
        expect(map.thresholds).toEqual([0, 0, 0]);
        expect(map.cells.every((cell) => cell.level === 0)).toBe(true);
    });

    test("manual resets are not counted", () => {
        const manual = [entry({ at: "2026-09-29T10:00:00Z", r: 0, k: 4 })];
        const map = heatmap(manual, { todayKey: TODAY, dayKeyOf: dayKey, weeks: 3, weekStart: 0 });
        expect(map.total).toEqual(0);
    });

    test("the default grid is 53 weeks", () => {
        const map = heatmap([], { todayKey: TODAY, dayKeyOf: dayKey });
        expect(Math.max(...map.cells.map((cell) => cell.week))).toEqual(52);
    });
});

describe("hourly", () => {
    const entries = [
        entry({ at: "2026-09-29T09:10:00Z", r: 3 }),
        entry({ at: "2026-09-29T09:20:00Z", r: 4 }),
        entry({ at: "2026-09-28T09:30:00Z", r: 1 }),
        entry({ at: "2026-09-29T14:00:00Z", r: 2 }),
        entry({ at: "2026-09-29T14:30:00Z", r: 0, k: 4 }),
    ];

    test("counts reviews and passes for each hour of the day", () => {
        const hours = hourly(entries);
        expect(hours).toHaveLength(24);
        expect(hours[9]).toEqual({ hour: 9, reviews: 3, passed: 2, successRate: 2 / 3 });
        expect(hours[14]).toEqual({ hour: 14, reviews: 1, passed: 1, successRate: 1 });
        expect(hours[3]).toEqual({ hour: 3, reviews: 0, passed: 0, successRate: null });
    });

    test("empty input gives 24 empty hours", () => {
        expect(hourly([]).every((hour) => hour.reviews === 0)).toBe(true);
    });
});
