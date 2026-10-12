/* eslint-disable camelcase -- ts-fsrs's card fields are snake_case */
import { CardInput, State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/flashcard";
import {
    difficultyToEase,
    easeToDifficulty,
    FSRS_COMMENT_PREFIX,
    FSRS_EMPTY_SCHEDULE_COMMENT,
    FsrsState,
    isReviewCard,
} from "src/scheduling/schedule/fsrs-state";
import {
    ReviewItemState,
    ReviewItemType,
    ReviewResponse,
} from "src/scheduling/schedule/review-item";
import { ActiveScheduler, IScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { DateUtil, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { loadGolden } from "../golden/load-golden";
import { FsrsInput, fsrsSchedule, ids, mismatches, Slot, sm2Step, view } from "./golden-views";

beforeEach(() => {
    // 2023-09-06 00:00 UTC (the suite runs with TZ=UTC), the clock the golden files were captured with
    setupStaticDateProvider("2023-09-06");
});

// #region -> SM-2 schedule class (sm2-grid.json, scheduleClass)

interface Sm2ClassRow {
    id: string;
    input?: { dueDay?: string | null; delayArgument?: number | string | null; due?: string };
    delayTicks?: number;
    isDue?: boolean | string;
    text?: string;
    dueUnix?: number | string;
}

const sm2 = loadGolden<{ scheduleClass: Sm2ClassRow[] }>("sm2-grid");

/** The delay argument as the golden rows spell it: "@NaN" and "@undefined" stand for those values. */
function delayArgument(value: number | string | null | undefined): number | null | undefined {
    if (value === "@NaN") return NaN;
    if (value === "@undefined") return undefined;
    return value as number | null;
}

describe("the SM-2 schedule class", () => {
    const constructed = sm2.scheduleClass.filter((row) => row.id.startsWith("class/ctor/"));

    test("construction rows: delay, due state, comment text, due time", () => {
        const bad = mismatches(constructed, (row) => {
            const { dueDay, delayArgument: given } = row.input ?? {};
            const due = dueDay ? DateUtil.dateStrToMoment(dueDay) : null;
            const schedule = new Sm2State(due, 4, 270, delayArgument(given));
            const dueUnix = (() => {
                try {
                    return schedule.dueDateAsUnix;
                } catch {
                    return "@throws";
                }
            })();
            return {
                expected: {
                    delayTicks: row.delayTicks,
                    text: row.text,
                    dueUnix: row.dueUnix,
                    ...(due ? { isDue: row.isDue } : {}),
                },
                actual: {
                    delayTicks: schedule.delayedBeforeReviewTicks,
                    text: schedule.formatScheduleAsComment(),
                    dueUnix,
                    ...(due ? { isDue: schedule.isDue() } : {}),
                },
            };
        });
        expect(constructed).toHaveLength(28);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a card is due from its due day on, at the clock's instant", () => {
        const rows = sm2.scheduleClass.filter((row) => row.id.startsWith("class/isDue/"));
        const bad = mismatches(rows, (row) => ({
            expected: row.isDue,
            actual: new Sm2State(DateUtil.dateStrToMoment(row.input?.due), 4, 270).isDue(),
        }));
        expect(rows).toHaveLength(4);
        expect(ids(bad)).toEqual([]);
    });

    test("a schedule with no due date is not due", () => {
        expect(new Sm2State(null, 4, 270).isDue()).toBe(false);
    });

    test("the placeholder date and first interval", () => {
        expect(Sm2State.dummyDueDateForNewCard).toBe("2000-01-01");
        expect(Sm2State.initialInterval).toBe(1);
        expect(Sm2State.fromDueDateStr("2000-01-01", 1, 300).dueDate.toISOString()).toBe(
            "2000-01-01T00:00:00.000Z",
        );
    });

    test("the algorithm type, and the fields callers set", () => {
        const schedule = sm2Step("2023-09-10", 4, 270);
        expect(schedule.algorithmType).toBe(SchedulerKind.SM2);
        schedule.dueDate = DateUtil.dateStrToMoment("2023-09-12");
        expect(schedule.formatScheduleAsComment()).toBe("!2023-09-12,4,270");
    });
});

// #endregion

// #region -> FSRS schedule class (fsrs.json, scheduleClass)

interface FsrsClassRow {
    id: string;
    fields?: Slot;
    toFsrsCardInput?: unknown;
    out?: Slot;
}

const fsrsGolden = loadGolden<{
    scheduleClass: FsrsClassRow[];
    easeDifficultyHelpers: {
        id: string;
        fn: string;
        input: number | string | null;
        out: number | string;
    }[];
}>("fsrs");

function inputOf(fields: Slot): FsrsInput {
    return {
        dueIso: fields.dueIso as string,
        interval: fields.interval as number,
        difficulty: fields.difficulty as number,
        stability: fields.stability as number,
        state: fields.state as State,
        reps: fields.reps as number,
        lapses: fields.lapses as number,
        learningSteps: fields.learningSteps as number,
        lastReviewIso: fields.lastReviewIso as string | null,
    };
}

/** ts-fsrs marks the field deprecated; this schedule class still fills it in. */
const elapsedDays = (card: CardInput): number => Reflect.get(card, "elapsed_days");

describe("the FSRS schedule class", () => {
    const rows = fsrsGolden.scheduleClass.filter((row) => row.fields && row.fields.dueIso);

    test("fields, comment text and the ts-fsrs card for each golden schedule", () => {
        const bad = mismatches(rows, (row) => {
            const schedule = fsrsSchedule(inputOf(row.fields));
            return {
                expected: { fields: row.fields, card: row.toFsrsCardInput },
                actual: {
                    fields: view(schedule),
                    card: JSON.parse(JSON.stringify(schedule.toFsrsCardInput())) as unknown,
                },
            };
        });
        expect(rows).toHaveLength(6);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a schedule with no due date has no delay, and its ease comes from the difficulty", () => {
        const schedule = new FsrsState(null, 0, 5.5, 0.4, State.Learning, 1, 0, 1, null);
        expect([schedule.interval, schedule.latestEase, schedule.delayedBeforeReviewTicks]).toEqual(
            [0, 250, 0],
        );
    });

    test("fromFsrsCard takes dates or text, and a card without a last review", () => {
        const row = fsrsGolden.scheduleClass.find((r) => r.id === "fsrsClass/fromFsrsCard-strings");
        const card = {
            due: "2023-09-06T00:10:00.000Z",
            stability: 0.4,
            difficulty: 5.5,
            elapsed_days: 0,
            scheduled_days: 0,
            learning_steps: 1,
            reps: 1,
            lapses: 0,
            state: State.Learning,
            last_review: "2023-09-06T00:00:00.000Z",
        };
        expect(view(FsrsState.fromFsrsCard(card))).toEqual(row?.out);
        const withDates = FsrsState.fromFsrsCard({
            ...card,
            due: new Date(card.due),
            last_review: undefined,
        });
        expect([withDates.dueDate.toISOString(), withDates.lastReview]).toEqual([card.due, null]);
    });

    test("the ease is worked out when the schedule is built, and the difficulty can change after", () => {
        const schedule = fsrsSchedule(inputOf(rows[0].fields));
        expect(schedule.latestEase).toBe(250);
        schedule.difficulty = 9;
        expect(schedule.latestEase).toBe(250);
    });

    test("a round trip through the card keeps the due time, the last review and the scheduled days", () => {
        const schedule = fsrsSchedule(inputOf(rows[3].fields));
        const back = FsrsState.fromFsrsCard(schedule.toFsrsCardInput());
        expect(view(back)).toEqual(view(schedule));
    });

    test("a review in the future has no elapsed days", () => {
        const schedule = fsrsSchedule({
            ...inputOf(rows[0].fields),
            lastReviewIso: "2023-09-09T00:00:00.000Z",
        });
        expect(elapsedDays(schedule.toFsrsCardInput())).toBe(0);
        expect(elapsedDays(schedule.toFsrsCardInput(moment("2023-09-16T00:00:00.000Z")))).toBe(7);
    });

    test("the algorithm type", () => {
        expect(fsrsSchedule(inputOf(rows[0].fields)).algorithmType).toBe(SchedulerKind.FSRS);
    });
});

// #endregion

// #region -> Ease and difficulty, and the stored FSRS text

describe("ease and difficulty", () => {
    const helpers = fsrsGolden.easeDifficultyHelpers.filter((row) => row.fn !== "clamp");

    test("every golden row", () => {
        const decode = (value: number | string | null): number | null | undefined => {
            if (value === "@NaN") return NaN;
            if (value === "@undefined") return undefined;
            return value as number | null;
        };
        const bad = mismatches(helpers, (row) => {
            const input = decode(row.input);
            const actual =
                row.fn === "easeToDifficulty" ? easeToDifficulty(input) : difficultyToEase(input);
            return { expected: row.out, actual: Number.isNaN(actual) ? "@NaN" : actual };
        });
        expect(helpers).toHaveLength(100);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

describe("the stored FSRS text", () => {
    test("the prefix and the placeholder", () => {
        expect(FSRS_COMMENT_PREFIX).toBe("fsrs");
        expect(FSRS_EMPTY_SCHEDULE_COMMENT).toBe("!fsrs,-,0,0,0,0,0,0,0,-");
        expect(FSRS_EMPTY_SCHEDULE_COMMENT.split(",")).toHaveLength(10);
    });
});

// #endregion

// #region -> The review-card predicate

describe("isReviewCard", () => {
    const fsrsIn = (state: State) =>
        new FsrsState(moment("2023-09-06"), 1, 5, 1, state, 1, 0, 0, null);

    test.each([
        ["New", false, State.New],
        ["Learning", false, State.Learning],
        ["Review", true, State.Review],
        ["Relearning", false, State.Relearning],
    ])("an FSRS card in the %s state: a review card is %s", (_name, expected, state) => {
        expect(isReviewCard(fsrsIn(state))).toBe(expected);
    });

    test("any SM-2 schedule is a review card", () => {
        expect(isReviewCard(sm2Step("2023-09-10", 4, 270))).toBe(true);
        expect(isReviewCard(sm2Step("2023-09-01", 0, 130))).toBe(true);
    });

    test("a card with no schedule is not", () => {
        expect(isReviewCard(null)).toBe(false);
    });
});

// #endregion

// #region -> Enums, the holder and the review item

describe("the enums keep their stored and numbered values", () => {
    test("algorithm names as data.json stores them", () => {
        expect(SchedulerKind.SM2).toBe("SM-2-OSR");
        expect(SchedulerKind.FSRS).toBe("FSRS");
    });

    test("review responses", () => {
        expect([
            ReviewResponse.Easy,
            ReviewResponse.Good,
            ReviewResponse.Hard,
            ReviewResponse.Again,
            ReviewResponse.Reset,
        ]).toEqual([0, 1, 2, 3, 4]);
    });

    test("item states and types", () => {
        expect([ReviewItemState.NewItem, ReviewItemState.DueItem, ReviewItemState.AnyItem]).toEqual(
            [0, 1, 2],
        );
        expect([ReviewItemType.Card, ReviewItemType.Note]).toEqual(["Card", "Note"]);
    });
});

describe("ActiveScheduler", () => {
    afterEach(() => {
        ActiveScheduler.instance = undefined;
    });

    test("refuses to answer before an algorithm is set", () => {
        expect(() => ActiveScheduler.getInstance()).toThrow("there is no scheduler instance.");
    });

    test("hands back the algorithm that was set", () => {
        const algorithm = { algorithmType: SchedulerKind.FSRS } as IScheduler;
        ActiveScheduler.instance = algorithm;
        expect(ActiveScheduler.getInstance()).toBe(algorithm);
    });
});

describe("a card as a review item", () => {
    test("a card without a schedule is new and not due", () => {
        const card = new Card();
        expect([
            card.reviewItemType,
            card.hasSchedule,
            card.isNew,
            card.isDue,
            card.reviewItemState,
        ]).toEqual([ReviewItemType.Card, false, true, false, ReviewItemState.NewItem]);
    });

    test("any scheduled card is a due item, whether or not it is due yet", () => {
        const early = new Card({ scheduleInfo: sm2Step("2023-09-10", 4, 270) });
        const overdue = new Card({ scheduleInfo: sm2Step("2023-09-02", 4, 270) });
        expect([early.hasSchedule, early.isNew, early.isDue, early.reviewItemState]).toEqual([
            true,
            false,
            false,
            ReviewItemState.DueItem,
        ]);
        expect([overdue.isDue, overdue.reviewItemState]).toEqual([true, ReviewItemState.DueItem]);
    });

    test("a reset FSRS card has a schedule, so it is not new", () => {
        const reset = new Card({
            scheduleInfo: fsrsSchedule({
                dueIso: "2023-09-06T00:00:00.000Z",
                interval: 0,
                difficulty: 0,
                stability: 0,
                state: State.New,
                reps: 0,
                lapses: 0,
                learningSteps: 0,
                lastReviewIso: null,
            }),
        });
        expect([reset.isNew, reset.isDue]).toEqual([false, true]);
    });
});

// #endregion
