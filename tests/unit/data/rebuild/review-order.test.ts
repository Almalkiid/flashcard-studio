import { default_w as DEFAULT_WEIGHTS, forgetting_curve as forgettingCurve, State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import { cloneDefaultSettings } from "src/data/settings-model";
import { createCardRisk, reviewOrderOf } from "src/scheduling/review/review-order";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

const DAY = 86_400_000;
const NOW = Date.UTC(2023, 8, 6, 12);

const fsrsCard = (stability: number, lastReviewDaysAgo: number | null, interval = 10): Card => {
    const last = lastReviewDaysAgo === null ? null : moment(NOW - lastReviewDaysAgo * DAY);
    const schedule = new FsrsState(
        moment(NOW),
        interval,
        5,
        stability,
        State.Review,
        3,
        0,
        0,
        last,
    );
    return new Card({ front: "f", back: "b", scheduleInfo: schedule });
};

const sm2Card = (interval: number, dueDaysFromNow: number): Card =>
    new Card({
        front: "s",
        back: "b",
        scheduleInfo: new Sm2State(moment(NOW + dueDaysFromNow * DAY), interval, 250),
    });

describe("createCardRisk", () => {
    const risk = createCardRisk(cloneDefaultSettings(), NOW);

    test("an FSRS card is the chance of recall from its stability and the time since its last review", () => {
        expect(risk(fsrsCard(10, 10))).toBeCloseTo(forgettingCurve(DEFAULT_WEIGHTS, 10, 10), 10);
        expect(risk(fsrsCard(10, 10))).toBeCloseTo(0.9, 2);
    });

    test("a longer wait or a lower stability is more at risk", () => {
        expect(risk(fsrsCard(10, 20))).toBeLessThan(risk(fsrsCard(10, 10)));
        expect(risk(fsrsCard(5, 10))).toBeLessThan(risk(fsrsCard(10, 10)));
    });

    test("a card never ahead of its last review: waiting less than none is no risk", () => {
        expect(risk(fsrsCard(10, -3))).toBe(1);
    });

    test("an SM-2 card is rated like a card whose stability is its interval", () => {
        // Four days interval, due a day ago: five days since it was scheduled
        expect(risk(sm2Card(4, -1))).toBeCloseTo(forgettingCurve(DEFAULT_WEIGHTS, 5, 4), 10);
    });

    test("SM-2 cards go by relative overdueness: the same lateness hurts a short interval more", () => {
        expect(risk(sm2Card(2, -2))).toBeLessThan(risk(sm2Card(20, -2)));
        expect(risk(sm2Card(10, -10))).toBeCloseTo(risk(sm2Card(100, -100)), 10);
    });

    test("an FSRS card without a memory state is rated by its interval as an SM-2 card is", () => {
        const card = fsrsCard(0, null, 6);
        expect(risk(card)).toBeCloseTo(forgettingCurve(DEFAULT_WEIGHTS, 6, 6), 10);
    });

    test("a card with no usable date has no risk it can be ranked by", () => {
        const card = new Card({
            front: "x",
            back: "y",
            scheduleInfo: new Sm2State(moment.invalid(), 4, 250),
        });
        expect(risk(card)).toBeNaN();
        expect(risk(new Card({ front: "n", back: "n" }))).toBe(Infinity);
    });

    test("the weights of the settings are used when they are valid", () => {
        const settings = cloneDefaultSettings();
        const custom = [...DEFAULT_WEIGHTS];
        custom[20] = 0.3;
        settings.fsrsWeights = custom.join(", ");
        // Past the stability the curve's shape matters
        expect(createCardRisk(settings, NOW)(fsrsCard(10, 30))).not.toBeCloseTo(
            risk(fsrsCard(10, 30)),
            3,
        );
        settings.fsrsWeights = "not numbers";
        expect(createCardRisk(settings, NOW)(fsrsCard(10, 30))).toBeCloseTo(
            risk(fsrsCard(10, 30)),
            10,
        );
    });
});

describe("reviewOrderOf", () => {
    test("reads the setting, and anything unknown is the due date order", () => {
        expect(reviewOrderOf("mostAtRisk")).toBe("mostAtRisk");
        expect(reviewOrderOf("dueDate")).toBe("dueDate");
        expect(reviewOrderOf("nonsense")).toBe("dueDate");
        expect(reviewOrderOf(undefined)).toBe("dueDate");
    });
});
