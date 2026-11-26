import { readFileSync } from "fs";
import * as path from "path";
import { fsrs, FSRSVersion, get_fuzz_range as getFuzzRange } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { buildFsrsParameters, parseFsrsWeights } from "src/scheduling/fsrs/fsrs-settings";
import { evaluateParameters } from "src/scheduling/optimizer/evaluate";
import { createCardRisk } from "src/scheduling/review/review-order";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { writeControl } from "src/settings/adapters";
import { workloadText } from "src/settings/workload";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt, DEFAULT_CLOCK } from "./clock-at";

/**
 * FSRS-6 as the plugin schedules it today (ts-fsrs 5.4.2), locked (issue #27). ts-fsrs 6 changes many of the behaviours
 * below (found by Codex and Gemini, 26 Nov 2026), so FSRS-6 stays on 5.4.2 and ts-fsrs 6 comes only with FSRS-7. The
 * others pin what a partial adapter could break. Every expected value was measured on 5.4.2. If one of these fails
 * after a library change, FSRS-6 users' schedules changed: see plans/2026-11-26-issue-27-release1-v3-final-plan.md
 * before accepting it.
 */

const BUTTONS = [
    ReviewResponse.Again,
    ReviewResponse.Hard,
    ReviewResponse.Good,
    ReviewResponse.Easy,
];
const DAY_MS = 24 * 60 * 60 * 1000;
/** FSRS-6's default weights. */
const D = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const PIN_REASON =
    "FSRS-6 is pinned to ts-fsrs 5.4.2 (issue #27, plans/2026-11-26-issue-27-release1-v3-final-plan.md)";
const NOW = "2026-11-26T12:00:00.000Z";

const scheduler = (settings: Partial<StudioSettings>) =>
    new FsrsCardScheduler({ ...DEFAULT_SETTINGS, ...settings });
const schedule = (comment: string): ScheduleState =>
    CommentParser.parseMultiScheduleComment(comment)[0];
const newCard = (settings: Partial<StudioSettings>, response: ReviewResponse, at = NOW) => {
    clockAt(at);
    return scheduler(settings).cardGetNewSchedule(response, "x.md", new CardDueDateHistogram());
};
const answer = (
    settings: Partial<StudioSettings>,
    comment: string,
    response: ReviewResponse,
    at = NOW,
    histogram = new CardDueDateHistogram(),
) => {
    clockAt(at);
    return scheduler(settings).cardCalcUpdatedSchedule(response, schedule(comment), histogram);
};

/** Everything a schedule decides: state, interval, due time, stability, difficulty. */
const summary = (result: ScheduleState) => {
    const fsrsState = result as FsrsState;
    return [
        fsrsState.state,
        fsrsState.interval,
        new Date(fsrsState.dueDateAsUnix).toISOString(),
        fsrsState.stability,
        fsrsState.difficulty,
    ];
};

afterEach(() => clockAt(DEFAULT_CLOCK));

test("the library is pinned: ts-fsrs 5.4.2 exactly", () => {
    const pkg = JSON.parse(
        readFileSync(path.join(__dirname, "../../../../package.json"), "utf8"),
    ) as {
        dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["ts-fsrs"], PIN_REASON).toBe("5.4.2");
    expect(FSRSVersion, PIN_REASON).toBe("v5.4.2 using FSRS-6.0");
});

describe("custom weights", () => {
    const captured = JSON.parse(
        readFileSync(path.join(__dirname, "typed-weights-ts-fsrs-5.4.2.json"), "utf8"),
    ) as { name: string; steps: string; weights: number[] }[];
    const typed: Record<string, number[]> = {
        "21 defaults": D,
        "17 (FSRS-4)": D.slice(0, 17),
        "19 (FSRS-5)": D.slice(0, 19),
        "21 with w19 = 0": D.map((x, i) => (i === 19 ? 0 : x)),
        "21 with w17 = 1.2, w18 = 0.9": D.map((x, i) => (i === 17 ? 1.2 : i === 18 ? 0.9 : x)),
    };

    test("the captured weights cover 15 distinct lists and steps", () => {
        expect(new Set(captured.map((row) => `${row.name}|${row.steps}`)).size).toBe(15);
    });

    test.each(captured.map((row) => [row.name, row.steps || "none", row] as const))(
        "%s with relearning steps %s give the scheduler the captured 5.4.2 weights",
        (_name, _steps, row) => {
            const settings = {
                ...DEFAULT_SETTINGS,
                fsrsWeights: typed[row.name].join(", "),
                fsrsRelearningSteps: row.steps,
            };
            expect([...fsrs(buildFsrsParameters(settings)).parameters.w]).toEqual(row.weights);
        },
    );

    test("a 19-weight list is saved unchanged with 0, 0.5 added", () => {
        const settings = { ...DEFAULT_SETTINGS };
        writeControl(settings, "fsrsWeights", D.slice(0, 19).join(", "), { isMobile: false });
        expect(settings.fsrsWeights).toBe([...D.slice(0, 19), 0, 0.5].join(", "));
    });

    test("a 17-weight list with w5 = -1 is saved as finite weights that load again", () => {
        const settings = { ...DEFAULT_SETTINGS };
        writeControl(
            settings,
            "fsrsWeights",
            D.slice(0, 17)
                .map((x, i) => (i === 5 ? -1 : x))
                .join(", "),
            {
                isMobile: false,
            },
        );
        expect(settings.fsrsWeights).not.toMatch(/NaN|Infinity/);
        const reloaded = parseFsrsWeights(settings.fsrsWeights, 1);
        expect([reloaded.error, reloaded.weights?.length]).toEqual([null, 21]);
    });

    // 5.4.2 clips the 17 weights, then migrates them; ts-fsrs 6 migrates first (w4 6.4153 → 4.4133)
    test("a 17-weight list with w5 = -1 is saved, and loads again, exactly as 5.4.2 does", () => {
        const typedText = D.slice(0, 17)
            .map((x, i) => (i === 5 ? -1 : x))
            .join(", ");
        const saved =
            "0.212, 1.2931, 2.3065, 8.2956, 6.4153, 0.000999, 3.5194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0, 0, 0, 0.5";
        const parsed = saved.split(", ").map(Number);
        expect(parseFsrsWeights(typedText, 1).weights).toEqual(
            parsed.map((x, i) => (i === 5 ? 0.0009985 : x)),
        );
        const settings = { ...DEFAULT_SETTINGS };
        writeControl(settings, "fsrsWeights", typedText, { isMobile: false });
        expect(settings.fsrsWeights).toBe(saved);
        expect(parseFsrsWeights(saved, 1).weights).toEqual(
            parsed.map((x, i) => (i === 5 ? 0.001 : i === 19 ? 0.01 : x)),
        );
    });

    test("a 17-weight list with w5 = 5 loads as 5.4.2 does, and schedules with w4 clipped to 10", () => {
        const typedText = D.slice(0, 17)
            .map((x, i) => (i === 5 ? 5 : x))
            .join(", ");
        expect(parseFsrsWeights(typedText, 1).weights?.slice(4, 7)).toEqual([
            14.4133, 0.85498312, 3.5194,
        ]);
        expect(
            [
                ...fsrs(buildFsrsParameters({ ...DEFAULT_SETTINGS, fsrsWeights: typedText }))
                    .parameters.w,
            ].slice(4, 7),
        ).toEqual([10, 0.85498312, 3.5194]);
    });

    test("saving weights clips w17 and w18 for 3 relearning steps", () => {
        const settings = { ...DEFAULT_SETTINGS, fsrsRelearningSteps: "1m 10m 20m" };
        writeControl(
            settings,
            "fsrsWeights",
            D.map((x, i) => (i === 17 ? 1.2 : i === 18 ? 0.9 : x)).join(", "),
            { isMobile: false },
        );
        expect(settings.fsrsWeights).toBe(
            D.map((x, i) => (i === 17 || i === 18 ? 0.490273 : x)).join(", "),
        );
    });

    test.each([0, 0.05])(
        "decay w20 = %s is raised to 0.1 for the workload estimate and the review order",
        (decay) => {
            const weights = D.map((x, i) => (i === 20 ? decay : x)).join(", ");
            expect(parseFsrsWeights(weights, 1).weights?.[20]).toBe(0.1);
            expect(
                workloadText(Array<number>(20).fill(10), {
                    fsrsDesiredRetention: 0.8,
                    fsrsWeights: weights,
                    fsrsRelearningSteps: "10m",
                    maximumInterval: 36500,
                }),
            ).toBe(
                "Less than 1 review a day for your 20 cards. At 75%: less than 1. At 85%: about 1.",
            );
            const card = new Card({
                front: "f",
                back: "b",
                scheduleInfo: schedule(
                    "!fsrs,2026-11-26T12:00:00.000Z,10,10,5,2,3,0,0,2026-11-06T12:00:00.000Z",
                ),
            });
            expect(
                createCardRisk(
                    { ...DEFAULT_SETTINGS, fsrsWeights: weights },
                    Date.parse(NOW),
                )(card),
            ).toBe(0.85597158);
        },
    );

    test.each([
        ["Again", ReviewResponse.Again, 0, [1, 0, "2026-11-26T12:01:00.000Z", 0.1, 6.4133]],
        ["Hard", ReviewResponse.Hard, 1, [1, 0, "2026-11-26T12:06:00.000Z", 0.1, 5.11217071]],
        ["Good", ReviewResponse.Good, 2, [1, 0, "2026-11-26T12:10:00.000Z", 0.1, 2.11810397]],
        ["Easy", ReviewResponse.Easy, 3, [2, 1, "2026-11-27T12:00:00.000Z", 0.1, 1]],
    ])(
        "%s on a new card with its initial stability at 0.05 gets 0.1",
        (_name, response, index, expected) => {
            const weights = D.map((x, i) => (i === index ? 0.05 : x)).join(", ");
            expect(summary(newCard({ fsrsWeights: weights }, response))).toEqual(expected);
        },
    );

    test("the interval rounds as 5.4.2 does: w3 = 10.018241, decay 0.1, retention 0.70 → Easy 184 days", () => {
        const weights = D.map((x, i) => (i === 3 ? 10.018241 : i === 20 ? 0.1 : x)).join(", ");
        const easy = newCard(
            { fsrsWeights: weights, fsrsDesiredRetention: 0.7 },
            ReviewResponse.Easy,
        );
        expect([easy.interval, easy.dueDateAsUnix]).toEqual([184, Date.parse(NOW) + 184 * DAY_MS]);
    });
});

describe("learning steps", () => {
    test("Hard on a new card waits 6 minutes with steps 1m 10m", () => {
        expect(newCard({}, ReviewResponse.Hard).dueDateAsUnix).toBe(
            Date.parse(NOW) + 6 * 60 * 1000,
        );
    });

    // Day-long steps keep their full length even past the maximum; the extra hour of 25h is kept too
    test.each([
        ["25h", [2, 1, "2026-11-27T13:00:00.000Z", 0.212, 6.4133]],
        ["2d", [2, 2, "2026-11-28T12:00:00.000Z", 0.212, 6.4133]],
        ["3d", [2, 3, "2026-11-29T12:00:00.000Z", 0.212, 6.4133]],
    ])("a %s learning step on a new card's Again, with a 1-day maximum", (steps, expected) => {
        expect(
            summary(
                newCard({ maximumInterval: 1, fsrsLearningSteps: steps }, ReviewResponse.Again),
            ),
        ).toEqual(expected);
    });

    test("a 25h learning step with fuzz and load balancing on keeps its due time", () => {
        const again = newCard(
            {
                maximumInterval: 1,
                fsrsLearningSteps: "25h",
                fsrsEnableFuzz: true,
                fsrsLoadBalance: true,
            },
            ReviewResponse.Again,
        );
        expect(summary(again)).toEqual([2, 1, "2026-11-27T13:00:00.000Z", 0.212, 6.4133]);
    });

    test("a 25h relearning step on a review card's Again, with a 1-day maximum", () => {
        const card = "!fsrs,2026-11-26T12:00:00.000Z,30,100,5,2,10,0,0,2026-10-27T12:00:00.000Z";
        expect(
            summary(
                answer(
                    { maximumInterval: 1, fsrsRelearningSteps: "25h" },
                    card,
                    ReviewResponse.Again,
                ),
            ),
        ).toEqual([2, 1, "2026-11-27T13:00:00.000Z", 3.38869849, 8.34176237]);
    });

    // Hard waits (1 + 2878) / 2 = 1439.5 minutes; 5.4.2 rounds it to a full day and graduates the card
    test("Hard at the day boundary (steps 1m 2878m) graduates to 1 day", () => {
        expect(summary(newCard({ fsrsLearningSteps: "1m 2878m" }, ReviewResponse.Hard))).toEqual([
            2,
            1,
            "2026-11-27T12:00:00.000Z",
            1.2931,
            5.11217071,
        ]);
    });

    test("Hard with a single 3m relearning step waits 5 minutes", () => {
        const card = "!fsrs,2026-11-26T12:00:00.000Z,0,30,5,3,10,1,0,2026-10-27T12:00:00.000Z";
        expect(summary(answer({ fsrsRelearningSteps: "3m" }, card, ReviewResponse.Hard))).toEqual([
            3,
            0,
            "2026-11-26T12:05:00.000Z",
            63.09377391,
            6.66599536,
        ]);
    });
});

describe("the maximum interval", () => {
    // Load balancing picks a quieter day inside the window (4 of 5 here)
    test.each([
        [1, false, 1],
        [5, false, 5],
        [1, true, 1],
        [5, true, 4],
    ])(
        "a new card answered Easy, maximum %i days, load balance %s: %i days",
        (maximumInterval, balance, days) => {
            const easy = newCard(
                { maximumInterval, fsrsLoadBalance: balance },
                ReviewResponse.Easy,
            );
            expect(easy.interval).toBe(days);
        },
    );

    // 5.4.2 caps before fuzz, then keeps the buttons a day apart even past the maximum (Easy 16); ts-fsrs 6 fuzzes
    // from the uncapped interval (9, 10, 11 with the plugin's fuzz seed)
    test("with fuzz on and a 15-day maximum, a mature card's Hard, Good, Easy are 14, 15, 16", () => {
        const card =
            "!fsrs,2023-09-09T08:00:00.000Z,87,99.5105,4.3496,2,14,0,0,2023-09-06T08:00:00.000Z";
        const intervals = [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy].map(
            (response) =>
                answer(
                    { fsrsEnableFuzz: true, maximumInterval: 15 },
                    card,
                    response,
                    "2023-09-09T08:00:00.000Z",
                ).interval,
        );
        expect(intervals).toEqual([14, 15, 16]);
    });

    test.each([false, true])(
        "a learning card's Good and Easy stay at a 5-day maximum (fuzz %s)",
        (fuzz) => {
            const card = "!fsrs,2026-11-26T12:00:00.000Z,0,10,5,1,1,0,1,2026-11-26T11:50:00.000Z";
            expect(
                [ReviewResponse.Good, ReviewResponse.Easy].map(
                    (response) =>
                        answer({ maximumInterval: 5, fsrsEnableFuzz: fuzz }, card, response)
                            .interval,
                ),
            ).toEqual([5, 5]);
        },
    );

    test.each([
        [false, [5, 5]],
        [true, [4, 4]],
    ])(
        "a relearning card's Good and Easy at a 5-day maximum, no load balancing (fuzz %s)",
        (fuzz, expected) => {
            const card = "!fsrs,2026-11-26T12:00:00.000Z,0,30,5,3,10,1,0,2026-10-27T12:00:00.000Z";
            expect(
                [ReviewResponse.Good, ReviewResponse.Easy].map(
                    (response) =>
                        answer({ maximumInterval: 5, fsrsEnableFuzz: fuzz }, card, response)
                            .interval,
                ),
            ).toEqual(expected);
        },
    );

    test("a review card's Again with no relearning steps stays at a 1-day maximum", () => {
        const card = "!fsrs,2026-11-26T12:00:00.000Z,30,100,5,2,10,0,0,2026-10-27T12:00:00.000Z";
        expect(
            summary(
                answer({ maximumInterval: 1, fsrsRelearningSteps: "" }, card, ReviewResponse.Again),
            ),
        ).toEqual([2, 1, "2026-11-27T12:00:00.000Z", 3.38869849, 8.34176237]);
    });

    test("with load balancing and no learning steps, a new card's answers stay at a 1-day maximum", () => {
        const intervals = BUTTONS.map(
            (response) =>
                newCard(
                    { maximumInterval: 1, fsrsLearningSteps: "", fsrsLoadBalance: true },
                    response,
                ).interval,
        );
        expect(intervals).toEqual([1, 1, 1, 1]);
    });

    test("with load balancing, a relearning card's Easy stays at a 30-day maximum", () => {
        const card = "!fsrs,2026-11-26T12:00:00.000Z,30,30,5,3,10,1,0,2026-10-27T12:00:00.000Z";
        expect(
            answer({ maximumInterval: 30, fsrsLoadBalance: true }, card, ReviewResponse.Easy)
                .interval,
        ).toBe(30);
    });

    test("with load balancing at a 3-day maximum, a busy review card gives Again 1, Hard 2, Good 3, Easy 4", () => {
        const card =
            "!fsrs,2026-12-05T12:00:00.000Z,286,155.5265909230709,6.782320286380127,2,75,1,2,2026-10-05T12:00:00.000Z";
        const histogram = new CardDueDateHistogram({
            0: 8,
            1: 15,
            2: 4,
            3: 30,
            5: 60,
            8: 40,
            13: 70,
            21: 20,
            34: 15,
        });
        const settings = {
            maximumInterval: 3,
            fsrsDesiredRetention: 0.97,
            fsrsLoadBalance: true,
            fsrsRelearningSteps: "1m 10m",
        };
        expect(
            BUTTONS.map((response) => answer(settings, card, response, NOW, histogram).interval),
        ).toEqual([1, 2, 3, 4]);
    });

    // With no relearning steps 5.4.2 answers a relearning card like a review card, and load balancing can then put
    // Hard past the maximum and after Good. Pinned as today's behaviour (not fixed here).
    test.each([
        [false, false, [4, 5, 5, 5]],
        [false, true, [4, 4, 4, 4]],
        [true, false, [5, 6, 5, 5]],
        [true, true, [5, 6, 5, 5]],
    ])(
        "a relearning card with no relearning steps at a 5-day maximum (load balance %s, fuzz %s)",
        (balance, fuzz, expected) => {
            const card =
                "!fsrs,2026-11-26T12:00:00.000Z,0,117.4234,5.5795,3,10,1,0,2026-10-27T12:00:00.000Z";
            const settings = {
                maximumInterval: 5,
                fsrsEnableFuzz: fuzz,
                fsrsLoadBalance: balance,
                fsrsRelearningSteps: "",
            };
            expect(BUTTONS.map((response) => answer(settings, card, response).interval)).toEqual(
                expected,
            );
        },
    );

    // The classes 5.4.2 caps. Review-like answers and day-long steps can pass the maximum: pinned exactly above.
    test("new, learning and relearning (with steps) cards never pass the maximum, for 400 random cards and settings", () => {
        let seed = 27;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const wrong: string[] = [];
        for (let i = 0; i < 400; i++) {
            const maximumInterval = [1, 2, 5, 15, 30, 365][i % 6];
            const settings = {
                maximumInterval,
                fsrsEnableFuzz: random() < 0.5,
                fsrsLoadBalance: random() < 0.5,
                fsrsLearningSteps: random() < 0.3 ? "" : "1m 10m",
                fsrsRelearningSteps: random() < 0.5 ? "10m" : "1m 10m",
                fsrsDesiredRetention: [0.7, 0.85, 0.9, 0.97][i % 4],
            };
            const stability = (0.5 + random() * 200).toFixed(4);
            const difficulty = (1 + random() * 9).toFixed(4);
            const card = [
                null,
                `!fsrs,${NOW},0,${stability},${difficulty},1,1,0,1,2026-11-26T11:50:00.000Z`,
                `!fsrs,${NOW},0,${stability},${difficulty},3,10,1,0,2026-10-27T12:00:00.000Z`,
            ][i % 3];
            for (const response of BUTTONS) {
                const result = card
                    ? answer(settings, card, response)
                    : newCard(settings, response);
                const { interval } = result;
                if (!Number.isInteger(interval) || interval < 0 || interval > maximumInterval)
                    wrong.push(
                        `${card ?? "new"} ${JSON.stringify(settings)} ${response} → ${interval}`,
                    );
            }
        }
        expect(wrong.slice(0, 3)).toEqual([]);
    });
});

test("with fuzz on, the interval on a button is the one applied 5 minutes later (review cards)", () => {
    let seed = 2026;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let differences = 0;
    let fuzzed = 0;
    for (let i = 0; i < 200; i++) {
        const interval = 1 + Math.floor(random() * 400);
        const last = new Date(
            Date.parse("2026-11-26T08:00:00.000Z") - interval * DAY_MS,
        ).toISOString();
        const card = `!fsrs,2026-11-26T08:00:00.000Z,${interval},${interval * (0.5 + random())},${1 + random() * 9},2,${2 + Math.floor(random() * 20)},0,0,${last}`;
        for (const response of [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy]) {
            const shown = answer(
                { fsrsEnableFuzz: true },
                card,
                response,
                "2026-11-26T08:00:00.000Z",
            );
            const applied = answer(
                { fsrsEnableFuzz: true },
                card,
                response,
                "2026-11-26T08:05:00.000Z",
            );
            const unfuzzed = answer(
                { fsrsEnableFuzz: false },
                card,
                response,
                "2026-11-26T08:00:00.000Z",
            );
            if (shown.interval !== applied.interval) differences++;
            if (shown.interval !== unfuzzed.interval) fuzzed++;
        }
    }
    // Fuzz must really move the intervals, or this check would pass with fuzz switched off
    expect([differences, fuzzed > 500]).toEqual([0, true]);
});

test("fuzz below the maximum picks the same day as 5.4.2's Alea: 76, 103, 160 (unfuzzed 82, 110, 171)", () => {
    const card = "!fsrs,2026-11-26T12:00:00.000Z,40,40,5,2,8,0,0,2026-10-17T12:00:00.000Z";
    const intervals = (fuzz: boolean) =>
        [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy].map(
            (response) => answer({ fsrsEnableFuzz: fuzz }, card, response).interval,
        );
    expect([intervals(true), intervals(false)]).toEqual([
        [76, 103, 160],
        [82, 110, 171],
    ]);
});

describe("load balancing", () => {
    test("the window around an interval is 5.4.2's", () => {
        expect(
            [
                [3, 0, 36525],
                [15, 3, 15],
                [40, 10, 36525],
                [100, 30, 36525],
                [100, 3, 15],
            ].map(([interval, elapsed, maximum]) => getFuzzRange(interval, elapsed, maximum)),
        ).toEqual([
            { ["min_ivl"]: 2, ["max_ivl"]: 4 },
            { ["min_ivl"]: 13, ["max_ivl"]: 15 },
            { ["min_ivl"]: 36, ["max_ivl"]: 44 },
            { ["min_ivl"]: 93, ["max_ivl"]: 107 },
            { ["min_ivl"]: 8, ["max_ivl"]: 15 },
        ]);
    });

    test.each([false, true])(
        "a busy 40-day review card with easy days gives Hard 88, Good 116, Easy 180 (fuzz %s)",
        (fuzz) => {
            const card = "!fsrs,2026-11-26T12:00:00.000Z,40,40,5,2,8,0,0,2026-10-17T12:00:00.000Z";
            const busy: Record<number, number> = {};
            for (const day of [76, 77, 78, 79, 80, 81, 82, 106, 107, 108, 109, 168, 169, 170])
                busy[day] = 40;
            const settings = {
                fsrsLoadBalance: true,
                fsrsEnableFuzz: fuzz,
                fsrsEasyDays: [0, 6],
            } as Partial<StudioSettings>;
            expect(
                [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy].map(
                    (response) =>
                        answer(settings, card, response, NOW, new CardDueDateHistogram(busy))
                            .interval,
                ),
            ).toEqual([88, 116, 180]);
        },
    );
});

test("stability stops at 5.4.2's ceiling of 36,500 days", () => {
    const card = "!fsrs,2026-11-26T12:00:00.000Z,30000,30000,2,2,20,0,0,1944-10-08T12:00:00.000Z";
    const easy = answer({ maximumInterval: 36525 }, card, ReviewResponse.Easy) as FsrsState;
    expect([easy.stability, easy.interval]).toEqual([36500, 36502]);
});

describe("optimizer score", () => {
    const withWeight = (index: number, value: number) => D.map((x, i) => (i === index ? value : x));

    test("w0 = 0.05 scores as w0 = 0.1 (the initial stability floor)", () => {
        const histories = [
            {
                cardId: "c1",
                reviews: [
                    { t: 0, rating: 1 as const, deltaT: 0 },
                    { t: DAY_MS, rating: 3 as const, deltaT: 1 },
                    { t: 6 * DAY_MS, rating: 3 as const, deltaT: 5 },
                ],
            },
        ];
        expect(evaluateParameters(histories, withWeight(0, 0.05))).toEqual({
            logLoss: 0.30337411789108404,
            rmse: 0.26439259265876425,
            count: 2,
        });
    });

    test("w19 = 0 scores as w19 = 0.01 on same-day reviews", () => {
        const histories = [
            {
                cardId: "c1",
                reviews: [
                    { t: 0, rating: 3 as const, deltaT: 0 },
                    { t: 600_000, rating: 3 as const, deltaT: 0 },
                    { t: 4 * DAY_MS, rating: 3 as const, deltaT: 4 },
                ],
            },
        ];
        expect(evaluateParameters(histories, withWeight(19, 0))).toEqual({
            logLoss: 0.07465297924756621,
            rmse: 0.0980109014371771,
            count: 2,
        });
    });
});
