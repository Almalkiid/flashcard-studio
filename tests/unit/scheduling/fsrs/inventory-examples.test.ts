import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { buildFsrsParameters } from "src/scheduling/fsrs/fsrs-settings";
import { sm2ScheduleToFsrsCard } from "src/scheduling/fsrs/sm2-to-fsrs-card";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { CommentParser } from "src/utils/schedule-comment";

import { loadGolden } from "../golden/load-golden";
import { clockAt, DEFAULT_CLOCK, iso } from "./clock-at";

/**
 * The examples of the behaviour inventory, section 6.5 (and 4.3), run against the new code. Their expected values are
 * the ones the inventory prints, which the golden file keeps as `inventoryCrossChecks`.
 */
const checks = loadGolden<{ inventoryCrossChecks: { id: string; inventoryExpected: string }[] }>(
    "fsrs",
).inventoryCrossChecks;
const expected = (id: string): string => checks.find((check) => check.id === id).inventoryExpected;

const BUTTONS = {
    Again: ReviewResponse.Again,
    Hard: ReviewResponse.Hard,
    Good: ReviewResponse.Good,
    Easy: ReviewResponse.Easy,
};
const histogram = new CardDueDateHistogram();
const schedule = (text: string): ScheduleState => CommentParser.parseMultiScheduleComment(text)[0];

/** The text of each button's answer to a card, for settings. */
function answers(settings: Partial<StudioSettings>, card: ScheduleState | null) {
    const algorithm = new FsrsCardScheduler({ ...DEFAULT_SETTINGS, ...settings });
    return Object.fromEntries(
        Object.entries(BUTTONS).map(([name, response]) => {
            const answered =
                card === null
                    ? algorithm.cardGetNewSchedule(response, "n.md", histogram)
                    : algorithm.cardCalcUpdatedSchedule(response, card, histogram);
            return [name, answered];
        }),
    );
}

// A card in Review state, due four days ago, answered now
const REVIEW_CARD = "!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z";

beforeEach(() => {
    clockAt(DEFAULT_CLOCK);
});

describe("inventory 4.3 and 6.5", () => {
    test.each(["Again", "Hard", "Good", "Easy"])("a new card answered %s", (name) => {
        const answered = answers({}, null)[name];
        expect(answered.formatScheduleAsComment()).toBe(expected(`w-new-${name}`));
    });

    test.each(["Again", "Hard", "Good", "Easy"])("a review card answered %s", (name) => {
        const answered = answers({}, schedule(REVIEW_CARD))[name];
        expect(answered.formatScheduleAsComment()).toBe(expected(`w-review-${name}`));
    });

    test("with fuzz on, Hard, Good and Easy are 12, 18 and 31 days", () => {
        const fuzzed = answers({ fsrsEnableFuzz: true }, schedule(REVIEW_CARD));
        expect([fuzzed.Hard.interval, fuzzed.Good.interval, fuzzed.Easy.interval]).toEqual([
            Number(expected("w-fuzz-hard-12")),
            Number(expected("w-fuzz-good-18")),
            Number(expected("w-fuzz-easy-31")),
        ]);
    });

    test("at retention 0.8 Good is 68 days and Easy 115", () => {
        const answered = answers({ fsrsDesiredRetention: 0.8 }, schedule(REVIEW_CARD));
        expect([answered.Good.interval, answered.Easy.interval]).toEqual([
            Number(expected("w-retention0.8-good-68")),
            Number(expected("w-retention0.8-easy-115")),
        ]);
    });

    test("with a maximum interval of 5 days Good is 6 and Easy 7: ts-fsrs keeps the buttons apart", () => {
        const answered = answers({ maximumInterval: 5 }, schedule(REVIEW_CARD));
        expect([answered.Good.interval, answered.Easy.interval]).toEqual([
            Number(expected("w-maxinterval5-good-6")),
            Number(expected("w-maxinterval5-easy-7")),
        ]);
    });

    test("with no learning steps a new card goes straight to review", () => {
        const answered = answers({ fsrsLearningSteps: "" }, null);
        expect(answered.Again.formatScheduleAsComment()).toContain(expected("w-emptysteps-again"));
        expect(answered.Good.formatScheduleAsComment()).toContain(expected("w-emptysteps-good"));
    });

    test.each(["Again", "Hard", "Good", "Easy"])(
        "a legacy SM-2 card due in four days answered %s",
        (name) => {
            const answered = answers({}, schedule("!2023-09-10,4,270"))[name];
            expect(answered.formatScheduleAsComment()).toBe(expected(`w-legacy-${name}`));
        },
    );

    test("the same card four days overdue: Good gives 21 days", () => {
        const answered = answers({}, schedule("!2023-09-02,4,270")).Good;
        expect(answered.interval).toBe(Number(expected("w-legacy-overdue-good-21d")));
    });

    test("the reset card is due now with nothing remembered, and reports ease 370", () => {
        const reset = new FsrsCardScheduler(DEFAULT_SETTINGS).cardGetResetSchedule();
        expect(reset.formatScheduleAsComment()).toBe(expected("w-reset"));
        expect(reset.latestEase).toBe(Number(expected("w-reset-ease-370")));
    });

    test("the default parameters, in the order the inventory lists them", () => {
        expect(JSON.stringify(buildFsrsParameters(DEFAULT_SETTINGS))).toBe(
            expected("w-default-params"),
        );
    });

    test("an SM-2 card due 2023-09-10 with interval 4 and ease 270 becomes stability 4, difficulty 4.75, 4 days, 2 reviews", () => {
        const card = sm2ScheduleToFsrsCard(schedule("!2023-09-10,4,270"), iso(DEFAULT_CLOCK));
        expect(
            `stab ${card.stability}, diff ${card.difficulty}, sched ${card.scheduled_days}, reps ${card.reps}`,
        ).toBe(expected("w-sm2ToCard-4-270"));
    });
});
