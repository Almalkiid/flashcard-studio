import { default_w as DEFAULT_WEIGHTS, forgetting_curve as forgettingCurve } from "ts-fsrs";

import type { Card } from "src/data/data-structures/card/flashcard";
import type { ReviewOrder, StudioSettings } from "src/data/settings-model";
import { parseFsrsWeights, relearningStepCount } from "src/scheduling/fsrs/fsrs-settings";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";

const MS_PER_DAY = 86_400_000;
/** An interval of no length would divide by zero; a learning step is a fraction of a day at most. */
const SHORTEST_STABILITY_DAYS = 1 / 1440;

/** The review order a setting names; anything unknown is the due date order. */
export function reviewOrderOf(value: unknown): ReviewOrder {
    return value === "mostAtRisk" ? "mostAtRisk" : "dueDate";
}

/**
 * How likely each card is to be remembered at `nowMs`: lower is more at risk, so a list sorted by it puts the cards
 * closest to being forgotten first. NaN says the card has no date to go by, and a card with no schedule is not at risk.
 *
 * An FSRS card with a memory state is rated by its stability and the time since its last review. Every other card
 * (SM-2, or FSRS without a memory state) is rated as if its stability were its interval, which orders cards by how
 * many times their interval has passed since they were scheduled (relative overdueness).
 */
export function createCardRisk(settings: StudioSettings, nowMs: number): (card: Card) => number {
    const weights =
        parseFsrsWeights(settings.fsrsWeights, relearningStepCount(settings)).weights ??
        DEFAULT_WEIGHTS;

    return (card) => {
        const schedule = card.scheduleInfo;
        if (schedule === null) return Infinity;

        let elapsedMs: number;
        let stability: number;
        const lastReview = schedule instanceof FsrsState ? schedule.lastReview : null;
        if (schedule instanceof FsrsState && schedule.stability > 0 && lastReview) {
            elapsedMs = nowMs - lastReview.valueOf();
            stability = schedule.stability;
        } else {
            stability = Math.max(schedule.interval, SHORTEST_STABILITY_DAYS);
            elapsedMs = nowMs - schedule.dueDateAsUnix + stability * MS_PER_DAY;
        }
        return forgettingCurve(weights, Math.max(0, elapsedMs / MS_PER_DAY), stability);
    };
}
