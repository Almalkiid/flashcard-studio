import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { countToday, DailyLimits, monthsCovering } from "src/scheduling/daily-limits";

const base = { c: "a", ivl: 1, li: 0, ms: 1, dk: "", f: "" };
const DAY_START = new Date(2026, 9, 1, 4).getTime(); // the day starts at 04:00 on 1 October

function entry(overrides: Partial<ReviewLogEntry>): ReviewLogEntry {
    return { ...base, t: DAY_START, r: 3, k: 1, ...overrides };
}

describe("countToday", () => {
    test("counts new cards and reviews since the start of the day", () => {
        const entries = [
            entry({ t: DAY_START - 1, k: 0, n: 1 }), // yesterday
            entry({ t: DAY_START + 1, k: 0, n: 1 }), // new today
            entry({ t: DAY_START + 2, r: 1, k: 0 }), // a learning step, not a new card
            entry({ t: DAY_START + 3, k: 1 }), // review
            entry({ t: DAY_START + 4, r: 0, k: 4 }), // manual reset, ignored
            entry({ t: DAY_START + 5, k: 3 }), // cram, ignored
            entry({ t: DAY_START + 6, k: 2 }), // relearning step, not counted as a review
        ];
        expect(countToday(entries, DAY_START)).toEqual({ newDone: 1, reviewsDone: 1 });
    });
});

describe("monthsCovering", () => {
    test("a day that starts in the previous month covers both months", () => {
        expect(
            monthsCovering(new Date(2026, 8, 30, 4).getTime(), new Date(2026, 9, 1, 2).getTime()),
        ).toEqual(["2026-09", "2026-10"]);
    });

    test("a day within one month covers one month", () => {
        expect(monthsCovering(DAY_START, DAY_START + 3600e3)).toEqual(["2026-10"]);
    });
});

describe("DailyLimits", () => {
    test("remaining allowance goes down with record and back up with unrecord", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: true, newCardsPerDay: 2, reviewsPerDay: 1 },
            { newDone: 1, reviewsDone: 0 },
        );
        expect(limits.remainingNew()).toBe(1);
        expect(limits.remainingReviews()).toBe(1);

        const newAnswer = entry({ k: 0, n: 1 });
        const review = entry({ k: 1 });
        limits.record(newAnswer);
        limits.record(review);
        expect(limits.remainingNew()).toBe(0);
        expect(limits.remainingReviews()).toBe(0);

        limits.unrecord(newAnswer);
        limits.unrecord(review);
        expect(limits.remainingNew()).toBe(1);
        expect(limits.remainingReviews()).toBe(1);
    });

    test("remaining allowance never goes below zero", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: true, newCardsPerDay: 1, reviewsPerDay: 1 },
            { newDone: 5, reviewsDone: 5 },
        );
        expect(limits.remainingNew()).toBe(0);
        expect(limits.remainingReviews()).toBe(0);
    });

    test("disabled limits are unlimited", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: false, newCardsPerDay: 0, reviewsPerDay: 0 },
            { newDone: 5, reviewsDone: 5 },
        );
        expect(limits.remainingNew()).toBe(Infinity);
        expect(limits.remainingReviews()).toBe(Infinity);
    });
});
