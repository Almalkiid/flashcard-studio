import type { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { fsrs7Histories } from "src/scheduling/fsrs7/fsrs7-history";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt, DEFAULT_CLOCK } from "../fsrs/clock-at";

const NOW = "2026-11-26T12:00:00.000Z";
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");

const scheduler = (settings: Partial<StudioSettings>) =>
    new FsrsCardScheduler({ ...DEFAULT_SETTINGS, ...settings });
const v6 = (s: Partial<StudioSettings> = {}) => scheduler({ ...s, fsrsVersion: 6 });
const v7 = (s: Partial<StudioSettings> = {}) => scheduler({ ...s, fsrsVersion: 7 });
const parse = (text: string) => CommentParser.parseMultiScheduleComment(text)[0];
const at = (iso: string) => clockAt(iso);
const answer = (
    s: FsrsCardScheduler,
    schedule: ScheduleState,
    response = ReviewResponse.Good,
    cardId?: string,
) => s.cardCalcUpdatedSchedule(response, schedule, new CardDueDateHistogram(), cardId) as FsrsState;
const entry = (t: number, r: 1 | 2 | 3 | 4, k: 0 | 1 | 2 | 3 | 4): ReviewLogEntry => ({
    t,
    c: "k3f9a2",
    r,
    k,
    ivl: 0,
    li: 0,
    ms: 1000,
    dk: "deck",
    f: "x.md",
});

/** An FSRS-6 card learned at T0 (Good, Good) and reviewed Good on day 4, as FSRS-6 wrote it. */
function fsrs6CardAndLog(): { card: FsrsState; log: ReviewLogEntry[] } {
    const s = v6();
    at(new Date(T0).toISOString());
    let card = s.cardGetNewSchedule(ReviewResponse.Good, "x.md", new CardDueDateHistogram());
    at(new Date(T0 + 10 * MIN).toISOString());
    card = answer(s, card);
    at(new Date(T0 + 4 * DAY).toISOString());
    card = answer(s, card);
    const log = [entry(T0, 3, 0), entry(T0 + 10 * MIN, 3, 0), entry(T0 + 4 * DAY, 3, 1)];
    return { card: card as FsrsState, log };
}

afterEach(() => clockAt(DEFAULT_CLOCK));

describe("FSRS-6 or FSRS-7 per answer (issue #27)", () => {
    test("FSRS-6 mode: a new card has no FSRS-7 memory", () => {
        at(NOW);
        const card = v6().cardGetNewSchedule(
            ReviewResponse.Good,
            "x.md",
            new CardDueDateHistogram(),
        );
        expect((card as FsrsState).fsrs7).toBeNull();
    });

    test("FSRS-7 mode: a new card is scheduled with FSRS-7 and its comment reads back the same", () => {
        at(NOW);
        const card = v7().cardGetNewSchedule(
            ReviewResponse.Good,
            "x.md",
            new CardDueDateHistogram(),
        ) as FsrsState;
        expect(card.fsrs7).not.toBeNull();
        expect(card.dueDateAsUnix).toBe(Date.parse(NOW) + 10 * MIN);
        const text = card.formatScheduleAsComment();
        expect((parse(text) as FsrsState).fsrs7).toEqual(card.fsrs7);
        expect(parse(text)!.formatScheduleAsComment()).toBe(text);
    });

    test("FSRS-7 mode: an FSRS-7 card stays FSRS-7, and a reset card starts again on FSRS-7", () => {
        at(NOW);
        const s = v7();
        let card = s.cardGetNewSchedule(ReviewResponse.Good, "x.md", new CardDueDateHistogram());
        at("2026-11-26T12:10:00.000Z");
        card = answer(s, card);
        expect([(card as FsrsState).state, (card as FsrsState).fsrs7 !== null]).toEqual([2, true]);
        const reset = s.cardGetResetSchedule();
        at("2026-11-26T12:20:00.000Z");
        expect(answer(s, reset).fsrs7).not.toBeNull();
    });

    test("FSRS-7 mode: an FSRS-6 card without its history stays FSRS-6, exactly as in FSRS-6 mode", () => {
        const { card } = fsrs6CardAndLog();
        at("2026-11-20T12:00:00.000Z");
        const seven = answer(v7(), card, ReviewResponse.Good, "k3f9a2");
        const six = answer(v6(), card, ReviewResponse.Good, "k3f9a2");
        expect(seven.formatScheduleAsComment()).toBe(six.formatScheduleAsComment());
        expect(seven.fsrs7).toBeNull();
    });

    test("FSRS-7 mode: an FSRS-6 card whose whole history is logged moves to FSRS-7, its memory rebuilt", () => {
        const { card, log } = fsrs6CardAndLog();
        const s = v7();
        s.setReviewHistory(fsrs7Histories(log));
        at("2026-11-20T12:00:00.000Z");
        const moved = answer(s, card, ReviewResponse.Good, "k3f9a2");
        expect(moved.fsrs7).not.toBeNull();
        expect(moved.reps).toBe(card.reps + 1);
        // Another card id, or a history that does not end at the card's last review, is not used
        expect(answer(s, card, ReviewResponse.Good, "other").fsrs7).toBeNull();
        s.setReviewHistory(fsrs7Histories(log.slice(0, 2)));
        expect(answer(s, card, ReviewResponse.Good, "k3f9a2").fsrs7).toBeNull();
    });

    test("a history is complete only from a learning answer or a reset; cram and manual entries are skipped", () => {
        const learnt = [entry(T0, 3, 0), entry(T0 + DAY, 3, 3), entry(T0 + 2 * DAY, 2, 1)];
        expect(fsrs7Histories(learnt).get("k3f9a2")).toEqual([
            { t: T0, rating: 3 },
            { t: T0 + 2 * DAY, rating: 2 },
        ]);
        expect(fsrs7Histories([entry(T0, 3, 1)]).has("k3f9a2")).toBe(false);
        const reset = { ...entry(T0 + DAY, 3, 4), r: 0 as const, s: 0 };
        expect(
            fsrs7Histories([entry(T0, 3, 1), reset, entry(T0 + 2 * DAY, 4, 0)]).get("k3f9a2"),
        ).toEqual([{ t: T0 + 2 * DAY, rating: 4 }]);
    });

    test("FSRS-7 mode: an SM-2 card is answered as in FSRS-6 mode", () => {
        const sm2 = new Sm2State(moment("2026-11-26"), 10, 250);
        at(NOW);
        expect(answer(v7(), sm2).formatScheduleAsComment()).toBe(
            answer(v6(), sm2).formatScheduleAsComment(),
        );
    });

    test("FSRS-6 mode: an FSRS-7 card is answered as FSRS-6 from its S90 and difficulty", () => {
        at(NOW);
        const s7 = v7();
        let card = s7.cardGetNewSchedule(ReviewResponse.Good, "x.md", new CardDueDateHistogram());
        at("2026-11-26T12:10:00.000Z");
        card = answer(s7, card);
        at("2026-12-10T12:00:00.000Z");
        const six = answer(v6(), card);
        const stripped = parse(card.formatScheduleAsComment().replace(/,f7=.*$/, ""))!;
        expect(six.fsrs7).toBeNull();
        expect(six.formatScheduleAsComment()).toBe(
            answer(v6(), stripped).formatScheduleAsComment(),
        );
    });

    test.each([false, true])(
        "FSRS-7 mode: the interval on a button is the one applied 5 minutes later (load balancing %s)",
        (balance) => {
            const settings = {
                fsrsEnableFuzz: true,
                fsrsLoadBalance: balance,
                maximumInterval: 30,
            };
            at(NOW);
            const s = v7(settings);
            let card = s.cardGetNewSchedule(
                ReviewResponse.Good,
                "x.md",
                new CardDueDateHistogram(),
            );
            at("2026-11-26T12:10:00.000Z");
            card = answer(s, card);
            const shown = [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy].map(
                (r) => {
                    at("2026-12-05T09:00:00.000Z");
                    return answer(v7(settings), card, r).interval;
                },
            );
            const applied = [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy].map(
                (r) => {
                    at("2026-12-05T09:05:00.000Z");
                    return answer(v7(settings), card, r).interval;
                },
            );
            expect(applied).toEqual(shown);
            expect(Math.max(...applied)).toBeLessThanOrEqual(30);
        },
    );
});
