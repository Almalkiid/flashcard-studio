import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { Fsrs7Scheduler } from "src/scheduling/fsrs7/fsrs7-scheduler";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { moment } from "src/utils/moment-en";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt, DEFAULT_CLOCK } from "../fsrs/clock-at";

/** Independent review findings on the FSRS-7 branch (26 Nov 2026), with the reviewer's exact inputs. */
const parse = (text: string) => CommentParser.parseMultiScheduleComment(text)[0] as FsrsState;
const v = (version: 6 | 7, s: Partial<StudioSettings> = {}) =>
    new FsrsCardScheduler({ ...DEFAULT_SETTINGS, ...s, fsrsVersion: version });
const answer = (s: FsrsCardScheduler, card: ScheduleState, response: ReviewResponse) =>
    s.cardCalcUpdatedSchedule(response, card, new CardDueDateHistogram()) as FsrsState;
const BUTTONS = [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy];

afterEach(() => clockAt(DEFAULT_CLOCK));

test("1. an older version's Hard answer keeps S90 but not the review: the old FSRS-7 traces are not used", () => {
    clockAt("2026-11-01T12:00:00.000Z");
    const learnt = v(7).cardGetNewSchedule(
        ReviewResponse.Good,
        "x.md",
        new CardDueDateHistogram(),
    ) as FsrsState;
    const token = learnt.formatScheduleAsComment().match(/,f7=.*$/)?.[0] ?? "";
    // What 0.21.1 writes: its own FSRS-6 answer, with the unknown token kept at the end
    clockAt("2026-11-01T12:01:00.000Z");
    const old = answer(
        v(6),
        parse(learnt.formatScheduleAsComment().replace(/,f7=.*$/, "")),
        ReviewResponse.Hard,
    );
    const rewritten = parse(old.formatScheduleAsComment() + token);
    expect(rewritten.stability).toBe(learnt.stability);
    expect(rewritten.fsrs7).toBeNull();
});

test("2. load balancing keeps Hard ≤ Good ≤ Easy within the maximum (ties allowed at the cap)", () => {
    const card = (reps: number) =>
        parse(
            `!fsrs,2026-12-24T12:00:00.000Z,53,53.86951316,1,2,${reps},0,0,2026-11-01T12:00:00.000Z`,
        );
    const settings = (maximumInterval: number) => ({
        fsrsEnableFuzz: true,
        fsrsLoadBalance: true,
        maximumInterval,
    });
    for (const [reps, maximum, at] of [
        [1, 3, "2026-11-09T12:00:00.000Z"],
        [8, 4, "2026-11-02T12:00:00.000Z"],
        [1, 30, "2026-11-20T12:00:00.000Z"],
        [3, 1, "2026-11-20T12:00:00.000Z"],
    ] as const) {
        clockAt(at);
        const s = new Fsrs7Scheduler({ ...DEFAULT_SETTINGS, ...settings(maximum), fsrsVersion: 7 });
        const base = card(reps);
        const f7 = new FsrsState(
            base.dueDate,
            base.interval,
            base.difficulty,
            base.stability,
            base.state,
            base.reps,
            base.lapses,
            base.learningSteps,
            base.lastReview,
            { stability: 11.7841, stabilityFast: 9.42728 },
        );
        const days = BUTTONS.map(
            (r) => s.schedule(f7, r, moment(at), new CardDueDateHistogram()).interval,
        );
        expect([reps, maximum, days.every((d) => d <= maximum)]).toEqual([reps, maximum, true]);
        expect([reps, maximum, days[0] <= days[1] && days[1] <= days[2]]).toEqual([
            reps,
            maximum,
            true,
        ]);
    }
});

test("3. a card moved from FSRS-6 keeps its learning state, step, counts and times; only its memory is rebuilt", () => {
    const card = parse(
        "!fsrs,2026-11-01T12:10:00.000Z,0,2.3065,2.11810397,1,1,0,1,2026-11-01T12:00:00.000Z",
    );
    const s = new Fsrs7Scheduler({ ...DEFAULT_SETTINGS, fsrsLearningSteps: "1m", fsrsVersion: 7 });
    const moved = s.fromHistory(card, [{ t: Date.parse("2026-11-01T12:00:00.000Z"), rating: 3 }]);
    expect(moved).not.toBeNull();
    expect([
        moved?.state,
        moved?.learningSteps,
        moved?.reps,
        moved?.lapses,
        moved?.interval,
    ]).toEqual([1, 1, 1, 0, 0]);
    expect([moved?.dueDateAsUnix, moved?.lastReview?.valueOf()]).toEqual([
        card.dueDateAsUnix,
        card.lastReview?.valueOf(),
    ]);
    clockAt("2026-11-01T12:10:00.000Z");
    const again = s.schedule(
        moved,
        ReviewResponse.Again,
        moment("2026-11-01T12:10:00.000Z"),
        new CardDueDateHistogram(),
    );
    expect([again.state, again.lapses]).toEqual([1, 0]);
});

test("4. a last review after the answer time (a clock behind) gives finite schedules for every button", () => {
    const card = parse(
        "!fsrs,2026-12-24T12:00:00.000Z,53,53.86951316,1,2,1,0,0,2026-11-01T12:00:00.000Z,f7=11.7841:9.42728:53.86951316",
    );
    // The token in this text is the old three-part form, so build the FSRS-7 card directly
    const f7 = new FsrsState(
        card.dueDate,
        card.interval,
        card.difficulty,
        card.stability,
        card.state,
        card.reps,
        card.lapses,
        card.learningSteps,
        card.lastReview,
        { stability: 11.7841, stabilityFast: 9.42728 },
    );
    for (const at of ["2026-10-31T12:00:00.000Z", "2026-11-01T08:00:00.000Z"]) {
        clockAt(at);
        const s = new Fsrs7Scheduler({ ...DEFAULT_SETTINGS, fsrsVersion: 7 });
        for (const r of [ReviewResponse.Again, ...BUTTONS]) {
            const next = s.schedule(f7, r, moment(at), new CardDueDateHistogram());
            expect(Number.isFinite(next.interval) && Number.isFinite(next.stability)).toBe(true);
        }
    }
});
