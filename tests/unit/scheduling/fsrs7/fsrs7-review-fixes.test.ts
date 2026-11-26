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

describe("third review (Gemini)", () => {
    test("5. same-day answers count the time between them: 10 minutes and 8 hours later give different memories", () => {
        const s = new Fsrs7Scheduler({ ...DEFAULT_SETTINGS, fsrsVersion: 7 });
        clockAt("2026-11-01T01:00:00.000Z");
        const first = s.scheduleNew(
            ReviewResponse.Good,
            moment("2026-11-01T01:00:00.000Z"),
            new CardDueDateHistogram(),
            "x.md",
        );
        const after = (iso: string) =>
            s.schedule(first, ReviewResponse.Good, moment(iso), new CardDueDateHistogram());
        const soon = after("2026-11-01T01:10:00.000Z");
        const later = after("2026-11-01T09:00:00.000Z");
        expect(soon.fsrs7?.stabilityFast).not.toBe(first.fsrs7?.stabilityFast);
        expect(soon.fsrs7?.stabilityFast).not.toBe(later.fsrs7?.stabilityFast);
        // Review intervals stay whole days, at least one
        for (const card of [soon, later]) {
            expect(Number.isInteger(card.interval) && card.interval >= 1).toBe(true);
        }
    });

    test("6. hand-edited negative counts or a log time of 0 never throw", () => {
        const card = parse(
            "!fsrs,2026-11-20T12:00:00.000Z,-3,2.3065,2.11810397,2,-1,-2,-1,2026-11-01T12:00:00.000Z",
        );
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
            { stability: 2, stabilityFast: 2 },
        );
        clockAt("2026-11-20T12:00:00.000Z");
        const s = new Fsrs7Scheduler({ ...DEFAULT_SETTINGS, fsrsVersion: 7 });
        for (const r of [ReviewResponse.Again, ...BUTTONS]) {
            expect(() =>
                s.schedule(f7, r, moment("2026-11-20T12:00:00.000Z"), new CardDueDateHistogram()),
            ).not.toThrow();
        }
        expect(() => s.fromHistory(card, [{ t: 0, rating: 3 }])).not.toThrow();
    });
});

test("7. exact time: the interval on a button is the one applied up to 10 minutes later, for 1,000 review cards", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let differences = 0;
    for (let i = 0; i < 1000; i++) {
        const s = new Fsrs7Scheduler({
            ...DEFAULT_SETTINGS,
            fsrsEnableFuzz: i % 2 === 0,
            fsrsVersion: 7,
        });
        const last = Date.parse("2026-01-01T00:00:00Z") + Math.floor(random() * 300 * 86_400_000);
        const interval = 1 + Math.floor(random() * 200);
        const card = new FsrsState(
            moment(last + interval * 86_400_000),
            interval,
            1 + 9 * random(),
            interval,
            2,
            5,
            0,
            0,
            moment(last),
            { stability: interval * (0.5 + random()), stabilityFast: interval * (0.2 + random()) },
        );
        const shownAt = last + interval * 86_400_000 + Math.floor(random() * 3 * 86_400_000);
        for (const r of BUTTONS) {
            // A reviewed card has an id (written with its first answer)
            const shown = s.schedule(
                card,
                r,
                moment(shownAt),
                new CardDueDateHistogram(),
                `card-${i}`,
            );
            const applied = s.schedule(
                card,
                r,
                moment(shownAt + 600_000),
                new CardDueDateHistogram(),
                `card-${i}`,
            );
            if (shown.interval !== applied.interval) differences++;
            expect(applied.lastReview?.valueOf()).toBe(shownAt + 600_000);
        }
    }
    expect(differences).toBe(0);
});

describe("confirmation review (Codex)", () => {
    const A =
        "!fsrs,2026-12-24T12:00:00.000Z,53,53.86951316,1,2,1,0,0,2026-11-01T12:00:00.000Z,f7=11.7841:9.42728:53.86951316:1:1:1793534400000";
    const withFields = (text: string, fast: number, lapses: number) =>
        text
            .replace(",2,1,0,0,", `,2,1,${lapses},0,`)
            .replace("f7=11.7841:9.42728:", `f7=11.7841:${fast}:`);
    const good = (s: FsrsCardScheduler, text: string, id: string, at: string) => {
        clockAt(at);
        return s.cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            parse(text),
            new CardDueDateHistogram(),
            id,
        ) as FsrsState;
    };

    test("8. answers kept for one card are never given to another card, or to the same card with other values", () => {
        const s = v(7);
        good(s, A, "card-a", "2026-11-09T12:00:00.000Z");
        const B = withFields(A, 100, 7);
        expect(parse(B).fsrs7).not.toBeNull();
        const cached = good(s, B, "card-b", "2026-11-09T12:01:00.000Z");
        const fresh = good(v(7), B, "card-b", "2026-11-09T12:01:00.000Z");
        expect(cached.formatScheduleAsComment()).toBe(fresh.formatScheduleAsComment());
        expect(cached.lapses).toBe(7);
        // The same id with changed memory is not the same card either
        const C = withFields(A, 100, 0);
        expect(good(s, C, "card-a", "2026-11-09T12:02:00.000Z").formatScheduleAsComment()).toBe(
            good(v(7), C, "card-a", "2026-11-09T12:02:00.000Z").formatScheduleAsComment(),
        );
    });

    test("9. a due date or last review at 1 January 1970 does not throw", () => {
        for (const text of [
            A.replace("2026-12-24T12:00:00.000Z", "1970-01-01T00:00:00.000Z"),
            A.replace(",2026-11-01T12:00:00.000Z,", ",1970-01-01T00:00:00.000Z,").replace(
                ":1793534400000",
                ":0",
            ),
        ]) {
            expect(() => good(v(7), text, "card-a", "2026-11-09T12:01:00.000Z")).not.toThrow();
        }
    });

    test("10. with load balancing and an easy day, the interval shown before midnight is applied after it", () => {
        const settings = { fsrsLoadBalance: true, fsrsEasyDays: [1] };
        const card = A.replace(",2,1,0,0,", ",2,2,0,0,").replace(
            "f7=11.7841:9.42728:53.86951316:1:1:",
            "f7=11.7841:16:53.86951316:1:2:",
        );
        expect(parse(card).fsrs7).not.toBeNull();
        const s = v(7, settings);
        const shown = good(s, card, "card-a", "2026-11-08T23:55:00.000Z");
        const applied = good(s, card, "card-a", "2026-11-09T00:05:00.000Z");
        expect(applied.interval).toBe(shown.interval);
    });
});

describe("second confirmation review (Codex)", () => {
    const A =
        "!fsrs,2026-12-24T12:00:00.000Z,53,53.86951316,1,2,1,0,0,2026-11-01T12:00:00.000Z,f7=11.7841:9.42728:53.86951316:1:1:1793534400000";

    test("11. a second new card in the same note gets its own balanced day", () => {
        const settings = { fsrsLoadBalance: true };
        const histogram = new CardDueDateHistogram();
        const reused = v(7, settings);
        clockAt("2026-11-09T12:00:00.000Z");
        const first = reused.cardGetNewSchedule(ReviewResponse.Easy, "two-cards.md", histogram);
        histogram.increment(first.interval);
        clockAt("2026-11-09T12:01:00.000Z");
        const second = reused.cardGetNewSchedule(ReviewResponse.Easy, "two-cards.md", histogram);
        const fresh = v(7, settings).cardGetNewSchedule(
            ReviewResponse.Easy,
            "two-cards.md",
            histogram,
        );
        expect(second.formatScheduleAsComment()).toBe(fresh.formatScheduleAsComment());
    });

    test("12. cards without an id never share answers", () => {
        const s = v(7);
        clockAt("2026-11-09T12:00:00.000Z");
        s.cardCalcUpdatedSchedule(ReviewResponse.Good, parse(A), new CardDueDateHistogram(), null);
        clockAt("2026-11-09T12:01:00.000Z");
        const b = s.cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            parse(A),
            new CardDueDateHistogram(),
            null,
        );
        const fresh = v(7).cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            parse(A),
            new CardDueDateHistogram(),
            null,
        );
        expect(b.formatScheduleAsComment()).toBe(fresh.formatScheduleAsComment());
    });

    test("13. a reviewed FSRS-7 card without a last review date does not throw", () => {
        const text =
            "!fsrs,2026-12-24T12:00:00.000Z,53,53.86951316,1,2,1,0,0,-,f7=11.7841:9.42728:53.86951316:1:1:-";
        expect(parse(text).fsrs7).not.toBeNull();
        clockAt("2026-11-09T12:01:00.000Z");
        expect(() =>
            v(7).cardCalcUpdatedSchedule(
                ReviewResponse.Good,
                parse(text),
                new CardDueDateHistogram(),
                "edge",
            ),
        ).not.toThrow();
    });
});
