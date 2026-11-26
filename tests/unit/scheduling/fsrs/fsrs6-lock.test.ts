import { readFileSync } from "fs";
import * as path from "path";
import { fsrs } from "ts-fsrs";

import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { buildFsrsParameters, parseFsrsWeights } from "src/scheduling/fsrs/fsrs-settings";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { writeControl } from "src/settings/adapters";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt, DEFAULT_CLOCK } from "./clock-at";

/**
 * FSRS-6 as the plugin schedules it today (ts-fsrs 5.4.2), locked (issue #27). ts-fsrs 6 changes every behaviour below
 * (found by Codex and Gemini, 26 Nov 2026), so FSRS-6 stays on 5.4.2 and ts-fsrs 6 comes only with FSRS-7. If one of
 * these fails after a library change, FSRS-6 users' schedules changed: see
 * plans/2026-11-26-issue-27-release1-v3-final-plan.md before accepting it.
 */

const BUTTONS = [
    ReviewResponse.Again,
    ReviewResponse.Hard,
    ReviewResponse.Good,
    ReviewResponse.Easy,
];
const DAY_MS = 24 * 60 * 60 * 1000;
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

afterEach(() => clockAt(DEFAULT_CLOCK));

test("the library is pinned: ts-fsrs 5.4.2 exactly", () => {
    const pkg = JSON.parse(
        readFileSync(path.join(__dirname, "../../../../package.json"), "utf8"),
    ) as {
        dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["ts-fsrs"]).toBe("5.4.2");
});

describe("custom weights", () => {
    const captured = JSON.parse(
        readFileSync(path.join(__dirname, "typed-weights-ts-fsrs-5.4.2.json"), "utf8"),
    ) as { name: string; steps: string; weights: number[] }[];
    const D = [
        0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
        0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ];
    const typed: Record<string, number[]> = {
        "21 defaults": D,
        "17 (FSRS-4)": D.slice(0, 17),
        "19 (FSRS-5)": D.slice(0, 19),
        "21 with w19 = 0": D.map((x, i) => (i === 19 ? 0 : x)),
        "21 with w17 = 1.2, w18 = 0.9": D.map((x, i) => (i === 17 ? 1.2 : i === 18 ? 0.9 : x)),
    };

    test.each(captured.map((row) => [row.name, row.steps || "none", row] as const))(
        "%s with relearning steps %s schedule with the captured 5.4.2 weights",
        (_name, _steps, row) => {
            const settings = {
                ...DEFAULT_SETTINGS,
                fsrsWeights: typed[row.name].join(", "),
                fsrsRelearningSteps: row.steps,
            };
            expect([...fsrs(buildFsrsParameters(settings)).parameters.w]).toEqual(row.weights);
        },
    );

    test("a 19-weight list is saved as 21 weights ending 0, 0.5", () => {
        const settings = { ...DEFAULT_SETTINGS };
        writeControl(settings, "fsrsWeights", D.slice(0, 19).join(", "), { isMobile: false });
        expect(settings.fsrsWeights.endsWith("0.0912, 0, 0.5")).toBe(true);
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

    test("an initial stability below 0.1 is raised to 0.1", () => {
        const weights = D.map((x, i) => (i === 0 ? 0.05 : x)).join(", ");
        expect(
            (newCard({ fsrsWeights: weights }, ReviewResponse.Again) as FsrsState).stability,
        ).toBe(0.1);
    });

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
    // from the uncapped interval (Hard 5, Good 6)
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

    test("a new card's answers never pass the maximum, for 400 random settings", () => {
        let seed = 27;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const over: string[] = [];
        for (let i = 0; i < 400; i++) {
            const maximumInterval = [1, 2, 5, 15, 30, 365][i % 6];
            const settings = {
                maximumInterval,
                fsrsEnableFuzz: random() < 0.5,
                fsrsLoadBalance: random() < 0.5,
                fsrsLearningSteps: random() < 0.3 ? "" : "1m 10m",
            };
            for (const response of BUTTONS) {
                const result = newCard(settings, response);
                if (result.interval > maximumInterval)
                    over.push(`${JSON.stringify(settings)} → ${result.interval}`);
            }
        }
        expect(over.slice(0, 3)).toEqual([]);
    });
});

test("with fuzz on, the interval on a button is the one applied 5 minutes later (review cards)", () => {
    let seed = 2026;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let differences = 0;
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
            if (shown.interval !== applied.interval) differences++;
        }
    }
    expect(differences).toBe(0);
});
