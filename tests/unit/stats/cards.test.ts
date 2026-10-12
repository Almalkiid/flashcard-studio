import { default_w as DEFAULT_WEIGHTS } from "ts-fsrs";

import {
    binLabel,
    cardCounts,
    difficultyHistogram,
    forecast,
    histogram,
    intervalHistogram,
    retrievability,
    retrievabilityHistogram,
    stabilityHistogram,
} from "src/stats/cards";
import { makeDayKeyFn } from "src/stats/day-keys";

import { DAY_MS, statsCard } from "./fixtures";

const dayKey = makeDayKeyFn(0);
const TODAY = "2026-09-29";
const NOW = new Date("2026-09-29T12:00:00Z").getTime();
const due = (iso: string) => new Date(iso).getTime();

describe("cardCounts", () => {
    test("puts every card in exactly one bucket", () => {
        const cards = [
            statsCard({ state: "new", intervalDays: 0 }),
            statsCard({ state: "new", intervalDays: 0 }),
            statsCard({ state: "learning", intervalDays: 0 }),
            statsCard({ state: "relearning", intervalDays: 0 }),
            statsCard({ state: "review", intervalDays: 20.9 }),
            statsCard({ state: "review", intervalDays: 21 }),
            statsCard({ state: "review", intervalDays: 400 }),
            statsCard({ state: "review", suspended: true }),
            statsCard({ state: "new", suspended: true }),
            statsCard({ state: "review", buried: true }),
            statsCard({ state: "review", suspended: true, buried: true }),
        ];
        expect(cardCounts(cards)).toEqual({
            new: 2,
            learning: 1,
            relearning: 1,
            young: 1,
            mature: 2,
            suspended: 3,
            buried: 1,
            total: 11,
        });
    });

    test("empty input gives zeros", () => {
        expect(cardCounts([]).total).toEqual(0);
    });
});

describe("forecast", () => {
    const cards = [
        statsCard({ dueMs: due("2026-09-27T09:00:00Z") }),
        statsCard({ dueMs: due("2026-09-29T09:00:00Z") }),
        statsCard({ state: "learning", intervalDays: 0, dueMs: due("2026-09-29T15:00:00Z") }),
        statsCard({ state: "relearning", intervalDays: 0, dueMs: due("2026-09-28T09:00:00Z") }),
        statsCard({ dueMs: due("2026-09-30T00:00:00Z") }),
        statsCard({ dueMs: due("2026-10-03T23:59:59Z") }),
        statsCard({ dueMs: due("2026-10-04T00:00:00Z") }),
        statsCard({ dueMs: due("2026-09-30T09:00:00Z"), suspended: true }),
        statsCard({ state: "new", intervalDays: 0, dueMs: null }),
        statsCard({ dueMs: due("2026-09-30T09:00:00Z"), buried: true }),
    ];

    test("counts due cards per day, overdue review cards apart and learning cards today", () => {
        const result = forecast(cards, { todayKey: TODAY, dayKeyOf: dayKey, days: 5 });
        expect(result.overdue).toEqual(1);
        expect(result.days).toEqual([3, 2, 0, 0, 1]);
        expect(result.beyond).toEqual(1);
        // 1 overdue + 6 in the next five days + 1 later; the suspended and the new card are not counted
        expect(result.total).toEqual(8);
    });

    test("leaves out suspended and new cards, keeps buried ones", () => {
        const result = forecast(cards, { todayKey: TODAY, dayKeyOf: dayKey, days: 5 });
        // Day 1 holds the review card due at midnight and the buried card; the suspended card is not counted
        expect(result.days[1]).toEqual(2);
    });

    test("the day boundary moves a card due after midnight into the previous day", () => {
        const fourAm = makeDayKeyFn(4 * 3600 * 1000);
        const result = forecast([statsCard({ dueMs: due("2026-09-30T02:00:00Z") })], {
            todayKey: TODAY,
            dayKeyOf: fourAm,
            days: 3,
        });
        expect(result.days).toEqual([1, 0, 0]);
    });

    test("empty input gives empty days", () => {
        expect(forecast([], { todayKey: TODAY, dayKeyOf: dayKey, days: 3 })).toEqual({
            overdue: 0,
            days: [0, 0, 0],
            beyond: 0,
            total: 0,
        });
    });
});

describe("histogram", () => {
    test("counts values into half-open bins and the last bin stays open", () => {
        const result = histogram([1, 1.9, 2, 3, 99], [1, 2, 3], true);
        expect(result.bins).toEqual([
            { from: 1, to: 2, count: 2 },
            { from: 2, to: 3, count: 1 },
            { from: 3, to: null, count: 2 },
        ]);
        expect(result.total).toEqual(5);
    });

    test("a closed histogram puts the top value in the last bin", () => {
        const result = histogram([0, 50, 100], [0, 50, 100], false);
        expect(result.bins.map((bin) => bin.count)).toEqual([1, 2]);
    });

    test("values below the first edge go to the first bin", () => {
        expect(histogram([-5], [0, 10], true).bins[0].count).toEqual(1);
    });

    test("mean, median and max come from the raw values", () => {
        const result = histogram([1, 2, 3, 10], [0, 5], true);
        expect(result.mean).toEqual(4);
        expect(result.median).toEqual(2.5);
        expect(result.max).toEqual(10);
        expect(histogram([1, 2, 9], [0, 5], true).median).toEqual(2);
    });

    test("empty input has no statistics", () => {
        const result = histogram([], [0, 5], true);
        expect(result).toMatchObject({ total: 0, mean: null, median: null, max: null });
    });
});

describe("binLabel", () => {
    test("labels whole day bins", () => {
        expect(binLabel({ from: 3, to: 4, count: 0 }, "int")).toEqual("3");
        expect(binLabel({ from: 7, to: 10, count: 0 }, "int")).toEqual("7-9");
        expect(binLabel({ from: 730, to: null, count: 0 }, "int")).toEqual("730+");
    });

    test("labels percent bins by their lower edge", () => {
        expect(binLabel({ from: 95, to: 100, count: 0 }, "percent")).toEqual("95%");
    });
});

describe("intervalHistogram", () => {
    test("uses review cards only and leaves out suspended cards", () => {
        const result = intervalHistogram([
            statsCard({ intervalDays: 1 }),
            statsCard({ intervalDays: 8 }),
            statsCard({ intervalDays: 21 }),
            statsCard({ intervalDays: 800 }),
            statsCard({ state: "new", intervalDays: 0 }),
            statsCard({ state: "learning", intervalDays: 0.01 }),
            statsCard({ intervalDays: 50, suspended: true }),
        ]);
        expect(result.total).toEqual(4);
        expect(result.bins.find((bin) => bin.from === 1).count).toEqual(1);
        expect(result.bins.find((bin) => bin.from === 7).count).toEqual(1);
        expect(result.bins.find((bin) => bin.from === 21).count).toEqual(1);
        expect(result.bins[result.bins.length - 1]).toMatchObject({ from: 730, count: 1 });
        expect(result.max).toEqual(800);
    });
});

describe("stabilityHistogram and difficultyHistogram", () => {
    const cards = [
        statsCard({ stability: 0.5, difficulty: 1.2 }),
        statsCard({ stability: 6, difficulty: 5.5 }),
        statsCard({ stability: 6.9, difficulty: 5.9 }),
        statsCard({ stability: 400, difficulty: 10 }),
        statsCard({ state: "new", stability: 0, difficulty: 0, intervalDays: 0 }),
        statsCard({ suspended: true, stability: 50, difficulty: 3 }),
        statsCard({ isFsrs: false, stability: 0, difficulty: 0 }),
        statsCard({ isFsrs: false, stability: 0, difficulty: 0 }),
    ];

    test("stability counts FSRS cards and reports how many SM-2 cards were left out", () => {
        const result = stabilityHistogram(cards);
        expect(result.histogram.total).toEqual(4);
        expect(result.excluded).toEqual(2);
        expect(result.histogram.bins.find((bin) => bin.from === 5).count).toEqual(2);
        expect(result.histogram.bins.find((bin) => bin.from === 0).count).toEqual(1);
    });

    test("difficulty has one bin per whole number from 1 to 10", () => {
        const result = difficultyHistogram(cards);
        expect(result.histogram.bins).toHaveLength(10);
        const counts = result.histogram.bins.map((bin) => bin.count);
        expect(counts).toEqual([1, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
        expect(result.histogram.mean).toBeCloseTo((1.2 + 5.5 + 5.9 + 10) / 4, 10);
    });
});

describe("retrievability", () => {
    const weights = DEFAULT_WEIGHTS;

    test("is 100% right after a review and 90% after one stability", () => {
        const card = statsCard({ stability: 20, lastReviewMs: NOW });
        expect(retrievability(card, NOW, weights)).toBeCloseTo(1, 10);
        expect(retrievability(card, NOW + 20 * DAY_MS, weights)).toBeCloseTo(0.9, 6);
    });

    test("falls as time passes", () => {
        const card = statsCard({ stability: 5, lastReviewMs: NOW - 10 * DAY_MS });
        const later = retrievability(card, NOW + 10 * DAY_MS, weights);
        expect(retrievability(card, NOW, weights)).toBeGreaterThan(later);
        expect(later).toBeGreaterThan(0);
    });

    test("is null without FSRS state or without a last review", () => {
        expect(retrievability(statsCard({ isFsrs: false }), NOW, weights)).toBeNull();
        expect(retrievability(statsCard({ lastReviewMs: null }), NOW, weights)).toBeNull();
        expect(
            retrievability(statsCard({ stability: 0, lastReviewMs: NOW }), NOW, weights),
        ).toBeNull();
        expect(
            retrievability(statsCard({ state: "new", lastReviewMs: NOW }), NOW, weights),
        ).toBeNull();
    });

    test("a review time in the future does not give more than 100%", () => {
        const card = statsCard({ stability: 5, lastReviewMs: NOW + DAY_MS });
        expect(retrievability(card, NOW, weights)).toBeCloseTo(1, 10);
    });
});

describe("retrievabilityHistogram", () => {
    test("bins the retrievability of FSRS cards by 5 percent and sums the expected knowledge", () => {
        const fresh = statsCard({ stability: 20, lastReviewMs: NOW });
        const forgotten = statsCard({ stability: 1, lastReviewMs: NOW - 3000 * DAY_MS });
        const result = retrievabilityHistogram(
            [
                fresh,
                forgotten,
                statsCard({ state: "new", intervalDays: 0 }),
                statsCard({ isFsrs: false }),
                statsCard({ lastReviewMs: null }),
            ],
            NOW,
            DEFAULT_WEIGHTS,
        );
        const forgottenR = retrievability(forgotten, NOW, DEFAULT_WEIGHTS);
        expect(forgottenR).toBeLessThan(0.5);
        expect(result.histogram.total).toEqual(2);
        expect(result.histogram.bins).toHaveLength(20);
        expect(result.histogram.bins[19].count).toEqual(1);
        expect(result.histogram.bins[Math.floor((forgottenR * 100) / 5)].count).toEqual(1);
        expect(result.excluded).toEqual(2);
        expect(result.expectedKnown).toBeCloseTo(1 + forgottenR, 10);
    });

    test("empty input has nothing to show", () => {
        const result = retrievabilityHistogram([], NOW, DEFAULT_WEIGHTS);
        expect(result.histogram.total).toEqual(0);
        expect(result.expectedKnown).toEqual(0);
    });
});
