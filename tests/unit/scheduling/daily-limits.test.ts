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
        expect(countToday(entries, DAY_START)).toMatchObject({ newDone: 1, reviewsDone: 1 });
    });

    test("a card answered as a review twice today counts once (D2 #4)", () => {
        const entries = [
            entry({ t: DAY_START + 9, c: "x", r: 1, k: 1 }),
            entry({ t: DAY_START + 5, c: "x", r: 1, k: 1 }), // the logs of two devices need not be in order
            entry({ t: DAY_START + 7, c: "y", k: 1 }),
        ];
        const counts = countToday(entries, DAY_START);
        expect(counts).toMatchObject({ newDone: 0, reviewsDone: 2 });
        expect([...counts.reviewed]).toEqual([
            ["x", DAY_START + 5],
            ["y", DAY_START + 7],
        ]);
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

    test("a card already counted as a review today does not spend the allowance again (D2 #4)", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: true, newCardsPerDay: 0, reviewsPerDay: 2 },
            { newDone: 0, reviewsDone: 0 },
        );
        const first = entry({ t: DAY_START + 1, c: "x", r: 1 });
        const again = entry({ t: DAY_START + 2, c: "x", r: 1 });
        expect(limits.countedToday("x")).toBe(false);
        limits.record(first);
        limits.record(again);
        expect(limits.remainingReviews()).toBe(1);
        expect(limits.countedToday("x")).toBe(true);

        // Undoing the repeat gives nothing back; undoing the first answer does
        limits.unrecord(again);
        expect(limits.remainingReviews()).toBe(1);
        limits.unrecord(first);
        expect(limits.remainingReviews()).toBe(2);
        expect(limits.countedToday("x")).toBe(false);
    });

    test("cards counted earlier today, from the log, are known", () => {
        const counted = entry({ t: DAY_START + 1, c: "x" });
        const limits = new DailyLimits(
            { dailyLimitsEnabled: true, newCardsPerDay: 0, reviewsPerDay: 2 },
            countToday([counted], DAY_START),
        );
        expect(limits.remainingReviews()).toBe(1);
        limits.record(entry({ t: DAY_START + 2, c: "x" }));
        expect(limits.remainingReviews()).toBe(1);
        // An answer from an earlier session is undone by its time
        limits.unrecord(counted);
        expect(limits.remainingReviews()).toBe(2);
    });

    test("answers without a card id are each counted", () => {
        const limits = new DailyLimits(
            { dailyLimitsEnabled: true, newCardsPerDay: 0, reviewsPerDay: 3 },
            { newDone: 0, reviewsDone: 0 },
        );
        const one = entry({ c: "" });
        limits.record(one);
        limits.record(entry({ c: "" }));
        expect(limits.remainingReviews()).toBe(1);
        expect(limits.countedToday(null)).toBe(false);
        limits.unrecord(one);
        expect(limits.remainingReviews()).toBe(2);
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
