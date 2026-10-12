import { default_w as defaultWeights, fsrs, generatorParameters, migrateParameters } from "ts-fsrs";

import {
    cardsText,
    estimateDailyReviews,
    MIN_CARDS_FOR_WORKLOAD,
    workloadText,
} from "src/settings/workload";

const cards = (count: number, stability: number) => Array.from({ length: count }, () => stability);

/** What ts-fsrs itself schedules: every card comes back after the interval its own scheduler would give it. */
function reviewsPerDayByTsFsrs(
    stabilities: readonly number[],
    retention: number,
    maximumInterval: number,
    weights?: readonly number[],
) {
    const scheduler = fsrs(
        generatorParameters({
            ["request_retention"]: retention,
            ["maximum_interval"]: maximumInterval,
            ["enable_fuzz"]: false,
            w: weights === undefined ? undefined : [...weights],
        }),
    );
    return stabilities.reduce(
        (sum, stability) => sum + 1 / scheduler.next_interval(stability, 0),
        0,
    );
}

/** The default FSRS-6 parameters with the decay (the last one) changed from 0.1542 to 0.4. */
const STEEP_DECAY = [...defaultWeights.slice(0, 20), 0.4];

describe("estimateDailyReviews", () => {
    test("twenty cards with a stability of 10 days at 90% retention need 2 reviews a day", () => {
        expect(estimateDailyReviews(cards(20, 10), 0.9, null, 36500)).toBeCloseTo(2, 5);
    });

    test("it needs at least twenty cards", () => {
        expect(MIN_CARDS_FOR_WORKLOAD).toBe(20);
        expect(estimateDailyReviews(cards(19, 10), 0.9, null, 36500)).toBeNull();
        expect(estimateDailyReviews([], 0.9, null, 36500)).toBeNull();
        expect(estimateDailyReviews(cards(20, 10), 0.9, null, 36500)).not.toBeNull();
    });

    test("a retention that is not between 0 and 1 gives no estimate", () => {
        for (const retention of [1, 0, -0.5, 1.5, NaN]) {
            expect(estimateDailyReviews(cards(20, 10), retention, null, 36500)).toBeNull();
        }
    });

    test("a maximum interval below a day gives no estimate instead of Infinity", () => {
        expect(estimateDailyReviews(cards(20, 10), 0.9, null, 0)).toBeNull();
        expect(estimateDailyReviews(cards(20, 10), 0.9, null, NaN)).toBeNull();
    });

    test("a higher retention needs more reviews and a lower one fewer", () => {
        const at = (retention: number) =>
            estimateDailyReviews(cards(100, 30), retention, null, 36500) ?? NaN;
        expect(at(0.95)).toBeGreaterThan(at(0.9));
        expect(at(0.9)).toBeGreaterThan(at(0.8));
        expect(at(0.8)).toBeGreaterThan(at(0.7));
    });

    test("the maximum interval caps how long a card waits", () => {
        expect(estimateDailyReviews(cards(20, 10000), 0.9, null, 100)).toBeCloseTo(20 / 100, 5);
        expect(estimateDailyReviews(cards(20, 10000), 0.9, null, 36500)).toBeCloseTo(20 / 10000, 5);
    });

    test("no card comes back more than once a day", () => {
        expect(estimateDailyReviews(cards(20, 0.01), 0.9, null, 36500)).toBeCloseTo(20, 5);
    });

    test("it adds up the cards one by one", () => {
        const mixed = [...cards(10, 10), ...cards(10, 20)];
        expect(estimateDailyReviews(mixed, 0.9, null, 36500)).toBeCloseTo(10 / 10 + 10 / 20, 5);
    });

    test("it agrees with the intervals ts-fsrs schedules, for the default parameters", () => {
        const stabilities = [
            0.5, 1.2, 3, 7.5, 10, 25, 60, 200, 900, 4000, 4000, 4000, 12, 18, 33, 2, 2, 5, 9, 14,
        ];
        expect(stabilities.length).toBeGreaterThanOrEqual(MIN_CARDS_FOR_WORKLOAD);
        for (const retention of [0.7, 0.8, 0.85, 0.9, 0.95, 0.99]) {
            expect(estimateDailyReviews(stabilities, retention, null, 36500)).toBeCloseTo(
                reviewsPerDayByTsFsrs(stabilities, retention, 36500),
                5,
            );
        }
        expect(estimateDailyReviews(stabilities, 0.9, null, 365)).toBeCloseTo(
            reviewsPerDayByTsFsrs(stabilities, 0.9, 365),
            5,
        );
    });

    test("it agrees with ts-fsrs for the user's own parameters, whose decay differs", () => {
        const stabilities = cards(1500, 10);
        for (const retention of [0.75, 0.8, 0.85, 0.9]) {
            expect(estimateDailyReviews(stabilities, retention, STEEP_DECAY, 36500)).toBeCloseTo(
                reviewsPerDayByTsFsrs(stabilities, retention, 36500, STEEP_DECAY),
                5,
            );
        }
        // The decay really is used: at 80% a steeper curve means shorter intervals.
        expect(estimateDailyReviews(stabilities, 0.8, STEEP_DECAY, 36500) ?? 0).toBeGreaterThan(
            estimateDailyReviews(stabilities, 0.8, null, 36500) ?? 0,
        );
        // At 90% a stability is the interval whatever the decay.
        expect(estimateDailyReviews(cards(20, 10), 0.9, STEEP_DECAY, 36500)).toBeCloseTo(2, 5);
    });
});

describe("cardsText", () => {
    test("one card is 1 card and any other count is cards, with thousands separators", () => {
        expect(cardsText(1)).toBe("1 card");
        expect(cardsText(0)).toBe("0 cards");
        expect(cardsText(20)).toBe("20 cards");
        expect(cardsText(1500)).toBe((1500).toLocaleString() + " cards");
    });
});

describe("workloadText", () => {
    const settings = (overrides: Partial<Parameters<typeof workloadText>[1]> = {}) => ({
        fsrsDesiredRetention: 0.9,
        fsrsWeights: "",
        fsrsRelearningSteps: "10m",
        maximumInterval: 36500,
        ...overrides,
    });

    test("it says nothing while there are too few cards", () => {
        expect(workloadText(cards(19, 10), settings())).toBeNull();
        expect(workloadText([], settings())).toBeNull();
    });

    test("it says nothing for a retention that gives no estimate", () => {
        expect(workloadText(cards(20, 10), settings({ fsrsDesiredRetention: 1 }))).toBeNull();
    });

    test("it gives the reviews a day now and at 5 points either side", () => {
        expect(workloadText(cards(20, 10), settings())).toBe(
            "About 2 reviews a day for your 20 cards. At 85%: about 1. At 95%: about 5.",
        );
    });

    test("it writes the number of cards with thousands separators", () => {
        expect(workloadText(cards(1500, 10), settings())).toBe(
            "About 150 reviews a day for your " +
                (1500).toLocaleString() +
                " cards. At 85%: about 79. At 95%: about 375.",
        );
    });

    test("near the top it shows 99% as the higher side, never a retention above it", () => {
        expect(workloadText(cards(20, 10), settings({ fsrsDesiredRetention: 0.97 }))).toBe(
            "About 10 reviews a day for your 20 cards. At 92%: about 3. At 99%: about 20.",
        );
    });

    test("at 99% there is no higher side to show", () => {
        expect(workloadText(cards(20, 10), settings({ fsrsDesiredRetention: 0.99 }))).toBe(
            "About 20 reviews a day for your 20 cards. At 94%: about 4.",
        );
    });

    test("near the bottom it shows 70% as the lower side, and at 70% there is none", () => {
        expect(workloadText(cards(1500, 10), settings({ fsrsDesiredRetention: 0.75 }))).toBe(
            "About 27 reviews a day for your " +
                (1500).toLocaleString() +
                " cards. At 70%: about 16. At 80%: about 45.",
        );
        expect(workloadText(cards(1500, 10), settings({ fsrsDesiredRetention: 0.7 }))).toBe(
            "About 16 reviews a day for your " +
                (1500).toLocaleString() +
                " cards. At 75%: about 27.",
        );
    });

    test("a stored retention below the range only offers the side that is higher", () => {
        expect(workloadText(cards(1500, 10), settings({ fsrsDesiredRetention: 0.5 }))).toBe(
            "About 2 reviews a day for your " +
                (1500).toLocaleString() +
                " cards. At 70%: about 16.",
        );
    });

    test("it uses the person's own parameters and the maximum interval", () => {
        const own = STEEP_DECAY.join(", ");
        expect(
            workloadText(
                cards(1500, 10),
                settings({ fsrsDesiredRetention: 0.8, fsrsWeights: own }),
            ),
        ).toBe(
            "About 60 reviews a day for your " +
                (1500).toLocaleString() +
                " cards. At 75%: about 43. At 85%: about 88.",
        );
        expect(workloadText(cards(20, 10000), settings({ maximumInterval: 100 }))).toMatch(
            /^Less than 1 review a day for your 20 cards\./,
        );
    });

    test("a count that rounds to 1 reads 1 review, not 1 reviews", () => {
        expect(workloadText(cards(20, 20), settings())).toBe(
            "About 1 review a day for your 20 cards. At 85%: about 1. At 95%: about 3.",
        );
    });

    test("a count that rounds to 0 reads less than 1 review, never about 0", () => {
        expect(workloadText(cards(20, 10000), settings({ maximumInterval: 100 }))).toBe(
            "Less than 1 review a day for your 20 cards. At 85%: less than 1. At 95%: less than 1.",
        );
    });

    test("each count is worded on its own: a side can be less than 1 while the main count is 1", () => {
        expect(workloadText(cards(20, 30), settings())).toBe(
            "About 1 review a day for your 20 cards. At 85%: less than 1. At 95%: about 2.",
        );
    });

    test("no line ever says about 0, 1 reviews or less than 1 reviews", () => {
        for (const stability of [1, 5, 20, 30, 100, 10000]) {
            for (const retention of [0.7, 0.8, 0.9, 0.99]) {
                const text =
                    workloadText(
                        cards(20, stability),
                        settings({ fsrsDesiredRetention: retention }),
                    ) ?? "";
                expect(text).not.toMatch(/about 0|\b1 reviews|less than 1 reviews|About less/i);
            }
        }
    });

    test("it reads 17 parameters with the relearning steps, as the scheduler does", () => {
        const fsrs4 =
            "0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61";
        // What ts-fsrs makes of those 17 numbers with one relearning step: its decay is 0.5, not the default 0.1542.
        const as21 = migrateParameters(fsrs4.split(", ").map(Number), 1, true);
        expect(as21).toHaveLength(21);
        const typed = workloadText(
            cards(1500, 10),
            settings({ fsrsDesiredRetention: 0.8, fsrsWeights: fsrs4 }),
        );
        expect(typed).toBe(
            workloadText(
                cards(1500, 10),
                settings({ fsrsDesiredRetention: 0.8, fsrsWeights: as21.join(", ") }),
            ),
        );
        expect(typed).not.toBe(
            workloadText(cards(1500, 10), settings({ fsrsDesiredRetention: 0.8 })),
        );
    });

    test("parameters that cannot be read fall back to the defaults, as the scheduler does", () => {
        expect(workloadText(cards(1500, 10), settings({ fsrsWeights: "1 2 3" }))).toBe(
            workloadText(cards(1500, 10), settings({ fsrsWeights: "" })),
        );
    });
});
