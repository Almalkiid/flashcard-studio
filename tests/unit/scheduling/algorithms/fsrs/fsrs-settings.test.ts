import moment from "moment";
import {
    default_w as defaultWeights,
    fsrs,
    generatorParameters,
    Rating,
    State,
    StrategyMode,
} from "ts-fsrs";

import { DEFAULT_SETTINGS } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import {
    buildFsrsParameters,
    formatFsrsSteps,
    formatFsrsWeights,
    hasStepOfADayOrMore,
    parseFsrsSteps,
    parseFsrsWeights,
    stableFuzzSeed,
} from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { SrsAlgorithmFsrs } from "src/scheduling/algorithms/fsrs/sr-algorithm-fsrs";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

beforeAll(() => {
    setupStaticDateProvider20230906();
});

describe("parseFsrsSteps", () => {
    test("reads steps in minutes, hours and days, separated by spaces or commas", () => {
        expect(parseFsrsSteps("1m 10m")).toEqual(["1m", "10m"]);
        expect(parseFsrsSteps("  30m,2h ,1d ")).toEqual(["30m", "2h", "1d"]);
        expect(parseFsrsSteps("10m")).toEqual(["10m"]);
    });

    test("an empty text is a valid empty list", () => {
        expect(parseFsrsSteps("")).toEqual([]);
        expect(parseFsrsSteps("   ")).toEqual([]);
        expect(parseFsrsSteps(undefined)).toEqual([]);
    });

    test.each(["10", "m", "0m", "-5m", "1.5h", "1w", "1m x", "10 m", "1mm"])(
        "rejects %p",
        (text) => {
            expect(parseFsrsSteps(text)).toBeNull();
        },
    );

    test("formats steps the way they are typed", () => {
        expect(formatFsrsSteps(parseFsrsSteps("1m,  10m"))).toEqual("1m 10m");
        expect(formatFsrsSteps([])).toEqual("");
    });

    test("finds steps of a day or more", () => {
        expect(hasStepOfADayOrMore(["1m", "10m"])).toBe(false);
        expect(hasStepOfADayOrMore(["1m", "1d"])).toBe(true);
        expect(hasStepOfADayOrMore(["23h"])).toBe(false);
        expect(hasStepOfADayOrMore(["24h"])).toBe(true);
    });
});

describe("parseFsrsWeights", () => {
    test("an empty text means the default weights", () => {
        expect(parseFsrsWeights("", 1)).toEqual({ weights: null, error: null, typedCount: 0 });
        expect(parseFsrsWeights("  \n ", 1).weights).toBeNull();
    });

    test("accepts 21 weights and gives them back as they were", () => {
        const parsed = parseFsrsWeights(defaultWeights.join(", "), 1);
        expect(parsed.error).toBeNull();
        expect(parsed.typedCount).toBe(21);
        expect(parsed.weights).toHaveLength(21);
        parsed.weights.forEach((weight, index) =>
            expect(weight).toBeCloseTo(defaultWeights[index], 6),
        );
    });

    test("accepts brackets, semicolons and new lines from an export", () => {
        const parsed = parseFsrsWeights("[" + defaultWeights.join(";\n") + "]", 1);
        expect(parsed.error).toBeNull();
        expect(parsed.weights).toHaveLength(21);
    });

    test("converts 19 weights (FSRS-5) and 17 weights (FSRS-4) to 21", () => {
        const w19 = parseFsrsWeights(defaultWeights.slice(0, 19).join(","), 1);
        expect(w19.error).toBeNull();
        expect(w19.typedCount).toBe(19);
        expect(w19.weights).toHaveLength(21);

        const w17 = parseFsrsWeights(defaultWeights.slice(0, 17).join(","), 1);
        expect(w17.error).toBeNull();
        expect(w17.typedCount).toBe(17);
        expect(w17.weights).toHaveLength(21);
    });

    test("limits weights to their valid range", () => {
        const wild = defaultWeights.map((weight) => weight * 1000).join(",");
        const parsed = parseFsrsWeights(wild, 1);
        expect(parsed.error).toBeNull();
        // w[0] is the stability of a new card answered Again; ts-fsrs keeps it below INIT_S_MAX (100)
        expect(parsed.weights[0]).toBeLessThanOrEqual(100);
    });

    test("rejects a wrong number of weights with the reason", () => {
        const parsed = parseFsrsWeights("0.4, 0.6, 2.4", 1);
        expect(parsed.weights).toBeNull();
        expect(parsed.error).toContain("Invalid parameter length: 3");
        expect(parsed.typedCount).toBe(3);
    });

    test("rejects text that is not numbers", () => {
        const parsed = parseFsrsWeights(defaultWeights.slice(0, 20).join(",") + ", abc", 1);
        expect(parsed.weights).toBeNull();
        expect(parsed.error).toMatch(/Non-finite|NaN/);
    });

    test("formats weights without trailing noise", () => {
        expect(formatFsrsWeights([0.212, 1.2931, 30.0000001])).toEqual("0.212, 1.2931, 30");
    });
});

describe("buildFsrsParameters with the FSRS settings", () => {
    test("passes steps, fuzz and weights to ts-fsrs", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            fsrsLearningSteps: "5m 30m",
            fsrsRelearningSteps: "20m",
            fsrsEnableFuzz: true,
            fsrsWeights: defaultWeights.map((weight) => weight + 0.01).join(", "),
        };
        const parameters = generatorParameters(buildFsrsParameters(settings));
        expect(parameters.learning_steps).toEqual(["5m", "30m"]);
        expect(parameters.relearning_steps).toEqual(["20m"]);
        expect(parameters.enable_fuzz).toBe(true);
        expect(parameters.w[0]).toBeCloseTo(defaultWeights[0] + 0.01, 6);
    });

    test("the defaults are ts-fsrs's own steps and default weights", () => {
        const parameters = generatorParameters(buildFsrsParameters(DEFAULT_SETTINGS));
        expect(parameters.learning_steps).toEqual(["1m", "10m"]);
        expect(parameters.relearning_steps).toEqual(["10m"]);
        expect(parameters.enable_fuzz).toBe(false);
        expect(parameters.w).toEqual(defaultWeights);
    });

    test("unreadable steps and weights in data.json fall back to the defaults", () => {
        const parameters = generatorParameters(
            buildFsrsParameters({
                ...DEFAULT_SETTINGS,
                fsrsLearningSteps: "soon",
                fsrsRelearningSteps: "later",
                fsrsWeights: "1, 2, 3",
            }),
        );
        expect(parameters.learning_steps).toEqual(["1m", "10m"]);
        expect(parameters.relearning_steps).toEqual(["10m"]);
        expect(parameters.w).toEqual(defaultWeights);
    });
});

describe("stableFuzzSeed", () => {
    // A review card with an interval of about 40 days, so fuzz moves the next interval by several days
    const reviewCard = () => ({
        due: new Date("2023-09-06T00:00:00.000Z"),
        stability: 40,
        difficulty: 5,
        ["elapsed_days"]: 40,
        ["scheduled_days"]: 40,
        ["learning_steps"]: 0,
        reps: 8,
        lapses: 0,
        state: State.Review,
        ["last_review"]: new Date("2023-07-28T00:00:00.000Z"),
    });
    const nextIntervalAt = (scheduler: ReturnType<typeof fsrs>, now: Date) =>
        scheduler.next(reviewCard(), now, Rating.Good).card.scheduled_days;
    const times = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2023, 8, 6, 8, 0, i)));

    test("gives the same interval whenever the same card is answered", () => {
        const seeded = fsrs(generatorParameters({ ["enable_fuzz"]: true })).useStrategy(
            StrategyMode.SEED,
            stableFuzzSeed,
        );
        const intervals = new Set(times.map((now) => nextIntervalAt(seeded, now)));
        expect(intervals.size).toBe(1);
    });

    test("ts-fsrs's own seed would give different intervals at different times", () => {
        const unseeded = fsrs(generatorParameters({ ["enable_fuzz"]: true }));
        const intervals = new Set(times.map((now) => nextIntervalAt(unseeded, now)));
        expect(intervals.size).toBeGreaterThan(1);
    });

    test("a card that was never reviewed falls back to ts-fsrs's seed", () => {
        const seeded = fsrs(generatorParameters({ ["enable_fuzz"]: true })).useStrategy(
            StrategyMode.SEED,
            stableFuzzSeed,
        );
        const newCard = {
            ...reviewCard(),
            state: State.New,
            reps: 0,
            ["last_review"]: undefined as Date | undefined,
        };
        const next = seeded.next(newCard, times[0], Rating.Good);
        expect(next.card.reps).toBe(1);
    });
});

describe("learning steps from the settings", () => {
    const minutesFromNow = (schedule: { dueDateAsUnix: number }) =>
        Math.round((schedule.dueDateAsUnix - Date.parse("2023-09-06T00:00:00.000Z")) / 60000);

    test("Again and Good on a new card follow the configured steps", () => {
        const algorithm = new SrsAlgorithmFsrs({
            ...DEFAULT_SETTINGS,
            fsrsLearningSteps: "5m 30m",
        });
        const histogram = new CardDueDateHistogram();
        expect(
            minutesFromNow(algorithm.cardGetNewSchedule(ReviewResponse.Again, "n.md", histogram)),
        ).toBe(5);
        expect(
            minutesFromNow(algorithm.cardGetNewSchedule(ReviewResponse.Good, "n.md", histogram)),
        ).toBe(30);
    });

    test("changing the steps applies after updateParameters", () => {
        const settings = { ...DEFAULT_SETTINGS };
        const algorithm = new SrsAlgorithmFsrs(settings);
        const histogram = new CardDueDateHistogram();
        expect(
            minutesFromNow(algorithm.cardGetNewSchedule(ReviewResponse.Again, "n.md", histogram)),
        ).toBe(1);

        settings.fsrsLearningSteps = "15m";
        algorithm.updateParameters(settings);
        expect(
            minutesFromNow(algorithm.cardGetNewSchedule(ReviewResponse.Again, "n.md", histogram)),
        ).toBe(15);
    });

    test("relearning steps decide the interval after a lapse", () => {
        const algorithm = new SrsAlgorithmFsrs({ ...DEFAULT_SETTINGS, fsrsRelearningSteps: "3m" });
        const review = new RepItemScheduleInfoFsrs(
            moment("2023-09-06T00:00:00.000Z"),
            30,
            5.5,
            30,
            State.Review,
            8,
            0,
            0,
            moment("2023-08-07T00:00:00.000Z"),
        );
        const lapsed = algorithm.cardCalcUpdatedSchedule(
            ReviewResponse.Again,
            review,
            new CardDueDateHistogram(),
        ) as RepItemScheduleInfoFsrs;
        expect(lapsed.state).toBe(State.Relearning);
        expect(minutesFromNow(lapsed)).toBe(3);
    });

    test("with no learning steps FSRS schedules the new card itself", () => {
        const algorithm = new SrsAlgorithmFsrs({ ...DEFAULT_SETTINGS, fsrsLearningSteps: "" });
        const schedule = algorithm.cardGetNewSchedule(
            ReviewResponse.Good,
            "n.md",
            new CardDueDateHistogram(),
        ) as RepItemScheduleInfoFsrs;
        expect(schedule.state).toBe(State.Review);
        expect(schedule.interval).toBeGreaterThanOrEqual(1);
    });
});

test("with fuzz on, the interval on a button is the one applied", () => {
    const algorithm = new SrsAlgorithmFsrs({ ...DEFAULT_SETTINGS, fsrsEnableFuzz: true });
    const review = () =>
        new RepItemScheduleInfoFsrs(
            moment("2023-09-06T00:00:00.000Z"),
            40,
            5,
            40,
            State.Review,
            8,
            0,
            0,
            moment("2023-07-28T00:00:00.000Z"),
        );
    const shown = algorithm.cardCalcUpdatedSchedule(
        ReviewResponse.Good,
        review(),
        new CardDueDateHistogram(),
    );
    const applied = algorithm.cardCalcUpdatedSchedule(
        ReviewResponse.Good,
        review(),
        new CardDueDateHistogram(),
    );
    expect(applied.interval).toBe(shown.interval);
});
