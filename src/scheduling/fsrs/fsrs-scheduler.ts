import type { Moment } from "moment";
import {
    CardInput,
    createEmptyCard,
    dateDiffInDays,
    FSRS,
    fsrs,
    Grade,
    Rating,
    RecordLog,
    StrategyMode,
    TypeConvert,
} from "ts-fsrs";

import type { StudioSettings } from "src/data/settings-model";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import { buildFsrsParameters, stableFuzzSeed } from "src/scheduling/fsrs/fsrs-settings";
import { pickFsrsBalancedInterval } from "src/scheduling/fsrs/load-balance";
import { sm2ScheduleToFsrsCard } from "src/scheduling/fsrs/sm2-to-fsrs-card";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

const GRADES: Partial<Record<ReviewResponse, Grade>> = {
    [ReviewResponse.Again]: Rating.Again,
    [ReviewResponse.Hard]: Rating.Hard,
    [ReviewResponse.Good]: Rating.Good,
    [ReviewResponse.Easy]: Rating.Easy,
};

/** The ts-fsrs rating of an answer button; Reset is no rating. */
export function reviewResponseToFsrsGrade(response: ReviewResponse): Grade {
    const grade = GRADES[response];
    if (grade === undefined) throw new Error(`Unsupported FSRS response: ${response}`);
    return grade;
}

const DAY_MS = 86_400_000;

/**
 * The four buttons of a card are asked for one after another, and the answer follows later. Asked again for the same
 * card within this many milliseconds, and on the same UTC day, the scheduler hands back what it worked out the first
 * time. (ts-fsrs counts whole UTC days, so a hit can shift a timestamp by under a second but never an interval.)
 */
const SAME_MOMENT_MS = 1000;

const sameMoment = (a: number, b: number): boolean =>
    Math.abs(a - b) < SAME_MOMENT_MS && Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS);

/**
 * Everything the answers of ts-fsrs depend on in a schedule. A card is known by this, not by its object, so a schedule
 * changed in place, or an identical one, is told apart from or taken for the card whose answers are kept.
 */
function fingerprint(card: ScheduleState | null): string {
    if (card === null) return "none";
    const common = [card.dueDate?.valueOf(), card.interval, card.latestEase];
    return card instanceof FsrsState
        ? [
              ...common,
              card.lastReview?.valueOf(),
              card.stability,
              card.difficulty,
              card.reps,
              card.lapses,
              card.state,
              card.learningSteps,
          ].join()
        : `sm2,${common.join()}`;
}

/**
 * Everything the plugin asks of ts-fsrs, in one place: the schedule a button gives, and the reset card. Another
 * scheduling model can take this place without the rest of the plugin noticing.
 *
 * ts-fsrs freezes its parameters when it is built, so a settings change needs a new `FsrsScheduler`.
 */
export class FsrsScheduler {
    private readonly fsrs: FSRS;
    private readonly loadBalance: { maximumInterval: number; easyDays: readonly number[] } | null;
    private shown: { key: string; at: number; answers: RecordLog; card: CardInput } | null = null;

    constructor(settings: StudioSettings) {
        // Fuzz is seeded from the card, so the interval shown on a button is the one applied when it is pressed
        this.loadBalance = settings.fsrsLoadBalance
            ? { maximumInterval: settings.maximumInterval, easyDays: settings.fsrsEasyDays }
            : null;
        this.fsrs = fsrs(
            buildFsrsParameters(
                settings.fsrsLoadBalance ? { ...settings, fsrsEnableFuzz: false } : settings,
            ),
        ).useStrategy(StrategyMode.SEED, stableFuzzSeed);
    }

    /**
     * The schedule a button gives a card that has been reviewed, answered at `now`. The four buttons of one card share
     * a single ts-fsrs call.
     *
     * @param card - The card's schedule: FSRS, or SM-2 (a card reviewed before the algorithm changed). With none at
     *               hand the card is converted as an SM-2 card without a schedule (inventory 6.4).
     * @throws For Reset, which is no answer.
     */
    schedule(
        card: ScheduleState | null,
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
    ): FsrsState {
        return this.answer(
            fingerprint(card),
            response,
            now,
            histogram,
            card?.dueDate ? card.dueDateAsUnix : undefined,
            () =>
                card instanceof FsrsState
                    ? card.toFsrsCardInput(now)
                    : sm2ScheduleToFsrsCard(card, now),
        );
    }

    /** The first answer to a card never reviewed. */
    scheduleNew(
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
        notePath: string,
    ): FsrsState {
        return this.answer(`new:${notePath}`, response, now, histogram, undefined, () =>
            createEmptyCard(now.toDate()),
        );
    }

    /** A card never reviewed, due now: what the Reset button gives. (`forget` would keep the last review.) */
    reset(now: Moment): FsrsState {
        return FsrsState.fromFsrsCard(createEmptyCard(now.toDate()));
    }

    private answer(
        key: string,
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
        currentDueUnix: number | undefined,
        cardAt: () => CardInput,
    ): FsrsState {
        const grade = reviewResponseToFsrsGrade(response);
        const at = now.valueOf();
        let shown = this.shown;
        if (shown?.key !== key || !sameMoment(at, shown.at)) {
            const card = FsrsScheduler.notAhead(cardAt(), now);
            const answers = this.fsrs.repeat(card, now.toDate());
            shown = this.shown = { key, at, answers, card };
        }
        const scheduled = shown.answers[grade].card;
        if (this.loadBalance === null) return FsrsState.fromFsrsCard(scheduled);

        const elapsedDays = shown.card.last_review
            ? Math.max(0, dateDiffInDays(TypeConvert.time(shown.card.last_review), now.toDate()))
            : 0;
        const interval = pickFsrsBalancedInterval({
            targetInterval: scheduled.scheduled_days,
            elapsedDays,
            maximumInterval: this.loadBalance.maximumInterval,
            histogram,
            now,
            seed: FsrsScheduler.balanceSeed(shown.card, key),
            easyDays: this.loadBalance.easyDays,
            currentDueUnix,
        });
        if (interval === scheduled.scheduled_days) return FsrsState.fromFsrsCard(scheduled);
        return FsrsState.fromFsrsCard({
            ...scheduled,
            due: new Date(now.valueOf() + interval * DAY_MS),
            // eslint-disable-next-line camelcase -- ts-fsrs CardInput uses this persisted field name.
            scheduled_days: interval,
        });
    }

    /** Matches the reviewed-card part of stableFuzzSeed; new cards use their stable note key. */
    private static balanceSeed(card: CardInput, fallback: string): string {
        const lastReview = card.last_review;
        if (!lastReview) return fallback;
        return `${TypeConvert.time(lastReview).getTime()}_${card.reps}_${card.stability * card.difficulty}`;
    }

    /**
     * ts-fsrs throws for a last review that lies on a later UTC day than the answer (a card converted from SM-2 that
     * is not yet due, whose interval is shorter than the days left, or a card reviewed on a device whose clock is
     * ahead). Such a review is moved to the start of the answer's day: zero days have passed, and the fuzz seed, which
     * holds the last review time, stays the same all day, so the interval a button shows is the one applied.
     */
    private static notAhead(card: CardInput, now: Moment): CardInput {
        const at = now.toDate();
        const lastReview = card.last_review ? TypeConvert.time(card.last_review) : null;
        if (!lastReview || dateDiffInDays(lastReview, at) >= 0) return card;
        const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
        return { ...card, ["last_review"]: dayStart };
    }
}
