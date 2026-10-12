import { FSRS, fsrs, Rating, State } from "ts-fsrs";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import type { INoteEaseList } from "src/note-review/note-ease-list";
import { CardDueDateHistogram, NoteDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { buildFsrsParameters } from "src/scheduling/fsrs/fsrs-settings";
import { sm2ScheduleToFsrsCard } from "src/scheduling/fsrs/sm2-to-fsrs-card";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import type { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt, DEFAULT_CLOCK, iso } from "./clock-at";

jest.mock("src/scheduling/sm2/sm2-scheduler");

const histogram = new CardDueDateHistogram();
const BUTTONS = [
    ReviewResponse.Again,
    ReviewResponse.Hard,
    ReviewResponse.Good,
    ReviewResponse.Easy,
];

// A review card with a month behind it, due today
const REVIEW_CARD = "!fsrs,2023-09-06T00:00:00.000Z,30,30,5.5,2,5,0,0,2023-08-07T00:00:00.000Z";
const reviewCard = (): FsrsState =>
    CommentParser.parseMultiScheduleComment(REVIEW_CARD)[0] as FsrsState;

beforeEach(() => {
    clockAt(DEFAULT_CLOCK);
    jest.restoreAllMocks();
});

describe("one scheduler call per card shown", () => {
    test("the four buttons of one card share a single repeat, and next is never used", () => {
        const repeat = jest.spyOn(FSRS.prototype, "repeat");
        const next = jest.spyOn(FSRS.prototype, "next");
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const card = reviewCard();

        const previews = BUTTONS.map((button) =>
            algorithm.cardCalcUpdatedSchedule(button, card, histogram),
        );

        expect(repeat).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
        // and they are four different answers, not one answer four times
        expect(new Set(previews.map((p) => p.formatScheduleAsComment())).size).toBe(4);
    });

    test("the same holds for a card that was never reviewed", () => {
        const repeat = jest.spyOn(FSRS.prototype, "repeat");
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        BUTTONS.forEach((button) => algorithm.cardGetNewSchedule(button, "n.md", histogram));
        expect(repeat).toHaveBeenCalledTimes(1);
    });

    test("with load balancing on, a preview and its later answer choose the same interval", () => {
        const settings = { ...DEFAULT_SETTINGS, fsrsLoadBalance: true };
        const unbalanced = new FsrsCardScheduler(DEFAULT_SETTINGS).cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            reviewCard(),
            histogram,
        );
        const busy = new CardDueDateHistogram({ [unbalanced.interval]: 10_000 });
        const algorithm = new FsrsCardScheduler(settings);
        const card = reviewCard();

        const preview = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, busy);
        expect(preview.interval).not.toBe(unbalanced.interval);
        clockAt("2023-09-06T12:00:00.000Z");
        const applied = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, busy);

        expect(applied.interval).toBe(preview.interval);
    });

    test("a card with a different schedule gets its own repeat; an identical one shares it", () => {
        const repeat = jest.spyOn(FSRS.prototype, "repeat");
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const answer = (text: string) =>
            algorithm.cardCalcUpdatedSchedule(
                ReviewResponse.Good,
                CommentParser.parseMultiScheduleComment(text)[0],
                histogram,
            );
        answer(REVIEW_CARD);
        answer(REVIEW_CARD);
        expect(repeat).toHaveBeenCalledTimes(1);
        answer(REVIEW_CARD.replace(",30,5.5,", ",31,5.5,"));
        expect(repeat).toHaveBeenCalledTimes(2);
    });

    test("a schedule changed in place is not answered from what was worked out before", () => {
        const repeat = jest.spyOn(FSRS.prototype, "repeat");
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const card = reviewCard();
        const text = (): string =>
            algorithm
                .cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram)
                .formatScheduleAsComment();
        const before = text();

        card.stability = 5;
        const afterStability = text();
        card.lastReview = card.lastReview.clone().subtract(10, "days");
        const afterLastReview = text();

        expect(repeat).toHaveBeenCalledTimes(3);
        expect(new Set([before, afterStability, afterLastReview]).size).toBe(3);
    });

    test("an outcome is never carried across midnight (UTC): the interval depends on the days passed", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const card = reviewCard();
        const intervalAt = (at: string, who = algorithm): number => {
            clockAt(at);
            return who.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram).interval;
        };
        const preview = intervalAt("2023-09-05T23:59:59.500Z");
        // The same card, a moment later but on the next day, asked by an algorithm that has seen nothing before
        const fresh = intervalAt(
            "2023-09-06T00:00:00.300Z",
            new FsrsCardScheduler(DEFAULT_SETTINGS),
        );
        expect(fresh).not.toBe(preview);

        expect(intervalAt("2023-09-06T00:00:00.300Z")).toBe(fresh);
    });

    test("an answer given later is worked out from the time it is given", () => {
        const repeat = jest.spyOn(FSRS.prototype, "repeat");
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const card = reviewCard();
        algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);

        clockAt("2023-09-06T00:00:08.000Z");
        const answered = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);

        expect(repeat).toHaveBeenCalledTimes(2);
        expect(answered.formatScheduleAsComment()).toContain("2023-09-06T00:00:08.000Z");
    });

    test("changing the settings drops what was worked out for the card on screen", () => {
        const settings = { ...DEFAULT_SETTINGS };
        const algorithm = new FsrsCardScheduler(settings);
        const card = reviewCard();
        const before = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);

        settings.fsrsDesiredRetention = 0.8;
        algorithm.updateParameters(settings);
        const after = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);

        expect(after.interval).toBeGreaterThan(before.interval);
    });

    test("every answer is its own object: changing one does not change the next", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const card = reviewCard();
        const first = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);
        const text = first.formatScheduleAsComment();
        first.dueDate.add(100, "days");
        first.interval = -1;

        const second = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram);
        expect(second).not.toBe(first);
        expect(second.formatScheduleAsComment()).toBe(text);
    });
});

describe("a last review in the future never throws (decision D5a)", () => {
    test("an SM-2 card not yet due, whose interval is shorter than the days left, is scheduled as a review", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        // Due in 4 days with an interval of 1 (a postponed card): its last review would lie 3 days from now
        const card = CommentParser.parseScheduleSegment("2023-09-10,1,250");
        expect(card).toBeInstanceOf(Sm2State);

        const answers = BUTTONS.map(
            (button) => algorithm.cardCalcUpdatedSchedule(button, card, histogram) as FsrsState,
        );

        expect(answers.map((answer) => answer.state)).toEqual([
            State.Relearning,
            State.Review,
            State.Review,
            State.Review,
        ]);
        expect(answers.every((answer) => answer.lastReview.toISOString() === DEFAULT_CLOCK)).toBe(
            true,
        );
        // Easy, Good and Hard keep their order, as for any review card
        const [, hard, good, easy] = answers;
        expect(easy.interval).toBeGreaterThan(good.interval);
        expect(good.interval).toBeGreaterThan(hard.interval);
    });

    test("with fuzz on, the interval of a converted card is the same all day, so the button shows what is applied", () => {
        const algorithm = new FsrsCardScheduler({ ...DEFAULT_SETTINGS, fsrsEnableFuzz: true });
        // Due in 20 days with an interval of 3: its last review lies 17 days ahead
        const card = CommentParser.parseScheduleSegment("2023-09-26,3,250");
        const easyAt = (at: string): number => {
            clockAt(at);
            return algorithm.cardCalcUpdatedSchedule(ReviewResponse.Easy, card, histogram).interval;
        };
        const intervals = [
            "2023-09-06T00:00:00.000Z",
            "2023-09-06T05:17:42.250Z",
            "2023-09-06T12:00:00.000Z",
            "2023-09-06T23:59:59.999Z",
        ].map(easyAt);
        expect(new Set(intervals).size).toBe(1);
        expect(intervals[0]).toBeGreaterThanOrEqual(3);
    });

    test("so is an FSRS card whose last review is days ahead of this device's clock", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const ahead = CommentParser.parseMultiScheduleComment(
            "!fsrs,2023-09-20T00:00:00.000Z,14,14,5.5,2,5,0,0,2023-09-09T00:00:00.000Z",
        )[0];
        expect(() =>
            algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, ahead, histogram),
        ).not.toThrow();
    });

    test("a last review later today is left alone, so the fuzz seed of such a card does not move", () => {
        const algorithm = new FsrsCardScheduler({ ...DEFAULT_SETTINGS, fsrsEnableFuzz: true });
        const text = "!fsrs,2023-10-16T00:00:00.000Z,40,40,5,2,8,0,0,2023-09-06T02:00:00.000Z";
        const answered = (at: string): number => {
            clockAt(at);
            return algorithm.cardCalcUpdatedSchedule(
                ReviewResponse.Good,
                CommentParser.parseMultiScheduleComment(text)[0],
                histogram,
            ).interval;
        };
        // Same UTC day, so ts-fsrs counts no days between the reviews; the seed holds the 02:00 review time
        expect(answered("2023-09-06T01:00:00.000Z")).toBe(answered("2023-09-06T01:00:30.000Z"));
    });
});

describe("ts-fsrs 5.4.2 limits the default weights to the number of relearning steps", () => {
    // A review card answered the same day it was last reviewed, so ts-fsrs uses w[17] and w[18] for its new stability
    const SAME_DAY_CARD =
        "!fsrs,2023-09-07T00:00:00.000Z,1,0.5,5.5,2,5,0,0,2023-09-06T00:00:00.000Z";
    const stabilityAfterGood = (relearningSteps: string): number => {
        const algorithm = new FsrsCardScheduler({
            ...DEFAULT_SETTINGS,
            fsrsRelearningSteps: relearningSteps,
        });
        const card = CommentParser.parseMultiScheduleComment(SAME_DAY_CARD)[0];
        return (
            algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, card, histogram) as FsrsState
        ).stability;
    };

    test("one or two relearning steps change nothing", () => {
        expect(stabilityAfterGood("10m 20m")).toBe(stabilityAfterGood("10m"));
    });

    test("three steps lower w[17], so a same-day answer adds less stability (5.4.1 gave the same as for one step)", () => {
        expect(stabilityAfterGood("5m 20m 1h")).toBeLessThan(stabilityAfterGood("10m"));
    });
});

describe("no schedule at hand", () => {
    test("an update asked for without a schedule converts none (inventory 6.4), it is not a first answer", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const now = globalNow();
        const expected = FsrsState.fromFsrsCard(
            fsrs(buildFsrsParameters(DEFAULT_SETTINGS)).next(
                sm2ScheduleToFsrsCard(null, iso(DEFAULT_CLOCK)),
                now,
                Rating.Good,
            ).card,
        );

        const updated = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Good, null, histogram);
        const first = algorithm.cardGetNewSchedule(ReviewResponse.Good, "n.md", histogram);

        expect(updated.formatScheduleAsComment()).toBe(expected.formatScheduleAsComment());
        expect((updated as FsrsState).state).toBe(State.Review);
        expect((first as FsrsState).state).toBe(State.Learning);
    });
});

describe("an SM-2 schedule without a due date", () => {
    test("is converted as of now and answered like any card", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const answered = algorithm.cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            new Sm2State(null, 4, 270),
            histogram,
        ) as FsrsState;
        expect(answered.state).toBe(State.Review);
        expect(answered.interval).toBeGreaterThanOrEqual(1);
    });
});

describe("reset", () => {
    test("a reset card is due now, state New, with nothing remembered", () => {
        const reset = new FsrsCardScheduler(DEFAULT_SETTINGS).cardGetResetSchedule();
        expect(reset.formatScheduleAsComment()).toBe(`!fsrs,${DEFAULT_CLOCK},0,0,0,0,0,0,0,-`);
        expect(reset).toBeInstanceOf(FsrsState);
        expect((reset as FsrsState).lastReview).toBeNull();
        expect(reset.isDue()).toBe(true);
    });

    test("the Reset button is no answer: the grade lookup refuses it", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        expect(() =>
            algorithm.cardCalcUpdatedSchedule(ReviewResponse.Reset, reviewCard(), histogram),
        ).toThrow("Unsupported FSRS response: 4");
        expect(() => algorithm.cardGetNewSchedule(ReviewResponse.Reset, "n.md", histogram)).toThrow(
            "Unsupported FSRS response: 4",
        );
    });
});

describe("notes stay SM-2", () => {
    // The SM-2 class is Task 3's; what matters here is that every note call goes to the one helper, untouched
    const helper = (): Record<string, jest.Mock> =>
        jest.mocked(Sm2Scheduler).mock.instances[0] as unknown as Record<string, jest.Mock>;

    beforeEach(() => {
        jest.mocked(Sm2Scheduler).mockClear();
    });

    test("the algorithm says it is FSRS and builds one SM-2 helper from the settings", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        expect(algorithm.algorithmType).toBe(SchedulerKind.FSRS);
        expect(Sm2Scheduler).toHaveBeenCalledTimes(1);
        expect(Sm2Scheduler).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });

    test("noteCalcNewSchedule, noteCalcUpdatedSchedule, noteOnLoadedNote and noteStats are the helper's", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        const sm2 = helper();
        const created = {} as ScheduleState;
        const updated = {} as ScheduleState;
        const easeList = {} as INoteEaseList;
        sm2.noteCalcNewSchedule.mockReturnValue(created);
        sm2.noteCalcUpdatedSchedule.mockReturnValue(updated);
        sm2.noteStats.mockReturnValue(easeList);
        const graph = {} as NoteLinkGraph;
        const notes = new NoteDueDateHistogram();
        const old = {} as ScheduleState;

        expect(algorithm.noteCalcNewSchedule("n.md", graph, ReviewResponse.Hard, notes)).toBe(
            created,
        );
        expect(sm2.noteCalcNewSchedule).toHaveBeenCalledWith(
            "n.md",
            graph,
            ReviewResponse.Hard,
            notes,
        );
        expect(algorithm.noteCalcUpdatedSchedule("n.md", old, ReviewResponse.Easy, notes)).toBe(
            updated,
        );
        expect(sm2.noteCalcUpdatedSchedule).toHaveBeenCalledWith(
            "n.md",
            old,
            ReviewResponse.Easy,
            notes,
        );
        expect(algorithm.noteStats()).toBe(easeList);
        algorithm.noteOnLoadedNote("n.md", null, 273.4);
        expect(sm2.noteOnLoadedNote).toHaveBeenCalledWith("n.md", null, 273.4);
    });

    test("updateParameters leaves the helper, and so the note ease list, alone", () => {
        const algorithm = new FsrsCardScheduler(DEFAULT_SETTINGS);
        algorithm.updateParameters({ ...DEFAULT_SETTINGS, fsrsDesiredRetention: 0.8 });
        expect(Sm2Scheduler).toHaveBeenCalledTimes(1);
    });
});

function globalNow(): Date {
    return new Date(DEFAULT_CLOCK);
}
