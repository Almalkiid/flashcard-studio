import { default_w as defaultWeights } from "ts-fsrs";

import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { evaluateParameters } from "src/scheduling/optimizer/evaluate";
import { MIN_REVIEWS_TO_OPTIMIZE, optimizeParameters } from "src/scheduling/optimizer/optimize";
import {
    CardIdNumbers,
    formatRevlogCsv,
    REVLOG_CSV_HEADER,
    revlogCsvFileName,
} from "src/scheduling/optimizer/revlog-csv";
import {
    buildCardHistories,
    buildTrainingSet,
    countTrainingReviews,
    dayNumber,
} from "src/scheduling/optimizer/training-set";

import { FAR_FROM_DEFAULT_WEIGHTS, generateReviewLog } from "../../optimizer/synthetic";

const HOUR = 3600e3;
const DAY = 24 * HOUR;
// 2026-10-01 00:00 UTC; the unit tests run in UTC
const D0 = Date.UTC(2026, 9, 1);

function entry(overrides: Partial<ReviewLogEntry> & { t: number }): ReviewLogEntry {
    return {
        c: "aaaaaa",
        r: 3,
        k: 1,
        ivl: 1,
        li: 1,
        ms: 1000,
        dk: "CIA/Part1",
        f: "n.md",
        ...overrides,
    };
}

describe("dayNumber", () => {
    test("counts calendar days, across month ends", () => {
        expect(
            dayNumber(Date.UTC(2026, 9, 2, 12), 0) - dayNumber(Date.UTC(2026, 8, 30, 23), 0),
        ).toBe(2);
    });

    test("the day starts at the configured time", () => {
        // 03:00 still belongs to the previous day when the day starts at 04:00
        expect(dayNumber(D0 + 3 * HOUR, 4 * HOUR)).toBe(dayNumber(D0 - HOUR, 0));
        expect(dayNumber(D0 + 5 * HOUR, 4 * HOUR)).toBe(dayNumber(D0, 0));
    });
});

describe("buildCardHistories", () => {
    test("groups by card, orders by time and merges devices", () => {
        const entries = [
            entry({ t: D0 + 3 * DAY, c: "bbbbbb", r: 2 }),
            entry({ t: D0 + 2 * DAY, c: "aaaaaa", r: 1 }),
            entry({ t: D0, c: "aaaaaa", r: 3, k: 0 }),
            entry({ t: D0 + DAY, c: "bbbbbb", r: 3, k: 0 }),
        ];
        const histories = buildCardHistories(entries, { dayStartOffsetMs: 0 });
        expect(histories.map((history) => history.cardId)).toEqual(["aaaaaa", "bbbbbb"]);
        expect(histories[0].reviews.map((review) => [review.rating, review.deltaT])).toEqual([
            [3, 0],
            [1, 2],
        ]);
        expect(histories[1].reviews.map((review) => [review.rating, review.deltaT])).toEqual([
            [3, 0],
            [2, 2],
        ]);
    });

    test("keeps only the first answer of each day", () => {
        const entries = [
            entry({ t: D0 + 9 * HOUR, r: 1, k: 0 }),
            entry({ t: D0 + 9 * HOUR + 60e3, r: 3, k: 0 }),
            entry({ t: D0 + 20 * HOUR, r: 4, k: 0 }),
            entry({ t: D0 + 3 * DAY + 8 * HOUR, r: 3, k: 1 }),
            entry({ t: D0 + 3 * DAY + 9 * HOUR, r: 1, k: 1 }),
        ];
        const [history] = buildCardHistories(entries, { dayStartOffsetMs: 0 });
        expect(history.reviews.map((review) => [review.rating, review.deltaT])).toEqual([
            [1, 0],
            [3, 3],
        ]);
    });

    test("a day that starts at 04:00 splits answers at that time", () => {
        const entries = [
            entry({ t: D0 + 3 * HOUR, r: 3, k: 0 }),
            entry({ t: D0 + 5 * HOUR, r: 3, k: 1 }),
        ];
        expect(buildCardHistories(entries, { dayStartOffsetMs: 0 })[0].reviews).toHaveLength(1);
        expect(buildCardHistories(entries, { dayStartOffsetMs: 4 * HOUR })[0].reviews).toHaveLength(
            2,
        );
    });

    test("ignores manual entries and cram answers", () => {
        const entries = [
            entry({ t: D0, r: 3, k: 0 }),
            entry({ t: D0 + DAY, r: 2, k: 3 }),
            entry({ t: D0 + 2 * DAY, r: 0, k: 4, s: 12 }),
            entry({ t: D0 + 3 * DAY, r: 4, k: 1 }),
        ];
        const [history] = buildCardHistories(entries, { dayStartOffsetMs: 0 });
        expect(history.reviews.map((review) => [review.rating, review.deltaT])).toEqual([
            [3, 0],
            [4, 3],
        ]);
    });

    test("a reset drops everything before it, a changed due date does not", () => {
        const base = [
            entry({ t: D0, r: 3, k: 0 }),
            entry({ t: D0 + 2 * DAY, r: 3, k: 1 }),
            entry({ t: D0 + 3 * DAY, r: 0, k: 4, s: 0, d: 0 }),
            entry({ t: D0 + 10 * DAY, r: 2, k: 0 }),
            entry({ t: D0 + 12 * DAY, r: 3, k: 1 }),
        ];
        const [reset] = buildCardHistories(base, { dayStartOffsetMs: 0 });
        expect(reset.reviews.map((review) => [review.rating, review.deltaT])).toEqual([
            [2, 0],
            [3, 2],
        ]);

        const moved = base.map((e) => (e.r === 0 ? { ...e, s: 15 } : e));
        const [kept] = buildCardHistories(moved, { dayStartOffsetMs: 0 });
        expect(kept.reviews).toHaveLength(4);
    });

    test("a deck filter takes the deck and its subdecks, and judges a card by its latest answer", () => {
        const entries = [
            entry({ t: D0, c: "aaaaaa", dk: "CIA/Part1/Risk" }),
            entry({ t: D0, c: "bbbbbb", dk: "CIA/Part2" }),
            entry({ t: D0, c: "cccccc", dk: "CIAX" }),
            entry({ t: D0, c: "dddddd", dk: "Other" }),
            entry({ t: D0 + DAY, c: "dddddd", dk: "CIA/Part1" }),
        ];
        const ids = (deck: string) =>
            buildCardHistories(entries, { dayStartOffsetMs: 0, deck }).map((h) => h.cardId);
        expect(ids("CIA/Part1")).toEqual(["aaaaaa", "dddddd"]);
        expect(ids("#CIA")).toEqual(["aaaaaa", "bbbbbb", "dddddd"]);
        expect(ids("")).toHaveLength(4);
    });

    test("skips answers without a card id", () => {
        expect(buildCardHistories([entry({ t: D0, c: "" })], { dayStartOffsetMs: 0 })).toEqual([]);
    });
});

describe("buildTrainingSet", () => {
    const entries = [
        entry({ t: D0, c: "aaaaaa", r: 3, k: 0 }),
        entry({ t: D0 + 2 * DAY, c: "aaaaaa", r: 3, k: 1 }),
        entry({ t: D0 + 6 * DAY, c: "aaaaaa", r: 1, k: 1 }),
        entry({ t: D0 + DAY, c: "bbbbbb", r: 4, k: 0 }),
        entry({ t: D0 + 4 * DAY, c: "bbbbbb", r: 3, k: 1 }),
        entry({ t: D0 + 9 * DAY, c: "cccccc", r: 3, k: 0 }),
    ];
    const histories = buildCardHistories(entries, { dayStartOffsetMs: 0 });

    test("counts the reviews after each card's first", () => {
        expect(countTrainingReviews(histories)).toBe(3);
    });

    test("each item is a prefix of a card's history that reaches a later day", () => {
        const { trainSet } = buildTrainingSet(histories);
        expect(trainSet).toHaveLength(3);
        for (const item of trainSet) {
            expect(item.reviews[0].deltaT).toBe(0);
            expect(item.reviews.slice(1).every((review) => review.deltaT > 0)).toBe(true);
            expect(item.reviews.every((review) => review.rating >= 1 && review.rating <= 4)).toBe(
                true,
            );
        }
        const lengths = trainSet.map((item) => item.reviews.length).sort();
        expect(lengths).toEqual([2, 2, 3]);
    });

    test("items are ordered by the time of the review they predict, with card ids in step", () => {
        const { trainSet, cardIds } = buildTrainingSet(histories);
        // Card a is index 0, card b index 1: b@D+4 is after a@D+2 and before a@D+6
        expect(cardIds).toEqual([0, 1, 0]);
        expect(trainSet.map((item) => item.reviews.length)).toEqual([2, 2, 3]);
        expect(trainSet[0].reviews[1].rating).toBe(3);
        expect(trainSet[2].reviews[2].rating).toBe(1);
    });
});

describe("evaluateParameters", () => {
    const log = generateReviewLog({
        cards: 120,
        days: 200,
        trueWeights: FAR_FROM_DEFAULT_WEIGHTS,
        seed: 7,
    });
    const histories = buildCardHistories(log, { dayStartOffsetMs: 0 });

    test("scores every review after a card's first", () => {
        const metrics = evaluateParameters(histories, defaultWeights);
        expect(metrics.count).toBe(countTrainingReviews(histories));
        expect(Number.isFinite(metrics.logLoss)).toBe(true);
        expect(metrics.logLoss).toBeGreaterThan(0);
        expect(metrics.rmse).toBeGreaterThanOrEqual(0);
    });

    test("the weights the learner really has fit better than the defaults", () => {
        const truth = evaluateParameters(histories, FAR_FROM_DEFAULT_WEIGHTS);
        const defaults = evaluateParameters(histories, defaultWeights);
        expect(truth.logLoss).toBeLessThan(defaults.logLoss);
        expect(truth.rmse).toBeLessThan(defaults.rmse);
    });

    test("no reviews score nothing", () => {
        expect(evaluateParameters([], defaultWeights)).toEqual({ logLoss: 0, rmse: 0, count: 0 });
    });
});

describe("optimizeParameters", () => {
    test("refuses fewer reviews than the minimum", () => {
        const few = buildCardHistories([entry({ t: D0 }), entry({ t: D0 + 2 * DAY })], {
            dayStartOffsetMs: 0,
        });
        expect(MIN_REVIEWS_TO_OPTIMIZE).toBe(400);
        expect(() => optimizeParameters(few, defaultWeights, 1)).toThrow(
            /fewer than the 400 needed/,
        );
    });

    test("fits a learner who is far from the defaults better than the defaults do", () => {
        const log = generateReviewLog({
            cards: 250,
            days: 220,
            trueWeights: FAR_FROM_DEFAULT_WEIGHTS,
            seed: 11,
        });
        const histories = buildCardHistories(log, { dayStartOffsetMs: 0 });
        expect(countTrainingReviews(histories)).toBeGreaterThan(MIN_REVIEWS_TO_OPTIMIZE);

        const result = optimizeParameters(histories, defaultWeights, 1);
        expect(result.weights).toHaveLength(21);
        expect(result.reviewsUsed).toBe(countTrainingReviews(histories));
        expect(result.cardCount).toBeGreaterThan(0);
        expect(result.optimized.logLoss).toBeLessThan(result.current.logLoss);
        expect(result.optimized.count).toBe(result.current.count);
    });
});

describe("review log CSV", () => {
    test("has the optimizer's columns, oldest first, with numeric card ids", () => {
        const csv = formatRevlogCsv([
            entry({ t: 2000, c: "000010", r: 4, k: 1, ms: 700 }),
            entry({ t: 1000, c: "000001", r: 1, k: 0, ms: 5000 }),
            entry({ t: 1500, c: "", r: 3, k: 1 }),
            entry({ t: 3000, c: "000001", r: 0, k: 4, ms: 0 }),
        ]);
        expect(csv).toBe(
            [REVLOG_CSV_HEADER, "1,1000,1,0,5000", "36,2000,4,1,700", "1,3000,0,4,0", ""].join(
                "\n",
            ),
        );
        expect(REVLOG_CSV_HEADER).toBe(
            "card_id,review_time,review_rating,review_state,review_duration",
        );
    });

    test("an id converts to the same number every time, and long ids stay apart", () => {
        const ids = new CardIdNumbers();
        expect(ids.numberFor("k3f9a2")).toBe(parseInt("k3f9a2", 36));
        expect(ids.numberFor("k3f9a2")).toBe(ids.numberFor("k3f9a2"));
        const long1 = ids.numberFor("abcdefghijklmn");
        const long2 = ids.numberFor("zzzzzzzzzzzzzz");
        expect(long1).not.toBe(long2);
        expect(long1).toBeGreaterThan(36 ** 10 - 1);
        expect(ids.numberFor("abcdefghijklmn")).toBe(long1);
    });

    test("names the file after the day", () => {
        expect(revlogCsvFileName("2026-09-29")).toBe("cardwright-revlog-2026-09-29.csv");
    });
});
